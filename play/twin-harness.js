(function(){
  'use strict';
  // The twin (cpu + peripherals + WASM core) runs in a Web Worker so its CPU
  // bursts (e.g. sprite decompression) never block the page's paint/input.
  // This page is a thin shell: it transfers the screen canvas to the worker
  // (OffscreenCanvas — the worker draws directly), forwards input, owns the
  // AudioContext/AudioWorklet and relays audio buffers to it, and shows status.
  // Deferred start: nothing runs or makes a sound until the user taps — like the
  // gnw play windows. The TFT firmware plays audio on its own demo/clock screen,
  // so booting instantly would sound off before the user opts in. start() (below)
  // creates the worker, hands it the canvas, and arms audio on that tap gesture.
  var worker = null;
  var canvas = document.getElementById('screen');
  var statusEl = document.getElementById('status');

  // ---- audio ---------------------------------------------------------------
  // The AudioContext must live on the main thread (workers can't create one).
  // The worker produces the firmware's audio buffers and relays them here; we
  // forward each to the AudioWorklet, and send the worklet's consumed-sample
  // count back to the worker so its pump can hold the ring latency constant.
  var SRC_RATE = 22050;                 // firmware audio rate (free-running SAI)
  var audioCtx = null, audioNode = null, audioGain = null, audioReady = false, muted = false;
  // Presentation EQ: a first-order high shelf that brightens the firmware's OWN
  // signal. shR = one-pole HP coeff for the corner; shG = mix so the high
  // asymptote is +gain dB while bass stays 0 dB. HP_FREQ = sub-bass high-pass.
  var EQ_SHELF = { on: false, freq: 3000, gain: 3.0 };  // Device: brightness shelf OFF (raw firmware output + the transducer model)
  var _shR = 1 - 2*Math.PI*EQ_SHELF.freq/SRC_RATE;
  var _shG = (Math.pow(10, EQ_SHELF.gain/20) - 1) * (1 + _shR) / 2;
  var HP_FREQ = 50;
  var _hpR = 1 - 2*Math.PI*HP_FREQ/SRC_RATE;
  // Worklet: a ring drained at the output rate with a DC blocker, a gentle
  // presentation high-shelf (bypassable), and an optional consumption-side DRC
  // resample servo (default off). The emergency trim only fires on a real ~0.5s
  // backlog; steady state never trims. Unchanged from the single-thread build.
  // Full transducer "twin-sink" worklet inlined from the pilot audio-worklet.js — a SUPERSET of the
  // old shelf-only worklet (same registerProcessor + shR/shG/shOn/hpR processorOptions, PLUS the
  // transducer speaker model). Kept INLINE as a Blob for the portable self-contained design.
  var WORKLET_SRC = `
/* audio-worklet.js — TwinSink
   Ring drain + DC blocker + (legacy shelf / Faithful-Warm-Bright preset chain)
   + the tunable TRANSDUCER MODEL:
       drive → HP → resonance → NONLINEARITY(oversampled) → LP → breakup → makeup → clamp
   All biquad COEFFICIENTS are computed on the main thread and posted here; this
   file only APPLIES them. No allocation inside process(). The "off" path (model
   disengaged) reproduces the previous inline worklet's math exactly, so the null
   bypass is bit-identical to the pre-model output.

   Messages (port):
     {eq:bool}                      legacy presentation shelf on/off
     {drc:bool}                     consumption-side resample servo
     {spk:[{b0,b1,b2,a1,a2}]|null}  legacy Faithful/Warm/Bright biquad chain
     {engaged:bool}                 transducer model on/off (default off = bypass)
     {bypass:bool}                  A/B: while engaged, compare model vs legacy
     {model:{...}}                  full model parameter snapshot (see applyModel)
   Reports: {r,u,t,f,ratio,clips} every 4th block (ring pacing + clip counter).
*/
'use strict';

const RAMP_MS = 10;

class TwinSink extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const po = (options && options.processorOptions) || {};

    // ---- ring (unchanged) ----
    this.ring = new Float32Array(65536); this.mask = this.ring.length - 1;
    this.w = 0; this.r = 0; this.rf = 0; this.primed = false; this.PRIME = 1600;
    this.under = 0; this.trims = 0; this.rep = 0;

    // ---- DC blocker (unchanged) ----
    this.dcInit = false; this.x1 = 0; this.y1 = 0; this.R = po.hpR || 0.9985;

    // ---- legacy presentation shelf (unchanged) ----
    this.shR = po.shR || 0; this.shG = po.shG || 0; this.shOn = po.shOn !== false;
    this.yp = 0; this.hp1 = 0;

    // ---- legacy Faithful/Warm/Bright biquad chain (unchanged) ----
    this.spk = null;

    // ---- DRC (unchanged) ----
    this.drc = false; this.ratio = 1; this.TARGET = 1600; this.MAXDEV = 0.005;

    // ---- transducer model ----
    this.engaged = false; this.bypass = false;
    this.mix = 0; this.XF = Math.exp(-1 / (RAMP_MS * 0.001 * sampleRate)); // 10 ms crossfade
    this.GR = this.XF;                                                     // gain smoothing
    this.drive = 1; this.driveT = 1;
    this.makeup = 1; this.makeupT = 1; this.auto = true;
    this.hp = this._sections(3); this.res = this._sections(1);
    this.lp = this._sections(2); this.brk = this._sections(1);
    this.hpN = 0; this.resN = 0; this.lpN = 0; this.brkN = 0; this.brkOn = false;
    this.nlMode = 0; this.nlTh = 0.7; this.nlKnee = 0.1;   // 0 off 1 soft 2 cubic 3 hard
    this.os = 1;
    this.firLen = 0; this.firUp = new Float32Array(96); this.firDn = new Float32Array(96);
    this.upBuf = new Float32Array(96); this.upPos = 0;
    this.dnBuf = new Float32Array(96); this.dnPos = 0;
    this.rmsRef = 1e-6; this.rmsMod = 1e-6; this.rmsC = 1 - Math.exp(-1 / (0.050 * sampleRate)); // 50 ms
    this.clips = 0;

    const s = this;
    this.port.onmessage = function (e) {
      const d = e.data; if (!d) return;
      if (d.eq !== undefined) { s.shOn = d.eq; return; }
      if (d.drc !== undefined) { s.drc = d.drc; s.rf = s.r; s.ratio = 1; return; }
      if (d.spk !== undefined) {
        s.spk = d.spk ? d.spk.map(function (c) { return { b0: c.b0, b1: c.b1, b2: c.b2, a1: c.a1, a2: c.a2, x1: 0, x2: 0, y1: 0, y2: 0 }; }) : null;
        return;
      }
      if (d.engaged !== undefined) { s.engaged = d.engaged; return; }
      if (d.bypass !== undefined) { s.bypass = d.bypass; return; }
      if (d.model) { s.applyModel(d.model); return; }
      // otherwise: audio buffer relayed from the worker
      for (let i = 0; i < d.length; i++) s.ring[(s.w++) & s.mask] = d[i];
      if (s.w - s.r > 11025) { s.r = s.w - 1600; s.rf = s.r; s.trims++; }
    };
  }

  _sections(n) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
    return a;
  }
  _load(dst, src) {                    // copy coeffs into pre-allocated sections; no alloc
    const n = src ? src.length : 0;
    for (let i = 0; i < n; i++) { const s = dst[i], c = src[i]; s.b0 = c.b0; s.b1 = c.b1; s.b2 = c.b2; s.a1 = c.a1; s.a2 = c.a2; }
    return n;
  }
  applyModel(m) {
    this.driveT = m.drive; this.auto = !!m.auto; if (!this.auto) this.makeupT = m.makeup;
    this.nlMode = m.nlMode | 0; this.nlTh = m.nlTh; this.nlKnee = m.nlKnee;
    this.hpN = this._load(this.hp, m.hp); this.resN = this._load(this.res, m.res);
    this.lpN = this._load(this.lp, m.lp); this.brkN = this._load(this.brk, m.brk);
    this.brkOn = !!(m.brk && m.brk.length);
    if (m.fir && m.os) {               // oversampling kernel (unity-DC LP), same for up/dn
      this.os = m.os | 0; this.firLen = m.fir.length;
      for (let i = 0; i < this.firLen; i++) { this.firUp[i] = m.fir[i]; this.firDn[i] = m.fir[i]; }
      this.upPos = 0; this.dnPos = 0;
      for (let i = 0; i < this.upBuf.length; i++) { this.upBuf[i] = 0; this.dnBuf[i] = 0; }
    } else { this.os = 1; }
  }

  _casc(sec, n, x) {                   // biquad cascade, Direct Form I
    for (let i = 0; i < n; i++) {
      const s = sec[i];
      const y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
      s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y; x = y;
    }
    return x;
  }
  _shape(x) {                          // memoryless nonlinearity
    const t = this.nlTh;
    if (this.nlMode === 1) return Math.tanh(x / t) * t;                    // soft
    if (this.nlMode === 2) {                                               // cubic
      let a = x / t; if (a > 1) a = 1; else if (a < -1) a = -1;
      return t * (a - a * a * a / 3) * 1.5;
    }
    if (this.nlMode === 3) {                                               // hard, soft-knee
      const k = this.nlKnee * t, ax = x < 0 ? -x : x;
      if (k < 1e-6 || ax <= t - k) { if (ax >= t) return x < 0 ? -t : t; return x; }
      if (ax >= t + k) return x < 0 ? -t : t;
      const over = ax - (t - k), y = ax - (over * over) / (4 * k);
      return x < 0 ? -y : y;
    }
    return x;                                                              // off
  }
  _fir(taps, buf, pos) {               // FIR over a circular delay line (newest at pos)
    let acc = 0, idx = pos; const L = this.firLen;
    for (let t = 0; t < L; t++) { acc += taps[t] * buf[idx]; idx = idx === 0 ? L - 1 : idx - 1; }
    return acc;
  }
  _osNL(x) {                           // oversampled nonlinearity: up → shape → down → decimate
    const N = this.os;
    if (N === 1) return this._shape(x);
    let outv = 0;
    for (let k = 0; k < N; k++) {
      const inp = (k === 0) ? x * N : 0;                                   // zero-stuff (×N keeps level)
      this.upBuf[this.upPos] = inp;
      const u = this._fir(this.firUp, this.upBuf, this.upPos);
      this.upPos = this.upPos === this.firLen - 1 ? 0 : this.upPos + 1;
      const ns = this._shape(u);
      this.dnBuf[this.dnPos] = ns;
      const dv = this._fir(this.firDn, this.dnBuf, this.dnPos);
      this.dnPos = this.dnPos === this.firLen - 1 ? 0 : this.dnPos + 1;
      if (k === N - 1) outv = dv;                                          // decimate
    }
    return outv;
  }

  process(inputs, outputs) {
    const out = outputs[0][0], n = out.length;
    if (!this.primed) { if (this.w - this.r < this.PRIME) { out.fill(0); this._rep(); return true; } this.primed = true; this.rf = this.r; }
    let x1 = this.x1, y1 = this.y1;
    const R = this.R, shR = this.shR, shG = this.shG, shOn = this.shOn, spk = this.spk;
    const engaged = this.engaged, wantMix = (engaged && !this.bypass) ? 1 : 0;
    if (this.drc) {
      const fill = this.w - this.rf, dev = Math.max(-1, Math.min(1, (fill - this.TARGET) / this.TARGET));
      this.ratio += ((1 + this.MAXDEV * dev) - this.ratio) * 0.05;
    }
    for (let i = 0; i < n; i++) {
      // ---- ring read (unchanged) ----
      let x;
      if (this.drc) {
        const ri = this.rf | 0;
        if (ri + 1 < this.w) { const a = this.ring[ri & this.mask], b = this.ring[(ri + 1) & this.mask]; x = a + (b - a) * (this.rf - ri); this.rf += this.ratio; if (!this.dcInit) { this.dcInit = true; x1 = x; } }
        else { x = x1; this.under++; }
      } else {
        if (this.r < this.w) { x = this.ring[(this.r++) & this.mask]; if (!this.dcInit) { this.dcInit = true; x1 = x; } }
        else { x = x1; this.under++; }
      }
      // ---- DC block (unchanged) ----
      const y = x - x1 + R * y1; x1 = x; y1 = y;
      // ---- legacy path L (unchanged math: preset chain, else shelf/dry) ----
      let L;
      if (spk) { let sv = y; for (let sc = 0; sc < spk.length; sc++) { const C = spk[sc]; const so = C.b0 * sv + C.b1 * C.x1 + C.b2 * C.x2 - C.a1 * C.y1 - C.a2 * C.y2; C.x2 = C.x1; C.x1 = sv; C.y2 = C.y1; C.y1 = so; sv = so; } L = sv; }
      else { const hp = y - this.yp + shR * this.hp1; this.yp = y; this.hp1 = hp; L = shOn ? (y + shG * hp) : y; }
      // ---- crossfade toward the model only when engaged ----
      this.mix += (wantMix - this.mix) * (1 - this.XF);
      let v;
      if (engaged || this.mix > 1e-4) {
        // model chain: drive → HP → resonance → NL(os) → LP → breakup → makeup
        this.drive += (this.driveT - this.drive) * (1 - this.GR);
        let sMod = this._casc(this.hp, this.hpN, y * this.drive);
        sMod = this._casc(this.res, this.resN, sMod);
        sMod = this._osNL(sMod);
        sMod = this._casc(this.lp, this.lpN, sMod);
        if (this.brkOn) sMod = this._casc(this.brk, this.brkN, sMod);
        // auto-makeup: match model RMS (pre-makeup) to the RAW (pre-shelf) DC-blocked signal y,
        // so Device stays independent of the brightness shelf (identical when shelf off, where L===y)
        const ax = sMod < 0 ? -sMod : sMod, aL = y < 0 ? -y : y;
        this.rmsMod += (ax * ax - this.rmsMod) * this.rmsC;
        this.rmsRef += (aL * aL - this.rmsRef) * this.rmsC;
        if (this.auto) { let g = Math.sqrt(this.rmsRef / (this.rmsMod + 1e-12)); if (g > 4) g = 4; else if (g < 0.25) g = 0.25; this.makeupT = g; }
        this.makeup += (this.makeupT - this.makeup) * (1 - this.GR);
        const M = sMod * this.makeup;
        v = this.mix * M + (1 - this.mix) * L;
      } else {
        v = L;                          // fully bypassed → exactly the legacy output
      }
      // ---- output (unchanged ×0.5 + hard clamp) + clip counter ----
      let o = v * 0.5;
      if (o > 1) { o = 1; this.clips++; } else if (o < -1) { o = -1; this.clips++; }
      out[i] = o;
    }
    if (this.drc) this.r = this.rf | 0;
    this.x1 = x1; this.y1 = y1;
    this._rep();
    return true;
  }
  _rep() { if ((this.rep++ & 3) === 0) this.port.postMessage({ r: this.r, u: this.under, t: this.trims, f: this.w - this.r, ratio: this.ratio, clips: this.clips }); }
}
registerProcessor('twin-sink', TwinSink);
`;

  // The pilot DEVICE speaker-model preset (buildModel(deviceMP) output, computed exactly at
  // SRC_RATE 22050): hp[2]/res[1]/lp[1]/brk[1] RBJ biquads, drive/makeup 1.0, soft NL, os:2 + unity FIR.
  var DEVICE_MODEL = { drive:1, makeup:1, auto:true, nlMode:1, nlTh:0.85, nlKnee:0.1,
    hp:[{b0:0.93604558,b1:-1.8720912,b2:0.93604558,a1:-1.8643746,a2:0.87980776},{b0:0.93967111,b1:-0.93967111,b2:0,a1:-0.87934223,a2:0}],
    res:[{b0:1.071979,b1:-1.764957,b2:0.78337764,a1:-1.764957,a2:0.85535667}],
    lp:[{b0:0.29184957,b1:0.58369915,b2:0.29184957,a1:-0.0041730068,a2:0.1715713}],
    brk:[{b0:0.78712237,b1:-1.0852891,b2:0.55298288,a1:-1.0852891,a2:0.34010526}],
    os:2, fir:[-0.0023200984,1.9266961e-18,0.0054240586,-4.6640041e-18,-0.01590096,9.269544e-18,0.038630295,-1.428109e-17,-0.089455216,1.810751e-17,0.31306928,0.50110528,0.31306928,1.810751e-17,-0.089455216,-1.428109e-17,0.038630295,9.269544e-18,-0.01590096,-4.6640041e-18,0.0054240586,1.9266961e-18,-0.0023200984] };

  function initAudio(){
    if (audioCtx){ if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { audioCtx = new AC({ sampleRate: SRC_RATE }); } catch(e){ audioCtx = new AC(); }
    var url = URL.createObjectURL(new Blob([WORKLET_SRC], { type:'application/javascript' }));
    audioCtx.audioWorklet.addModule(url).then(function(){
      audioNode = new AudioWorkletNode(audioCtx, 'twin-sink', { outputChannelCount:[1], processorOptions: { shR:_shR, shG:_shG, shOn:EQ_SHELF.on, hpR:_hpR } });
      audioNode.port.onmessage = function(e){ var d = e.data; if (d && d.r !== undefined) worker.postMessage({ wr: d.r }); };  // consumed count -> worker pacing
      audioNode.port.postMessage({ model: DEVICE_MODEL });   // Device transducer model = faithful + speaker model
      audioNode.port.postMessage({ engaged: true });         // engage by default -> the pilot Device sound
      audioGain = audioCtx.createGain();
      audioGain.gain.value = muted ? 0 : 1;                            // honour a mute chosen before audio init
      audioNode.connect(audioGain); audioGain.connect(audioCtx.destination);
      audioReady = true; worker.postMessage({ audioReady: true });
      URL.revokeObjectURL(url);
    }).catch(function(err){ console.log('[audio] worklet load failed', err); });
  }
  // (audio is armed by the Tap-to-play gesture in start(), below — not on any interaction)

  // Mute toggle — ramps the gain so muting/unmuting doesn't click.
  // Legacy legend Mute button (may be absent — the bottom .pcontrols legend was
  // removed now that the pill has a Mute button; guard every reference to it).
  var muteBtn = document.getElementById('mute');
  function setMuted(v){
    muted = v;
    if (audioGain) audioGain.gain.setTargetAtTime(muted ? 0 : 1, audioCtx.currentTime, 0.008);
    if (muteBtn){ muteBtn.textContent = muted ? '🔇 Muted' : '🔊 Sound on'; muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false'); }
  }
  if (muteBtn) muteBtn.addEventListener('click', function(){ initAudio(); setMuted(!muted); });

  // ---- input: forward button edges to the worker --------------------------
  var KEYMAP = {
    'Digit1':'game', 'Digit2':'time', 'Digit3':'pause',
    'ArrowUp':'up', 'ArrowDown':'down', 'ArrowLeft':'left', 'ArrowRight':'right',
    'KeyQ':'b', 'KeyE':'a', 'KeyP':'power',
    // Select/Start exist on Zelda only (its games are NES/GB titles); Mario's
    // shell has no such buttons and its firmware ignores these pins, so the
    // shared mapping is inert there. Bound to [ and ] (adjacent, near A/B).
    'BracketLeft':'select', 'BracketRight':'start'
  };
  function setBtn(name, down){
    if (!worker) return;
    worker.postMessage({ input: name, down: down });
    document.querySelectorAll('[data-btn="'+name+'"]').forEach(function(el){ el.classList.toggle('on', down); });
  }
  window.addEventListener('keydown', function(e){
    var b = KEYMAP[e.code]; if (b){ e.preventDefault(); if (!e.repeat) setBtn(b, true); }
  });
  window.addEventListener('keyup', function(e){
    var b = KEYMAP[e.code]; if (b){ e.preventDefault(); setBtn(b, false); }
  });
  document.querySelectorAll('[data-btn]').forEach(function(el){
    var name = el.getAttribute('data-btn');
    var down = function(e){ e.preventDefault(); setBtn(name, true); };
    var up   = function(e){ e.preventDefault(); setBtn(name, false); };
    el.addEventListener('mousedown', down); el.addEventListener('mouseup', up); el.addEventListener('mouseleave', up);
    el.addEventListener('touchstart', down, {passive:false}); el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
  });

  // Fade off the "Starting…" cover, revealing the screen. Triggered by whichever
  // comes first: the worker's {ready} (clock/game built at the cycle target) or
  // the first audio buffer below. The clock's own audio starts the instant the
  // clock is drawing, and it reaches us a beat before the cycle target does, so
  // uncovering on it makes the picture appear in sync with its sound instead of
  // ~1s behind it -- and sooner. Idempotent (tap is nulled after the first call).
  function revealScreen(){
    if (tap) { tap.classList.add('gone'); var _t = tap; tap = null; setTimeout(function(){ if (_t.parentNode) _t.parentNode.removeChild(_t); }, 340); }
  }
  // On Zelda the FIRST sound is the automatic TIME-press BEEP, which fires about a
  // second before the clock has finished building -- uncovering on it flashes the
  // pre-clock frame. So hold the black through that beep and reveal ~1s later,
  // landing on the finished clock while the beep still plays under the cover.
  // Mario's first sound already coincides with its clock, so it reveals at once.
  var _revealArmed = false;
  var _AUDIO_REVEAL_DELAY = (window.TWIN_UNIT === 'zelda') ? 1000 : 0;

  // ---- messages from the worker: audio buffers + status line ---------------
  function onWorkerMsg(e){
    var d = e.data; if (!d) return;
    if (d.saveResult) { _twinOnSaveResult(d.saveResult); return; }
    if (d.loadResult) { _twinOnLoadResult(d.loadResult); return; }
    if (d.saveError)  { _twinToast('Save failed: ' + d.saveError); return; }
    if (d.loadError)  { _twinToast('Load failed: ' + d.loadError); return; }
    if (d.ready) { revealScreen(); return; }   // clock/game built (cycle target) -> reveal
    if (d.needFw) { try { parent.postMessage({ tftNeedFw: d.needFw }, '*'); } catch (e2) {} return; }  // code-only build: ask the page for a content-pack firmware
    if (d.audio) {
      if (!_revealArmed) { _revealArmed = true; setTimeout(revealScreen, _AUDIO_REVEAL_DELAY); }  // first sound -> reveal (after a beat on Zelda)
      if (audioReady && audioNode) audioNode.port.postMessage(d.audio, [d.audio.buffer]);
    } else if (d.status) {
      var hh = ('0'+d.h).slice(-2), mm = ('0'+d.mi).slice(-2), ss = ('0'+d.s).slice(-2);
      var modes = d.wasm ? 'wasm' : 'JIT';
      statusEl.innerHTML = '<b>'+hh+':'+mm+':'+ss+'</b> · ' + (d.halted ? 'halted' : 'running') +
        ' · <b class="rt">'+d.pct+'% realtime</b> · <b>'+d.fps+'fps</b> <span style="opacity:.55">('+d.busy+'% cpu · '+modes+')</span>';
    }
  };

  // ---- Tap-to-play gate ----------------------------------------------------
  function start(){
    if (worker) return;
    // Keep the gate covering the screen (hide the firmware's boot/attract) and
    // switch it to a non-interactive "Starting…" cover; it's lifted when the
    // worker posts {ready} -- i.e. once the clock is built (see onWorkerMsg).
    if (tap) { tap.classList.add('starting'); tap.disabled = true; }   // plain black cover (contents hidden via CSS)
    var fw = window.TWIN_FW || 'retail';               // 'retail' (default) | 'custom'
    worker = new Worker('../twin-worker.js?v=20260811-keys1&unit=' + (window.TWIN_UNIT || 'mario') + '&fw=' + fw);
    worker.onmessage = onWorkerMsg;
    var off = canvas.transferControlToOffscreen();
    worker.postMessage({ canvas: off }, [off]);
    initAudio();                 // this tap is the gesture that arms audio
    // Custom firmware: tell the embedding page we're ready for the user's flash
    // images; it replies with a {customFw} message (see the relay listener below).
    if (fw === 'custom') { try { parent.postMessage({ tftCustomReady: true }, '*'); } catch (e) {} }
  }

  // Custom-firmware relay: only used in ?fw=custom mode. The embedding page reads
  // the user's two flash images and transfers them here; hand them straight to the
  // worker, which boots them. Ignored (no worker / not custom) otherwise.
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (d && d.customFw && worker) {
      try { worker.postMessage({ customFw: d.customFw }, [d.customFw.internal, d.customFw.external]); }
      catch (e) { worker.postMessage({ customFw: d.customFw }); }
    } else if (d && d.retailFw && worker) {            // content-pack retail firmware (base64) relayed from the page
      worker.postMessage({ retailFw: d.retailFw });
    }
  });
  var _tapStyle = document.createElement('style');
  _tapStyle.textContent =
    '.tap-to-play{position:absolute;left:29.1%;top:23.25%;width:41.9%;height:54.28%;'
    + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;'
    + 'background:rgba(4,6,10,.82);color:#fff;border:0;cursor:pointer;font:inherit;font-size:.8rem;'
    + 'letter-spacing:.1em;text-transform:uppercase;-webkit-tap-highlight-color:transparent;z-index:5;transition:opacity .34s ease}'
    + '.tap-to-play:hover{background:rgba(10,14,20,.78)}'
    + '.tap-to-play.starting,.tap-to-play.starting:hover{background:#000;cursor:default}'   // plain black -> fully hides the boot/attract behind it
    + '.tap-to-play.starting>*{visibility:hidden}'
    + '.tap-to-play.gone{opacity:0;pointer-events:none}'
    + '.tap-to-play .tap-icon{display:flex;align-items:center;justify-content:center;width:46px;height:46px;'
    + 'border:2px solid rgba(255,255,255,.85);border-radius:50%;font-size:18px}';
  document.head.appendChild(_tapStyle);
  var tap = document.createElement('button');
  tap.className = 'tap-to-play';
  tap.type = 'button';
  tap.setAttribute('aria-label', 'Insert batteries to start');
  tap.innerHTML = '<span class="tap-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="9" width="9.5" height="6" rx="2.4"/><rect x="4.5" y="6.8" width="3.5" height="2.3" rx="0.8"/><path d="M1.5 11.3h9.5"/><rect x="13" y="9" width="9.5" height="6" rx="2.4"/><rect x="16" y="14.9" width="3.5" height="2.3" rx="0.8"/><path d="M13 12.7h9.5"/></svg></span><span>Insert batteries to start</span>';
  tap.addEventListener('click', start);
  document.querySelector('.device').appendChild(tap);

  // ==========================================================================
  //  Pill toolbar (Saves · Pause · Mute) + Pause + IndexedDB save-states.
  //  Self-contained in this iframe, matching the other devices' overlay pill
  //  (visual target: #play-toolbar-pill in the site; template: Tetris Jr's
  //  #tj-toolbar). Rewind + Keys are intentionally omitted for the twin.
  // ==========================================================================
  var UNIT = window.TWIN_UNIT || 'mario';
  var SLOTS = 4;
  var _PAUSE_ICO = '<svg viewBox="0 0 24 24" style="fill:none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 5v14M16 5v14"/></svg>';
  var _PLAY_ICO  = '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>';

  var _pillStyle = document.createElement('style');
  _pillStyle.textContent =
    '#mute{display:none!important}'   // old legend Mute folded into the pill
    + '#twin-toolbar{position:fixed;top:8px;left:50%;transform:translateX(-50%);display:flex;justify-content:center;'
      + 'z-index:60;box-sizing:border-box;max-width:calc(100vw - 16px);overflow:hidden;'
      + 'background:rgba(16,18,22,.72);border:1px solid #2b3342;border-radius:999px;padding:4px 6px;'
      + '-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);transition:opacity .2s}'
    + '.twin-tb-controls{display:flex;gap:6px}'
    + '.twin-tb-back{display:none!important}'
    + '#twin-toolbar.sub-open .twin-tb-controls{display:none}'
    + '#twin-toolbar.sub-open .twin-tb-back{display:inline-flex!important}'
    + '.twin-tbtn{display:inline-flex;align-items:center;gap:5px;margin:0;white-space:nowrap;background:transparent;'
      + 'border:0;border-radius:999px;cursor:pointer;color:#cdd3e0;font:inherit;font-size:12px;line-height:1;'
      + 'padding:6px 11px;-webkit-tap-highlight-color:transparent}'
    + '.twin-tbtn:hover{background:rgba(205,214,230,.12)}'
    + '.twin-tbtn:active,.twin-tbtn.active{background:rgba(120,200,255,.20);color:#eaf3ff}'
    + '.twin-tbtn svg{width:14px;height:14px;fill:currentColor;display:block}'
    + '.twin-tbtn[disabled]{opacity:.4;cursor:default}'
    + '#twin-mute-ico{font-size:13px;line-height:1}'
    + '#twin-paused{position:fixed;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none;z-index:35}'
    + '#twin-paused .badge{background:rgba(16,18,22,.78);border:1px solid #3a4454;border-radius:10px;color:#e7eaf3;'
      + 'font-size:15px;letter-spacing:.18em;padding:10px 20px;box-shadow:0 8px 26px rgba(0,0,0,.5)}'
    + '#twin-saves{position:fixed;inset:0;display:none;flex-direction:column;z-index:50;background:linear-gradient(180deg,#11161f,#0a0e14);'
      + 'padding:52px 14px 14px;box-sizing:border-box;overflow:auto}'
    + '#twin-saves .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;align-items:start;max-width:760px;margin:0 auto;width:100%}'
    + '@media (max-width:560px){#twin-saves .grid{grid-template-columns:repeat(2,1fr)}}'
    + '.twin-slot{position:relative;border:1px solid #2b3342;border-radius:10px;background:#141821;cursor:pointer;'
      + 'display:flex;flex-direction:column;overflow:hidden;align-self:start;transition:border-color .14s,box-shadow .14s}'
    + '.twin-slot:hover{border-color:#4a5670}'
    + '.twin-slot.expanded{border-color:rgba(120,200,255,.55);box-shadow:0 10px 26px -14px rgba(0,0,0,.7)}'
    + '.twin-slot .thumb{position:relative;width:100%;height:108px;flex:0 0 auto;background:#0b0e13;border-bottom:1px solid #2b3342;overflow:hidden}'
    + '.twin-slot .thumb canvas{width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block}'
    + '.twin-slot .meta{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 8px;font-size:10.5px;color:#8b93a7}'
    + '.twin-slot .num{font-family:ui-monospace,Consolas,monospace;font-weight:800;color:#5a6478}'
    + '.twin-slot.empty{border-style:dashed;background:transparent}'
    + '.twin-slot.empty .thumb{background:repeating-linear-gradient(135deg,rgba(255,255,255,.02) 0 10px,transparent 10px 20px)}'
    + '.twin-slot .plus{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:32px;height:32px;'
      + 'border:2px dashed #3a4454;border-radius:50%;color:#5a6478;display:flex;align-items:center;justify-content:center;font-size:19px;line-height:1}'
    + '.twin-slot.empty:hover .plus{border-color:#6cc1ff;color:#6cc1ff}'
    + '.twin-slot .detail{display:none;border-top:1px solid #2b3342}'
    + '.twin-slot.expanded .detail{display:block}'
    + '.twin-slot .pad{padding:9px;display:flex;flex-direction:column;gap:8px}'
    + '.twin-slot .acts{display:flex;gap:7px}'
    + '.twin-slot .acts button{flex:1;justify-content:center;font:inherit;font-size:11.5px;font-weight:700;padding:6px 8px;'
      + 'border-radius:7px;border:1px solid #3a4454;background:#1a1f29;color:#e7eaf3;cursor:pointer;display:inline-flex;align-items:center;gap:4px}'
    + '.twin-slot .acts .load{border-color:rgba(120,200,255,.5);color:#bfe2ff}'
    + '.twin-slot .acts .load:hover{background:rgba(120,200,255,.12)}'
    + '.twin-slot .acts .del{border-color:rgba(224,107,93,.4);color:#f0b7af}'
    + '.twin-slot .acts .del:hover{background:rgba(224,107,93,.12)}'
    + '#twin-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(10px);z-index:70;'
      + 'background:rgba(24,30,40,.96);border:1px solid #3a4454;border-radius:8px;color:#eaf0f8;font-size:12px;'
      + 'padding:8px 16px;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none}'
    + '#twin-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}'
    // Controls (Keys) screen — an EMPTY flex-row panel the SHARED keys engine
    // (window.KeysDiagram) renders into (diagram + extras column), exactly like the
    // main site's #play-keys-panel. The engine's CSS uses --muted/--text/--accent/
    // --line/--bg-* theme vars, so define them here for the twin's dark theme.
    + '#twin-keys{position:fixed;inset:0;display:none;flex-direction:row;gap:16px;z-index:50;'
      // The EXACT classic #play-keys-panel background (gnw.js/_keysEnsureDom):
      // a subtle top->bottom gradient --bg-1(#11161f) -> --bg-0(#0a0e14). Matches
      // a classic device's Controls panel perfectly (a flat fill left the twin's
      // bottom lighter). The earlier top-center RADIAL gradient was the real bug.
      + 'background:linear-gradient(180deg,#11161f,#0a0e14);'
      + 'padding:54px 18px 18px;box-sizing:border-box;overflow:hidden;'
      // Theme vars matched EXACTLY to the main site (index.html :root, line ~172 +
      // the default --accent-d) so the borders/text/lit-accent read identical to a
      // classic device's Controls screen.
      + '--muted:#8a94a6;--text:#e7ecf2;--accent:#9be15d;--line:#2a3242;--bg-0:#0a0e14;--bg-1:#11161f}';
  document.head.appendChild(_pillStyle);

  var _tb = document.createElement('div');
  _tb.id = 'twin-toolbar'; _tb.setAttribute('role','toolbar'); _tb.setAttribute('aria-label','Play controls');
  _tb.innerHTML =
    '<div class="twin-tb-controls">'
    + '<button class="twin-tbtn" id="twin-save" aria-label="Save states"><svg viewBox="0 0 24 24" style="fill:none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/></svg>Saves</button>'
    + '<button class="twin-tbtn" id="twin-pause" aria-label="Pause" aria-pressed="false"><span id="twin-pause-ico">'+_PAUSE_ICO+'</span><span id="twin-pause-lbl">Pause</span></button>'
    + '<button class="twin-tbtn" id="twin-keys-btn" aria-label="Controls"><svg viewBox="0 0 24 24" style="fill:none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="2" width="7" height="7" rx="1.8"/><rect x="1" y="10.5" width="7" height="7" rx="1.8"/><rect x="8.5" y="10.5" width="7" height="7" rx="1.8"/><rect x="16" y="10.5" width="7" height="7" rx="1.8"/></svg>Keys</button>'
    + '<button class="twin-tbtn" id="twin-mute" aria-label="Mute" aria-pressed="false"><span id="twin-mute-ico">🔊</span><span id="twin-mute-lbl">Sound on</span></button>'
    + '</div>'
    + '<button class="twin-tbtn twin-tb-back" id="twin-back" aria-label="Back to game"><svg viewBox="0 0 24 24" style="fill:none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back</button>';
  document.body.appendChild(_tb);

  var _paused = document.createElement('div');
  _paused.id = 'twin-paused'; _paused.innerHTML = '<div class="badge">PAUSED</div>';
  document.body.appendChild(_paused);

  var _saves = document.createElement('div');
  _saves.id = 'twin-saves'; _saves.setAttribute('aria-hidden','true');
  _saves.innerHTML = '<div class="grid" id="twin-saves-grid"></div>';
  document.body.appendChild(_saves);

  var _keys = document.createElement('div');   // Controls screen — filled by KeysDiagram.render
  _keys.id = 'twin-keys'; _keys.setAttribute('aria-hidden','true');
  document.body.appendChild(_keys);

  var _toast = document.createElement('div');
  _toast.id = 'twin-toast';
  document.body.appendChild(_toast);

  var _byId = function(id){ return document.getElementById(id); };
  var _toastTimer = null;
  function _twinToast(msg){
    _toast.textContent = msg; _toast.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function(){ _toast.classList.remove('show'); }, 1900);
  }

  // ---- Pause -------------------------------------------------------------
  // Two INDEPENDENT freeze sources, mirroring the classic _saveFreeze/_saveThaw
  // guard in gnw.js: `userPause` is the explicit Pause pill; `savesFreeze` is the
  // transparent freeze while the Saves overlay is open. The worker runs only when
  // NEITHER is active. `savesFreeze` never touches the Pause pill visuals/badge.
  var userPause = false, savesFreeze = false, savesOpen = false, _workerPaused = false;
  var keysFreeze = false, keysOpen = false;
  function _applyPause(){
    var want = userPause || savesFreeze || keysFreeze;   // run only when NEITHER overlay-freeze NOR explicit pause is active
    if (want === _workerPaused) return;
    _workerPaused = want;
    if (worker) worker.postMessage(want ? { pause:1 } : { resume:1 });
    if (audioCtx){ try { want ? audioCtx.suspend() : (muted ? 0 : audioCtx.resume()); } catch(e){} }
  }
  function setUserPause(on){
    if (!worker) return;
    userPause = on;
    _byId('twin-pause-ico').innerHTML = on ? _PLAY_ICO : _PAUSE_ICO;
    _byId('twin-pause-lbl').textContent = on ? 'Resume' : 'Pause';
    _byId('twin-pause').classList.toggle('active', on);
    _byId('twin-pause').setAttribute('aria-pressed', on ? 'true' : 'false');
    _paused.style.display = on ? 'flex' : 'none';     // badge reflects the EXPLICIT pause only
    _applyPause();
  }
  _byId('twin-pause').addEventListener('click', function(){ if (!worker){ _twinToast('Insert batteries first'); return; } setUserPause(!userPause); });

  // ---- Mute (folded into the pill; reuses the existing setMuted) ---------
  function _twinSyncMute(){
    _byId('twin-mute-ico').textContent = muted ? '🔇' : '🔊';
    _byId('twin-mute-lbl').textContent = muted ? 'Muted' : 'Sound on';
    _byId('twin-mute').setAttribute('aria-pressed', muted ? 'true' : 'false');
  }
  _byId('twin-mute').addEventListener('click', function(){ initAudio(); setMuted(!muted); _twinSyncMute(); });

  // ---- Saves overlay (morphs the pill into "Back") -----------------------
  // Opening the grid TRANSPARENTLY freezes the machine (so the state the user is
  // saving/loading is not a moving target); closing thaws it — unless the user
  // also hit the explicit Pause, in which case _applyPause keeps it frozen.
  function _setSavesOpen(open){
    if (open && keysOpen) _setKeysOpen(false);          // overlays are mutually exclusive
    savesOpen = open;
    _saves.style.display = open ? 'flex' : 'none';
    _saves.setAttribute('aria-hidden', open ? 'false' : 'true');
    _tb.classList.toggle('sub-open', open || keysOpen);
    savesFreeze = open;
    _applyPause();
    if (open) _renderSaves();
  }
  _byId('twin-save').addEventListener('click', function(){ if (!worker){ _twinToast('Insert batteries first'); return; } _setSavesOpen(true); });

  // ---- Keys / Controls overlay (shared KeysDiagram engine) ----------------
  // The twin's REAL control set + key map, sourced verbatim from this harness's
  // own KEYMAP and the .pcontrols legend in mario/zelda index.html:
  //   Game=1  Time=2  Pause=3  Move=arrows  B=Q  A=E  Power=P (keyboard-only)
  //   Zelda additionally: Select=C  Start=V
  // Rendered through the SAME window.KeysDiagram module as every other device.
  // Hotspot geometry mirrors the real artwork button positions (D-pad bottom-left
  // as a btn1..4 cross the engine folds into one D-pad; A/B round buttons bottom-
  // right; Game/Time/Pause operational pills top-right column).
  // The def is a compact SCHEMATIC (not overlaid on the artwork): the `screen`
  // rect covers the twin's LCD band, which KeysDiagram._keysLayout uses to
  // COLLAPSE the dead space between clusters (same mechanism DK-52 et al. use),
  // so the D-pad, A/B and the Game/Time/Pause pills pack tight with no big empty
  // middle. Buttons are sized larger for the DK-52-like look.
  var TWIN_KEYS_GAME = {
    screen: { left:29.1, top:23.25, width:41.9, height:54.28 },   // real LCD rect -> squeezed out of the diagram
    hotspots: {
      btn2: { left:9,  top:58, width:9,  height:9 },    // up      \
      btn4: { left:9,  top:76, width:9,  height:9 },    // down     > btn1..4 form a cross -> ONE D-pad
      btn3: { left:2,  top:67, width:9,  height:9 },    // left     |
      btn1: { left:16, top:67, width:9,  height:9 },    // right   /
      hit:  { left:74, top:63, width:12, height:12 },   // B (left round button)
      jump: { left:87, top:63, width:12, height:12 },   // A (right round button)
      gameA:{ left:78, top:8,  width:12, height:7 },    // Game  \
      time: { left:78, top:20, width:12, height:7 },    // Time   > operational pill column
      gameB:{ left:78, top:32, width:12, height:7 }     // Pause /
    }
  };
  var TWIN_KEYS_META = {
    gameA: { label:'Game',  keys:['1'] },
    time:  { label:'Time',  keys:['2'] },
    gameB: { label:'Pause', keys:['3'] },
    hit:   { label:'B',     keys:['Q'] },
    jump:  { label:'A',     keys:['E'] }
  };
  // Zelda ALSO has Select (C) and Start (V) in its KEYMAP (Mario's shell has
  // neither) — add them as real controls, not just extras. KeysDiagram only
  // admits buttons whose names exist in its BUTTON_META, so Select/Start reuse
  // the engine's `open`/`fire` action-button slots, placed under A/B so the
  // collapsed layout stays tight.
  if (UNIT === 'zelda') {
    // Select sits directly ABOVE B (hit), Start directly ABOVE A (jump): same
    // horizontal centre and the SAME WIDTH as B/A (left:74/87 width:12), but a
    // SHORTER height (~58%) so the engine's border-radius:9999px renders them as
    // horizontal PILLS (like the Game/Time/Pause operational pills), not circles.
    TWIN_KEYS_GAME.hotspots.open = { left:74, top:50, width:12, height:7 };   // Select — pill above B
    TWIN_KEYS_GAME.hotspots.fire = { left:87, top:50, width:12, height:7 };   // Start  — pill above A
    TWIN_KEYS_META.open = { label:'Select', keys:['['] };
    TWIN_KEYS_META.fire = { label:'Start',  keys:[']'] };
  }
  var TWIN_KEYS_EXTRA = '<span><b>P</b> Power</span>';   // Power is keyboard-only on both units
  function _setKeysOpen(open){
    if (open && savesOpen) _setSavesOpen(false);        // overlays are mutually exclusive
    keysOpen = open;
    _keys.style.display = open ? 'flex' : 'none';
    _keys.setAttribute('aria-hidden', open ? 'false' : 'true');
    _tb.classList.toggle('sub-open', open || savesOpen);
    keysFreeze = open;
    _applyPause();
    if (open && window.KeysDiagram){
      window.KeysDiagram.render(_keys, { game:TWIN_KEYS_GAME, gameKey:UNIT, ar:1,
        meta:TWIN_KEYS_META, override:{}, extra:TWIN_KEYS_EXTRA });   // no actionCircle: keep Select/Start as pills (wider than tall)
      window.KeysDiagram.fit(_keys);
      window.KeysDiagram.attachInput(_keys);
    } else if (!open && window.KeysDiagram){
      window.KeysDiagram.detachInput();
    }
  }
  _byId('twin-keys-btn').addEventListener('click', function(){ if (!worker){ _twinToast('Insert batteries first'); return; } if (!window.KeysDiagram){ _twinToast('Controls unavailable'); return; } _setKeysOpen(true); });
  window.addEventListener('resize', function(){ if (keysOpen && window.KeysDiagram) window.KeysDiagram.fit(_keys); });

  // Toolbar Back / Escape — return from whichever overlay is open.
  _byId('twin-back').addEventListener('click', function(){ if (savesOpen) _setSavesOpen(false); else if (keysOpen) _setKeysOpen(false); });
  window.addEventListener('keydown', function(e){ if (e.code === 'Escape'){ if (savesOpen){ e.preventDefault(); _setSavesOpen(false); } else if (keysOpen){ e.preventDefault(); _setKeysOpen(false); } } });

  // ---- IndexedDB: a save is ~2.5 MB, over localStorage quota --------------
  var DB_NAME = 'twin-saves', STORE = 'saves', _db = null;
  function idbOpen(){
    return new Promise(function(res, rej){
      if (_db) return res(_db);
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function(){ var db = rq.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath:'id' }); };
      rq.onsuccess = function(){ _db = rq.result; res(_db); };
      rq.onerror = function(){ rej(rq.error); };
    });
  }
  function _key(slot){ return UNIT + ':' + slot; }
  function idbPut(rec){ return idbOpen().then(function(db){ return new Promise(function(res,rej){ var tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(rec); tx.oncomplete=function(){res();}; tx.onerror=function(){rej(tx.error);}; }); }); }
  function idbGet(slot){ return idbOpen().then(function(db){ return new Promise(function(res,rej){ var tx=db.transaction(STORE,'readonly'); var rq=tx.objectStore(STORE).get(_key(slot)); rq.onsuccess=function(){res(rq.result||null);}; rq.onerror=function(){rej(rq.error);}; }); }); }
  function idbDel(slot){ return idbOpen().then(function(db){ return new Promise(function(res,rej){ var tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).delete(_key(slot)); tx.oncomplete=function(){res();}; tx.onerror=function(){rej(tx.error);}; }); }); }
  function idbAll(){ return idbOpen().then(function(db){ return new Promise(function(res,rej){ var tx=db.transaction(STORE,'readonly'); var rq=tx.objectStore(STORE).getAll(); rq.onsuccess=function(){ var m={}, a=rq.result||[]; for (var i=0;i<a.length;i++){ if (a[i].unit===UNIT) m[a[i].slot]=a[i]; } res(m); }; rq.onerror=function(){rej(rq.error);}; }); }); }

  var _slotMeta = {};   // slot -> {time, note} (thumbnails drawn straight from records)
  function _thumbCanvas(thumb){
    var c = document.createElement('canvas'); c.width = thumb.w; c.height = thumb.h;
    var g = c.getContext('2d');
    var rgba = (thumb.rgba instanceof Uint8ClampedArray) ? thumb.rgba : new Uint8ClampedArray(thumb.rgba.buffer ? thumb.rgba.buffer : thumb.rgba);
    g.putImageData(new ImageData(rgba, thumb.w, thumb.h), 0, 0);
    return c;
  }
  var _expanded = -1;
  function _renderSaves(){
    idbAll().then(function(map){
      var grid = _byId('twin-saves-grid'); grid.innerHTML = '';
      for (var s=0; s<SLOTS; s++){
        (function(slot){
          var rec = map[slot];
          var card = document.createElement('div');
          card.className = 'twin-slot' + (rec ? '' : ' empty') + (_expanded===slot && rec ? ' expanded' : '');
          if (rec){
            var thumbWrap = document.createElement('div'); thumbWrap.className = 'thumb';
            try { if (rec.thumb) thumbWrap.appendChild(_thumbCanvas(rec.thumb)); } catch(e){}
            var when = rec.time ? new Date(rec.time) : null;
            var wtxt = when ? (('0'+when.getHours()).slice(-2)+':'+('0'+when.getMinutes()).slice(-2)+' '+(when.getMonth()+1)+'/'+when.getDate()) : '';
            var meta = document.createElement('div'); meta.className = 'meta';
            meta.innerHTML = '<span class="num">SLOT '+(slot+1)+'</span><span>'+wtxt+'</span>';
            var detail = document.createElement('div'); detail.className = 'detail';
            detail.innerHTML = '<div class="pad"><div class="acts"><button class="load">Load</button><button class="del">Delete</button></div></div>';
            card.appendChild(thumbWrap); card.appendChild(meta); card.appendChild(detail);
            card.addEventListener('click', function(ev){ if (ev.target.closest('.acts')) return; _expanded = (_expanded===slot ? -1 : slot); _renderSaves(); });
            detail.querySelector('.load').addEventListener('click', function(){ _loadSlot(slot); });
            detail.querySelector('.del').addEventListener('click', function(){ idbDel(slot).then(function(){ _expanded=-1; _twinToast('Deleted slot '+(slot+1)); _renderSaves(); }); });
          } else {
            var t2 = document.createElement('div'); t2.className = 'thumb'; t2.innerHTML = '<div class="plus">+</div>';
            var m2 = document.createElement('div'); m2.className = 'meta';
            m2.innerHTML = '<span class="num">SLOT '+(slot+1)+'</span><span>Save</span>';
            card.appendChild(t2); card.appendChild(m2);
            card.addEventListener('click', function(){ _saveSlot(slot); });
          }
          grid.appendChild(card);
        })(s);
      }
    });
  }

  function _saveSlot(slot){ if (!worker){ _twinToast('Insert batteries first'); return; } worker.postMessage({ save:{ slot:slot } }); _twinToast('Saving slot '+(slot+1)+'…'); }
  function _twinOnSaveResult(res){
    var rec = { id:_key(res.slot), unit:res.unit, slot:res.slot, snap:res.snap, thumb:res.thumb, time:res.time };
    idbPut(rec).then(function(){ _twinToast('Saved to slot '+(res.slot+1)); if (savesOpen) _renderSaves(); })
      .catch(function(err){ _twinToast('Save failed: '+(err&&err.message||err)); });
  }
  function _loadSlot(slot){
    idbGet(slot).then(function(rec){
      if (!rec || !rec.snap){ _twinToast('Slot '+(slot+1)+' is empty'); return; }
      // The machine is already frozen (the grid is open); restore is applied to
      // the frozen state and the resume happens on overlay-close (below) unless
      // the user explicitly paused. No force-resume here.
      worker.postMessage({ load:{ snap:rec.snap, slot:slot } });   // structured-clone copy (IDB record stays intact)
      _twinToast('Loading slot '+(slot+1)+'…');
    });
  }
  function _twinOnLoadResult(res){ if (res && res.ok){ _twinToast('Loaded slot '+(res.slot+1)); _setSavesOpen(false); } }
})();
