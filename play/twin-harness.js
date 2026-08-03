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
  var muteBtn = document.getElementById('mute');
  function setMuted(v){
    muted = v;
    if (audioGain) audioGain.gain.setTargetAtTime(muted ? 0 : 1, audioCtx.currentTime, 0.008);
    muteBtn.textContent = muted ? '🔇 Muted' : '🔊 Sound on';
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }
  muteBtn.addEventListener('click', function(){ initAudio(); setMuted(!muted); });

  // ---- input: forward button edges to the worker --------------------------
  var KEYMAP = {
    'Digit1':'game', 'Digit2':'time', 'Digit3':'pause',
    'ArrowUp':'up', 'ArrowDown':'down', 'ArrowLeft':'left', 'ArrowRight':'right',
    'KeyQ':'b', 'KeyE':'a', 'KeyP':'power',
    // Select/Start exist on Zelda only (its games are NES/GB titles); Mario's
    // shell has no such buttons and its firmware ignores these pins, so the
    // shared mapping is inert there.
    'KeyC':'select', 'KeyV':'start'
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
    worker = new Worker('../twin-worker.js?v=20260730-pack1&unit=' + (window.TWIN_UNIT || 'mario') + '&fw=' + fw);
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
})();
