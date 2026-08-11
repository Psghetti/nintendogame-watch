/* ============================================================================
 * keys-diagram.js — the shared Controls-screen ENGINE.
 *
 * A device-agnostic renderer that draws the "Controls" schematic (D-pad / rocker
 * / stick / round buttons / operational pills + the extras column) from a game's
 * own hotspot geometry. Extracted verbatim out of gnw.js so BOTH the main site
 * (every G&W device) AND the Tetris Jr iframe render their Controls with the
 * IDENTICAL code — one code base, no hand-built replicas.
 *
 * Per-device DATA (KEYS_OVERRIDE, LAYOUT_n_KEYS, the GAMES registry, _emu wiring)
 * stays with each caller; this file is pure rendering.
 *
 * Public API (window.KeysDiagram):
 *   ensureCss(doc)            inject the diagram CSS into doc once (idempotent)
 *   render(panelEl, opts)     build the diagram HTML into panelEl
 *   fit(panelEl)              letterbox-fit the aspect-locked diagram in its panel
 *   attachInput(panelEl)      light buttons live while their key is held
 *   detachInput()             stop the live highlighting
 *   buildHTML(opts)           the HTML string only (used by render)
 *
 * opts = { game, gameKey, ar, override, games, overrides, meta, extra }
 *   game       the live game object (needs .hotspots, optional .screen/.screen2,
 *              .microVs) — the diagram is derived from its hotspot geometry
 *   ar         device artwork aspect (width/height) → true button proportions
 *   override   this game's KEYS_OVERRIDE entry (layout knobs), or {}
 *   games      registry for cloneFrom resolution (optional)
 *   overrides  the full KEYS_OVERRIDE map for a clone target's knobs (optional)
 *   meta       per-call BUTTON_META overrides (e.g. {jump:{label:'Rotate',...}})
 *   extra      HTML for the extras column body (defaults to the G&W set)
 * ==========================================================================*/
(function () {
  'use strict';

  // Non-directional buttons: friendly label + the key(s) that press them. (The
  // four D-pad directions are handled by _dpadHTML, not here.)
  var BUTTON_META = {
    left:  { label:'Left',   keys:['←','Q'] },
    right: { label:'Right',  keys:['→','E'] },
    up:    { label:'Up',     keys:['↑'] },
    down:  { label:'Down',   keys:['↓'] },
    // btn1-4 render as a D-pad ONLY when their positions form a cross; otherwise
    // (e.g. Black Jack's four discrete buttons) they use these individual labels.
    btn1:  { label:'',       keys:['Q','→'] },
    btn2:  { label:'',       keys:['E','↑'] },
    btn3:  { label:'',       keys:['A','←'] },
    btn4:  { label:'',       keys:['D','↓'] },
    hit:   { label:'Hit',    keys:['Q'] },
    jump:  { label:'Jump',   keys:['Space'] },
    open:  { label:'Open',   keys:['Space'] },
    fire:  { label:'Fire',   keys:['Space'] },
    gameA: { label:'Game A', keys:['1'] },
    gameB: { label:'Game B', keys:['2'] },
    time:  { label:'Time',   keys:['3'] },
    alarm: { label:'Alarm',  keys:[] },
    // Micro Vs. player 2 — an external WASD controller (letter keys, not arrows).
    p2up:    { label:'', keys:['W'] },
    p2down:  { label:'', keys:['S'] },
    p2left:  { label:'', keys:['A'] },
    p2right: { label:'', keys:['D'] },
    p2fire:  { label:'Fire', keys:['F'] },
  };

  // Direction arrow shown on each dirCircles circle, keyed by hotspot NAME.
  var _DIR_ARROW = { up:'↑', down:'↓', left:'←', right:'→', btn1:'→', btn2:'↑', btn3:'←', btn4:'↓' };

  // Map a displayed key glyph → the actual keyboard event.key (lowercased) so the
  // Controls screen can light a button live while its key is held.
  var _GLYPH_KEY = { '←':'arrowleft', '→':'arrowright', '↑':'arrowup', '↓':'arrowdown', 'Space':' ', 'R Ctrl':'control', 'Ctrl':'control' };
  function _glyphKey(g){ return (_GLYPH_KEY[g] || String(g)).toLowerCase(); }

  // btn1-4 are a real D-PAD only when their four hotspots form a tight CROSS
  // (up above down and aligned, left left-of-right and aligned, sharing a centre).
  function _dpadCross(b1, b2, b3, b4){
    var pts = [b1,b2,b3,b4].map(function(b){ return { x:b.left+b.width/2, y:b.top+b.height/2 }; });
    var cxm = (pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4, cym = (pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4;
    var w = (b1.width+b2.width+b3.width+b4.width)/4, h = (b1.height+b2.height+b3.height+b4.height)/4;
    var top=[],bot=[],lft=[],rgt=[];
    pts.forEach(function(p){
      if (p.y < cym-h*0.3) top.push(p); else if (p.y > cym+h*0.3) bot.push(p);
      if (p.x < cxm-w*0.3) lft.push(p); else if (p.x > cxm+w*0.3) rgt.push(p);
    });
    if (top.length!==1 || bot.length!==1 || lft.length!==1 || rgt.length!==1) return false;
    return Math.abs(top[0].x-cxm) < w*0.7 && Math.abs(bot[0].x-cxm) < w*0.7 &&
           Math.abs(lft[0].y-cym) < h*0.7 && Math.abs(rgt[0].y-cym) < h*0.7;
  }

  // Collect the diagram's items: the four directional buttons fold into ONE 'dpad'
  // element; everything else is an individual button. Coordinates stay in the
  // game's own % space so the screen-removal collapse can work on them.
  function _keysButtons(game, ov){
    ov = ov || {};
    // keysHotspots: a diagram-ONLY control geometry (e.g. Micro Vs., where the
    // real console has no P1/P2 buttons — they're external controllers), used in
    // place of the gameplay hotspots for the schematic.
    var hs0 = (ov.keysHotspots || (game && game.hotspots)) || {}, hs = {};
    for (var k in hs0) hs[k] = hs0[k];
    // Diagram-only: drop named controls from the schematic (hs is a COPY, so
    // gameplay hotspots are untouched). Used to hide a keyless "Alarm" pill.
    if (ov.hideButtons) ov.hideButtons.forEach(function(n){ delete hs[n]; });
    function bbox(ns){
      var L=1e9,T=1e9,R=-1e9,B=-1e9;
      ns.forEach(function(n){ var b=hs[n]; L=Math.min(L,b.left); T=Math.min(T,b.top); R=Math.max(R,b.left+b.width); B=Math.max(B,b.top+b.height); });
      return { left:L, top:T, width:R-L, height:B-T };
    }
    var items = [];
    // Directional STICK (Tabletop): the left/right (± up/down) hotspots are the two
    // extremes of ONE joystick — merge them into a single 'stick' element.
    if (ov.stick){
      var dn = ['left','right','up','down'].filter(function(n){ return hs[n]; });
      if (dn.length){ items.push({ kind:'stick', dirs:dn, rect:bbox(dn) }); dn.forEach(function(n){ delete hs[n]; }); }
      else {
        // btn1-4 cross (DK Jr Tabletop's 4-way joystick) → the same stick element.
        var BMAP = { btn1:'right', btn2:'up', btn3:'left', btn4:'down' };
        var bn = ['btn1','btn2','btn3','btn4'].filter(function(n){ return hs[n]; });
        if (bn.length){ items.push({ kind:'stick', dirs:bn.map(function(n){ return BMAP[n]; }), rect:bbox(bn) }); bn.forEach(function(n){ delete hs[n]; }); }
      }
    }
    // btn1-4 → a single D-PAD cross ONLY when they actually form a cross.
    var quad = ['btn1','btn2','btn3','btn4'];
    if (!ov.dirCircles && quad.every(function(n){ return hs[n]; }) && _dpadCross(hs.btn1, hs.btn2, hs.btn3, hs.btn4)){
      items.push({ kind:'dpad', rect:bbox(quad) }); quad.forEach(function(n){ delete hs[n]; });
    }
    // A TOUCHING directional pair becomes ONE rocker (a rectangle).
    var DIRK = { left:['arrowleft','q'], right:['arrowright','e'], up:['arrowup'], down:['arrowdown'],
                 btn1:['arrowright','q'], btn2:['arrowup','e'], btn3:['arrowleft','a'], btn4:['arrowdown','d'] };
    var dnames = (ov.noRocker || ov.dirCircles) ? [] : Object.keys(DIRK).filter(function(n){ return hs[n]; });
    for (var pi=0; pi<dnames.length; pi++){
      var na = dnames[pi]; if (!hs[na]) continue;
      for (var pj=pi+1; pj<dnames.length; pj++){
        var nb = dnames[pj]; if (!hs[nb]) continue;
        var A = hs[na], B = hs[nb];
        var horiz = Math.abs((A.left+A.width/2)-(B.left+B.width/2)) >= Math.abs((A.top+A.height/2)-(B.top+B.height/2));
        var touch;
        if (horiz){ var lo=A.left<=B.left?A:B, h2=A.left<=B.left?B:A;
          touch = Math.abs(A.top-B.top)<Math.min(A.height,B.height)*0.6 && (h2.left-(lo.left+lo.width))<(A.width+B.width)/2*0.13;
        } else { var lv=A.top<=B.top?A:B, hv=A.top<=B.top?B:A;
          touch = Math.abs(A.left-B.left)<Math.min(A.width,B.width)*0.6 && (hv.top-(lv.top+lv.height))<(A.height+B.height)/2*0.13;
        }
        if (touch){
          var ka, kb;
          if (horiz){ var l=A.left<=B.left?na:nb, r=A.left<=B.left?nb:na; ka=DIRK[l]; kb=DIRK[r]; }
          else { var t=A.top<=B.top?na:nb, bt=A.top<=B.top?nb:na; ka=DIRK[t]; kb=DIRK[bt]; }
          items.push({ kind:'rocker', dir:horiz?'h':'v', rect:bbox([na,nb]), ka:ka, kb:kb });
          delete hs[na]; delete hs[nb]; break;
        }
      }
    }
    for (var n in hs) if (BUTTON_META[n]) items.push({ kind:'btn', name:n, rect:hs[n] });
    // Free-text labels placed in the diagram coordinate space (e.g. Micro Vs.
    // "P1"/"P2" over each controller). Not buttons — never sized/merged.
    if (ov.keysLabels) ov.keysLabels.forEach(function(l){
      items.push({ kind:'label', text:l.text, rect:{ left:l.x-7, top:l.y-2.5, width:14, height:5 } });
    });
    return items;
  }

  // Compact the items by squeezing out the LCD screen region(s) between groups.
  function _keysLayout(game, ar, ov){
    ar = ar || 1; ov = ov || {};
    var items = _keysButtons(game, ov);
    if (!items.length) return null;
    var rects = items.map(function(it){ return { it:it, x:it.rect.left*ar, y:it.rect.top, w:it.rect.width*ar, h:it.rect.height }; });
    // a stick renders as a round base — square its box (side = the longer extent)
    rects.forEach(function(r){
      if (r.it.kind === 'stick'){ var cx=r.x+r.w/2, cy=r.y+r.h/2, s=Math.max(r.w,r.h); r.x=cx-s/2; r.y=cy-s/2; r.w=s; r.h=s; }
    });
    var screens = [];
    if (!ov.keysHotspots) {   // a synthetic layout has no LCD region to squeeze out
      if (game.screen)  screens.push({ left:game.screen.left*ar,  top:game.screen.top,  width:game.screen.width*ar,  height:game.screen.height });
      if (game.screen2) screens.push({ left:game.screen2.left*ar, top:game.screen2.top, width:game.screen2.width*ar, height:game.screen2.height });
    }
    function collapse(ax, sz){
      var ivs = rects.map(function(r){ return [r[ax], r[ax]+r[sz]]; }).sort(function(a,b){ return a[0]-b[0]; });
      var merged = [];
      ivs.forEach(function(iv){
        if (merged.length && iv[0] <= merged[merged.length-1][1] + 1) merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], iv[1]);
        else merged.push([iv[0], iv[1]]);
      });
      var gaps = [];
      for (var i=1;i<merged.length;i++){
        var gs = merged[i-1][1], ge = merged[i][0], gsz = ge-gs;
        var overlaps = screens.some(function(s){ var ss=(ax==='x'?s.left:s.top), se=ss+(ax==='x'?s.width:s.height); return ss<ge && se>gs; });
        if (overlaps && gsz>3) gaps.push([gs, gsz]);
      }
      rects.forEach(function(r){ var sh=0; gaps.forEach(function(g){ if (r[ax] >= g[0]) sh += (g[1]-4); }); r[ax]-=sh; });
    }
    collapse('x','w'); collapse('y','h');
    // Keep the operational buttons (Game A/B/Time/Alarm) together as ONE tight,
    // evenly-spaced cluster centred on where they already sit.
    var OPS = { gameA:1, gameB:1, time:1, alarm:1 };
    var ops = rects.filter(function(r){ return r.it.kind === 'btn' && OPS[r.it.name]; });
    if (ops.length >= 2){
      var cx = ops.map(function(o){ return o.x + o.w/2; }), cy = ops.map(function(o){ return o.y + o.h/2; });
      var spanX = Math.max.apply(null,cx) - Math.min.apply(null,cx);
      var spanY = Math.max.apply(null,cy) - Math.min.apply(null,cy);
      var horiz = spanX >= spanY;
      var ax = horiz?'x':'y', sz = horiz?'w':'h', cr = horiz?'y':'x', cs = horiz?'h':'w';
      ops.sort(function(a,b){ return (a[ax]+a[sz]/2) - (b[ax]+b[sz]/2); });
      var mid = (ops[0][ax]+ops[0][sz]/2 + ops[ops.length-1][ax]+ops[ops.length-1][sz]/2)/2;
      var crMid = ops.reduce(function(s,o){ return s+o[cr]+o[cs]/2; },0)/ops.length;
      // Diagram-ONLY per-layout nudge (opDX/opDY), aspect-corrected; never gameplay.
      if (horiz){ mid += (ov.opDX || 0); crMid += (ov.opDY || 0); }
      else       { crMid += (ov.opDX || 0); mid += (ov.opDY || 0); }
      var avgW = ops.reduce(function(s,o){ return s+o.w; },0)/ops.length;
      var avgH = ops.reduce(function(s,o){ return s+o.h; },0)/ops.length;
      var vert = avgH > avgW * 1.15;
      var lng = (vert ? avgH : avgW) * (ov.opScale || 1), shrt = lng / 1.8;
      ops.forEach(function(o){ if (vert){ o.h = lng; o.w = shrt; } else { o.w = lng; o.h = shrt; } });
      var gap = (ov.opGap != null ? ov.opGap : 0.16) * ops[0][sz];
      var total = ops.length*ops[0][sz] + gap*(ops.length-1);
      var cur;
      if (ov.opAnchor === 'right'){
        var totalDef = ops.length*ops[0][sz] + 0.16*ops[0][sz]*(ops.length-1);
        cur = (mid + totalDef/2) - total;
      } else {
        cur = mid - total/2;
      }
      ops.forEach(function(o){ o[ax]=cur; cur += o[sz]+gap; o[cr] = crMid - o[cs]/2; });
    }
    // Normalise individual button SIZES by role. (p2* = Micro Vs. player 2, so both
    // players' crosses + fire buttons size uniformly.)
    var ACT = { jump:1, open:1, hit:1, fire:1, p2fire:1 };
    var DIR = { left:1, right:1, up:1, down:1, btn1:1, btn2:1, btn3:1, btn4:1, p2up:1, p2down:1, p2left:1, p2right:1 };
    var singles = rects.filter(function(r){ return r.it.kind === 'btn' && !OPS[r.it.name]; });
    var dirs = singles.filter(function(r){ return DIR[r.it.name]; });
    if (dirs.length){
      var ss = dirs.map(function(r){ return Math.max(r.w, r.h); }).sort(function(a,b){ return a-b; });
      var D = ss[Math.floor(ss.length/2)];
      for (var i=0;i<dirs.length;i++) for (var j=i+1;j<dirs.length;j++){
        var dxy = Math.hypot((dirs[i].x+dirs[i].w/2)-(dirs[j].x+dirs[j].w/2), (dirs[i].y+dirs[i].h/2)-(dirs[j].y+dirs[j].h/2));
        if (dxy > 0.1) D = Math.min(D, dxy*0.94);
      }
      singles.forEach(function(r){
        var d = ACT[r.it.name] ? D*1.35 : D*(ov.dirScale || 1);
        var rcx = r.x + r.w/2, rcy = r.y + r.h/2;
        r.w = d; r.h = d; r.x = rcx - d/2; r.y = rcy - d/2;
      });
    }
    // Action buttons render as CIRCLES. The dirs block above squares them only
    // when directional BUTTONS exist; on STICK layouts (dirs empty) an action
    // button keeps its raw hotspot aspect and renders as an oblong — square it
    // here (to the larger extent) so it's a clean circle like the real unit.
    if (ov.actionCircle) singles.forEach(function(r){
      if (ACT[r.it.name]){ var acx=r.x+r.w/2, acy=r.y+r.h/2, as=Math.max(r.w, r.h); r.x=acx-as/2; r.y=acy-as/2; r.w=as; r.h=as; }
    });
    // Scale the action button relative to the rest (per-layout): >1 enlarges,
    // <1 shrinks. Runs after any squaring, so it works whether the action was
    // sized by the dirs block (D*1.35), the actionCircle square, or its raw box.
    if (ov.actionScale) singles.forEach(function(r){
      if (ACT[r.it.name]){ var scx=r.x+r.w/2, scy=r.y+r.h/2; r.w*=ov.actionScale; r.h*=ov.actionScale; r.x=scx-r.w/2; r.y=scy-r.h/2; }
    });
    // rockerHrel: make a horizontal rocker's RENDERED height ≈ this fraction of the
    // action button's RENDERED height (fixes a too-skinny left/right rocker beside a
    // big round button). A rocker draws at tf=0.56 of its box and a round btn at 0.84
    // of its box, so ×(0.84/0.56) converts button-box-height → the rocker box height
    // that renders at the requested fraction.
    if (ov.rockerHrel){
      var _actR = rects.filter(function(r){ return r.it.kind === 'btn' && ACT[r.it.name]; })[0];
      if (_actR) rects.forEach(function(r){
        if (r.it.kind === 'rocker' && r.it.dir === 'h'){
          var rcy = r.y + r.h/2, nh = _actR.h * ov.rockerHrel * (0.84/0.56);
          r.h = nh; r.y = rcy - nh/2;
        }
      });
    }
    // dirDY (per-layout diagram override): shift directional/action controls toward
    // the operational pills — closes a big empty band a dual-screen collapse leaves.
    if (ov.dirDY) rects.forEach(function(r){ if (!(r.it.kind === 'btn' && OPS[r.it.name])) r.y += ov.dirDY; });
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    rects.forEach(function(r){ minX=Math.min(minX,r.x); minY=Math.min(minY,r.y); maxX=Math.max(maxX,r.x+r.w); maxY=Math.max(maxY,r.y+r.h); });
    var bw=(maxX-minX)||1, bh=(maxY-minY)||1;
    return { aspect: bw/bh, items: rects.map(function(r){ return { it:r.it, left:(r.x-minX)/bw*100, top:(r.y-minY)/bh*100, width:r.w/bw*100, height:r.h/bh*100 }; }) };
  }

  function _dpadHTML(style){
    function arm(dir, arrow){ return '<span class="dk dk-'+dir+'" data-k="'+_glyphKey(arrow)+'">'+arrow+'</span>'; }
    return '<div class="keys-dpad" data-k="arrowup,arrowdown,arrowleft,arrowright" style="'+style+'">' +
      '<svg class="keys-dpad-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="M34 3 H66 V34 H97 V66 H66 V97 H34 V66 H3 V34 H34 Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>' +
      '</svg>' +
      arm('up','↑') + arm('down','↓') + arm('left','←') + arm('right','→') +
      '</div>';
  }

  function _stickHTML(dirs, style){
    var A = { left:'←', right:'→', up:'↑', down:'↓' };
    var arrows = dirs.map(function(d){ return '<span class="st-arrow st-'+d+'" data-k="'+_glyphKey(A[d])+'">'+A[d]+'</span>'; }).join('');
    var keys = dirs.map(function(d){ return _glyphKey(A[d]); }).join(',');
    return '<div class="keys-stick" data-k="'+keys+'" style="'+style+'"><div class="keys-stick-base"></div><div class="keys-stick-knob"></div>'+arrows+'</div>';
  }

  function _rockerHTML(dir, style, ka, kb, letters){
    var a, b;
    if (letters && ka && ka[1] && kb && kb[1]){ a = ka[1].toUpperCase(); b = kb[1].toUpperCase(); }
    else { a = dir==='h' ? '←' : '↑'; b = dir==='h' ? '→' : '↓'; }
    var keys = (ka || [_glyphKey(a)]).concat(kb || [_glyphKey(b)]);
    return '<div class="keys-rocker rk-'+dir+'" data-k="'+keys.join(',')+'" style="'+style+'">' +
      '<span class="rk rk-a">'+a+'</span><span class="rk rk-b">'+b+'</span></div>';
  }

  // Build the diagram + extras HTML. `opts.game` is the ORIGINAL game (used for the
  // microVs test); cloneFrom (if any) swaps the geometry source only.
  function buildHTML(opts){
    opts = opts || {};
    var origGame = opts.game, game = opts.game, ov = opts.override || {}, ar = opts.ar || 1;
    var games = opts.games || {}, overrides = opts.overrides || {};
    var META = opts.meta ? _assign({}, BUTTON_META, opts.meta) : BUTTON_META;
    // cloneFrom: render this unit's Controls using another title's control geometry.
    if (ov.cloneFrom && games[ov.cloneFrom]) { game = games[ov.cloneFrom]; ov = overrides[ov.cloneFrom] || {}; }
    if (ov.keysHotspots) ar = ov.keysAr || 1;   // synthetic layout: use its own coords, ignore the device aspect
    var lay = _keysLayout(game, ar, ov);
    function inset(o, fx, fy){
      if (fy == null) fy = fx;
      return 'left:'+(o.left + o.width*(1-fx)/2).toFixed(2)+'%;top:'+(o.top + o.height*(1-fy)/2).toFixed(2)+'%;'+
             'width:'+(o.width*fx).toFixed(2)+'%;height:'+(o.height*fy).toFixed(2)+'%';
    }
    var html = '<div class="keys-wrap">';
    if (lay){
      html += '<div class="keys-diagram" data-aspect="'+lay.aspect.toFixed(3)+'">';
      lay.items.forEach(function(o){
        if (o.it.kind === 'label'){
          html += '<div class="keys-txt" style="'+inset(o, 1)+'">'+o.it.text+'</div>';
        } else if (o.it.kind === 'stick'){
          html += _stickHTML(o.it.dirs, inset(o, 0.9));
        } else if (o.it.kind === 'dpad'){
          html += _dpadHTML(inset(o, 0.96));
        } else if (o.it.kind === 'rocker'){
          var lf = 0.96, tf = 0.56;
          html += _rockerHTML(o.it.dir, o.it.dir==='h' ? inset(o, lf, tf) : inset(o, tf, lf), o.it.ka, o.it.kb, ov.letters);
        } else {
          var m = META[o.it.name] || { label:o.it.name, keys:[] };
          var dk = m.keys.map(_glyphKey).join(',');
          if (ov.dirCircles && _DIR_ARROW[o.it.name]){
            html += '<div class="keys-btn"'+(dk?' data-k="'+dk+'"':'')+' style="'+inset(o, 0.84)+'">'
                  +   '<span class="kk">'+_DIR_ARROW[o.it.name]+'</span>'
                  + '</div>';
          } else {
          // padTime: force the single-word "Time" pill onto a second label line so
          // it stands the same 3 lines tall as "Game A"/"Game B" (Layout 12).
          var _lbl = (ov.padTime && o.it.name === 'time') ? m.label + '<br>&nbsp;' : m.label;
          html += '<div class="keys-btn"'+(dk?' data-k="'+dk+'"':'')+' style="'+inset(o, 0.84)+'">'
                +   (m.keys[0] ? '<span class="kk">'+m.keys[0]+'</span>' : '')
                +   '<span class="kl">'+_lbl+'</span>'
                +   (m.keys[1] ? '<span class="ka">'+m.keys[1]+'</span>' : '')
                + '</div>';
          }
        }
      });
      html += '</div>';
    } else {
      html += '<div style="color:var(--muted)">No button map for this unit.</div>';
    }
    html += '</div>';
    // (Micro Vs. P1/P2 controllers used to be a text legend here; they now render
    //  as real crosses in the main area via keysHotspots, so only the extras remain.)
    var extra = (opts.extra != null) ? opts.extra
      : '<span><b>4</b> Reset</span><span><b>−</b> Mute</span><span><b>Ctrl</b>+<b>←</b> Rewind</span>';
    html += '<div class="keys-extra">' + extra + '</div>';
    return html;
  }

  function render(panelEl, opts){
    if (!panelEl) return;
    ensureCss(panelEl.ownerDocument || document);
    panelEl.innerHTML = buildHTML(opts || {});
  }

  // Fit the aspect-locked diagram inside the panel (letterbox), JS-measured.
  function fit(panelEl){
    if (!panelEl) return;
    var wrap = panelEl.querySelector('.keys-wrap'), dia = panelEl.querySelector('.keys-diagram');
    if (!wrap || !dia) return;
    var W = wrap.clientWidth, H = wrap.clientHeight, A = parseFloat(dia.dataset.aspect) || 1;
    if (!W || !H) return;
    var w = W, h = W / A;
    if (h > H) { h = H; w = H * A; }
    dia.style.width = Math.round(w) + 'px';
    dia.style.height = Math.round(h) + 'px';
  }

  var _input = null;
  function attachInput(panelEl){
    if (!panelEl) return;
    var doc = panelEl.ownerDocument || document;
    var held = {}, relevant = {};
    panelEl.querySelectorAll('[data-k]').forEach(function(el){ el.getAttribute('data-k').split(',').forEach(function(k){ relevant[k] = true; }); });
    var knob = panelEl.querySelector('.keys-stick-knob');
    function refresh(){
      panelEl.querySelectorAll('[data-k]').forEach(function(el){
        el.classList.toggle('lit', el.getAttribute('data-k').split(',').some(function(k){ return held[k]; }));
      });
      if (knob){
        var dx = (held['arrowright']?1:0) - (held['arrowleft']?1:0);
        var dy = (held['arrowdown']?1:0) - (held['arrowup']?1:0);
        knob.style.transform = 'translate('+(dx*62)+'%,'+(dy*62)+'%)';
      }
    }
    detachInput();   // never double-bind
    _input = {
      doc: doc,
      down: function(e){ var k = (e.key===' '?' ':e.key.toLowerCase()); if (!relevant[k]) return; held[k] = true; refresh(); e.preventDefault(); e.stopPropagation(); },
      up:   function(e){ var k = (e.key===' '?' ':e.key.toLowerCase()); if (!held[k]) return; delete held[k]; refresh(); }
    };
    doc.addEventListener('keydown', _input.down, true);
    doc.addEventListener('keyup', _input.up, true);
  }
  function detachInput(){
    if (!_input) return;
    _input.doc.removeEventListener('keydown', _input.down, true);
    _input.doc.removeEventListener('keyup', _input.up, true);
    _input = null;
  }

  // The diagram CSS — the generic .keys-* rules, verbatim out of gnw.js's
  // _keysEnsureDom (the device-specific panel/header rules stay with each caller).
  var KEYS_CSS =
    '.keys-wrap{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;min-width:0}' +
    '.keys-diagram{position:relative}' +
    '.keys-btn{position:absolute;box-sizing:border-box;border:2px solid var(--muted);border-radius:9999px;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:2px;' +
      'background:transparent;color:var(--text);cursor:default;overflow:hidden;' +
      'transition:border-color .15s,background .15s,transform .12s,box-shadow .15s}' +
    '.keys-btn:hover{border-color:var(--accent);background:rgba(238,21,21,.10);box-shadow:0 0 0 3px rgba(238,21,21,.14);transform:translateY(-1px)}' +
    '.keys-btn .kk{font-weight:800;font-size:clamp(11px,2.2vw,18px);line-height:1;letter-spacing:.02em;text-align:center}' +
    '.keys-btn .kl{font-size:clamp(7px,1.3vw,11px);color:var(--muted);line-height:1.05;text-transform:uppercase;letter-spacing:.04em;text-align:center}' +
    '.keys-btn .ka{font-size:9px;color:var(--muted);opacity:.65;line-height:1}' +
    '.keys-txt{position:absolute;display:flex;align-items:center;justify-content:center;' +
      'font-weight:800;font-size:clamp(11px,2vw,16px);color:var(--text);letter-spacing:.08em;text-transform:uppercase}' +
    '.keys-dpad{position:absolute;color:var(--muted);transition:color .15s,filter .15s}' +
    '.keys-dpad-svg{position:absolute;inset:0;width:100%;height:100%;display:block}' +
    '.keys-dpad:hover{color:var(--accent);filter:drop-shadow(0 0 5px rgba(238,21,21,.45))}' +
    '.keys-dpad .dk{position:absolute;display:flex;flex-direction:column;align-items:center;line-height:1;' +
      'font-weight:800;font-size:clamp(9px,1.9vw,16px);color:var(--text)}' +
    '.keys-dpad .dk i{font-style:normal;font-size:.62em;font-weight:700;color:var(--muted);margin-top:1px}' +
    '.keys-dpad .dk-up{top:7%;left:50%;transform:translateX(-50%)}' +
    '.keys-dpad .dk-down{bottom:7%;left:50%;transform:translateX(-50%)}' +
    '.keys-dpad .dk-left{left:7%;top:50%;transform:translateY(-50%)}' +
    '.keys-dpad .dk-right{right:7%;top:50%;transform:translateY(-50%)}' +
    '.keys-rocker{position:absolute;box-sizing:border-box;border:2px solid var(--muted);border-radius:11px;' +
      'background:transparent;transition:border-color .15s,background .15s,transform .12s,box-shadow .15s}' +
    '.keys-rocker:hover{border-color:var(--accent);background:rgba(238,21,21,.10);box-shadow:0 0 0 3px rgba(238,21,21,.14);transform:translateY(-1px)}' +
    '.keys-rocker .rk{position:absolute;font-weight:800;font-size:clamp(11px,2vw,18px);color:var(--text)}' +
    '.keys-rocker.rk-h .rk-a{left:11%;top:50%;transform:translateY(-50%)}' +
    '.keys-rocker.rk-h .rk-b{right:11%;top:50%;transform:translateY(-50%)}' +
    '.keys-rocker.rk-v .rk-a{top:9%;left:50%;transform:translateX(-50%)}' +
    '.keys-rocker.rk-v .rk-b{bottom:9%;left:50%;transform:translateX(-50%)}' +
    '.keys-rocker.lit{border-color:var(--accent);background:rgba(238,21,21,.24);box-shadow:0 0 0 3px rgba(238,21,21,.14)}' +
    '.keys-btn.lit{border-color:var(--accent);background:rgba(238,21,21,.24);box-shadow:0 0 0 3px rgba(238,21,21,.3)}' +
    '.keys-btn.lit .kk,.keys-btn.lit .kl,.keys-btn.lit .ka{color:var(--text)}' +
    '.keys-rocker.lit{border-color:var(--accent);background:rgba(238,21,21,.24);box-shadow:0 0 0 3px rgba(238,21,21,.3)}' +
    '.keys-dpad.lit svg path{fill:rgba(238,21,21,.24);stroke:var(--accent)}' +
    '.keys-dpad.lit .dk{color:var(--text)}' +
    '.keys-stick{position:absolute}' +
    '.keys-stick-base{position:absolute;inset:0;border:2px solid var(--muted);border-radius:50%;box-sizing:border-box;transition:border-color .15s}' +
    '.keys-stick-knob{position:absolute;left:30%;top:30%;width:40%;height:40%;border:2px solid var(--muted);border-radius:50%;box-sizing:border-box;background:rgba(180,190,205,.06);transition:transform .08s ease-out,border-color .15s}' +
    '.keys-stick:hover .keys-stick-base,.keys-stick:hover .keys-stick-knob{border-color:var(--accent)}' +
    '.keys-stick .st-arrow{position:absolute;font-weight:800;font-size:clamp(10px,1.7vw,15px);color:var(--muted)}' +
    '.keys-stick .st-arrow.lit{color:var(--accent);text-shadow:0 0 8px rgba(238,21,21,.7)}' +
    '.keys-stick .st-left{left:8%;top:50%;transform:translateY(-50%)}' +
    '.keys-stick .st-right{right:8%;top:50%;transform:translateY(-50%)}' +
    '.keys-stick .st-up{top:6%;left:50%;transform:translateX(-50%)}' +
    '.keys-stick .st-down{bottom:6%;left:50%;transform:translateX(-50%)}' +
    '.keys-dpad.lit{filter:drop-shadow(0 0 6px rgba(238,21,21,.45))}' +
    '.keys-stick.lit .keys-stick-base,.keys-stick.lit .keys-stick-knob{border-color:var(--accent)}' +
    '.keys-stick.lit .keys-stick-knob{background:rgba(238,21,21,.24);box-shadow:0 0 10px rgba(238,21,21,.45)}' +
    '.keys-extra{display:flex;flex-direction:column;justify-content:center;gap:12px;font-size:12px;color:var(--muted);' +
      'padding-left:16px;border-left:1px solid var(--line);white-space:nowrap;align-self:stretch}' +
    '.keys-extra span{display:inline-flex;align-items:center;gap:5px}' +
    '.keys-extra b{color:var(--text);background:#20241d;border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:11px;font-weight:700}' +
    '.keys-extra .kx-ctrl{display:flex;flex-direction:column;gap:4px;padding-bottom:9px;margin-bottom:3px;border-bottom:1px solid var(--line)}' +
    '.keys-extra .kx-h{color:var(--text);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em}' +
    '.keys-extra .kx-ctrl b{margin-right:2px;padding:1px 4px}';

  function ensureCss(doc){
    doc = doc || document;
    if (doc.getElementById('keys-diagram-css')) return;
    var style = doc.createElement('style');
    style.id = 'keys-diagram-css';
    style.textContent = KEYS_CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function _assign(t){ for (var i=1;i<arguments.length;i++){ var s=arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s,k)) t[k]=s[k]; } return t; }

  window.KeysDiagram = {
    ensureCss: ensureCss,
    render: render,
    buildHTML: buildHTML,
    fit: fit,
    attachInput: attachInput,
    detachInput: detachInput,
  };
})();
