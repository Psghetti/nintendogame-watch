/* twin-worker.js — runs the ENTIRE ARM twin (cpu + bus + peripherals + WASM core)
   off the main thread. Emulation, pacing, and rendering (via an OffscreenCanvas
   transferred from the page) all live here, so a CPU burst (e.g. sprite
   decompression) never blocks the page's paint/input.

   PORTABLE BY DESIGN: nothing here hard-codes a parent folder. The engine,
   per-unit firmware, and (for custom mode) the flash images are all referenced
   RELATIVE to this worker's own URL, so this file works unchanged wherever it
   is placed — play/ (production), pilot/ (dev sandbox), or a distributed copy.

   Selected via the worker URL:
     ?unit=mario|zelda   which device — retail firmware + clock-boot timing per unit
     ?fw=retail          (default) boot the baked-in retail firmware for that unit
        =custom          load only the engine, then WAIT for the page to relay
                         user-supplied flash images ({customFw:{internal,external}})
                         and boot those (a retro-go / homebrew STM32H7B0 build)

   Message protocol (main <-> worker):
     main -> worker : {canvas}          transfer the OffscreenCanvas (once)
                      {input,down}      a button edge
                      {audioReady:bool} audio armed / suspended on the page
                      {wr:n}            worklet-consumed sample count (pacing)
                      {customFw:{internal,external}}  user firmware (custom mode)
     worker -> main : {status,...}      ~2 Hz status snapshot for the status line
                      {audio:Float32Array} one published audio buffer (relayed)
                      {ready:1}         clock/game built — page may reveal the screen
                      {awaitingCustom:1} custom mode is loaded and waiting for firmware
                      {fwError:msg}     custom firmware failed to boot
*/
'use strict';
self.window = self;                                  // firmware_*.js / twin.js assign to window.*
var _params = new URLSearchParams(self.location.search || '');
var _unit  = _params.get('unit') || 'mario';
var FWMODE = (_params.get('fw') === 'custom') ? 'custom' : 'retail';
// Two engines, both loaded relative to this worker:
//   twin.js      — the production engine with the Mario + Zelda retail clock-boot.
//   twin-cfw.js  — adds retro-go / homebrew (custom firmware) boot support. It's a
//                  separate file because that build regresses Zelda's retail boot,
//                  so retail (both units) stays on twin.js and only custom uses it.
var TWINV  = 'twin.js?v=20260811-keys1';
var CFWV   = 'twin-cfw.js?v=20260727-selstart';

var _UNITS = {
  mario: { fw: 'mario/firmware_mario.js', key: 'mario' },
  zelda: { fw: 'zelda/firmware_zelda.js', key: 'zelda' }
};
var _cfg = _UNITS[_unit] || _UNITS.mario;

// The harness keeps a cover over the screen until we post {ready} (clock/game
// built), so the firmware's boot/attract is never shown. Retail Zelda's clock
// builds ~96M cycles in (after the scripted TIME press); Mario and custom
// (retro-go) reach a first frame much sooner.
var _READY_CYCLES = (FWMODE === 'retail' && _cfg.key === 'zelda') ? 115000000 : 15000000;
var _readyPosted = false;

// ---- machine + shared state (assigned by the mode-specific boot below) -----
var AT, cpu, bus, periph, machine = null;
var octx = null, img = null, _pendingCanvas = null;
var bootWall = performance.now();
var audioReady = false, samplesSent = 0, workletR = 0, drcOn = false;
// ---- emulator Pause + Save-state runtime state -----------------------------
// paused halts the whole worker loop (cpu.run stops); the on-screen clock must
// NOT advance across a pause, so on resume we shift bootWall by the paused wall
// time (see the resume handler) and never recompute rtcCPS while paused.
var paused = false, _pauseWall = 0;
var _pendingSave = null;                 // slot number awaiting a safe-boundary capture, or null

function applyCanvas(canvas){ octx = canvas.getContext('2d', { alpha:false }); img = octx.createImageData(320, 240); }

function setupCommon(){                               // wiring shared by every boot path
  periph.rtcBaseMs = Date.now();
  periph.rtcCPS = 16000000;                           // seed; recalibrated live below
  periph.wakeStandby = true;
  periph.pressPower = true; periph.pwrPressStart = 2000000; periph.pwrPressEnd = 4000000;
  periph.input = { power:false, time:false, game:false, a:false, b:false, up:false, down:false, left:false, right:false, pause:false, select:false, start:false };
  periph.logging = false;
  periph.onAudioSample = function(samples, count){    // relay published buffers to the page's worklet
    if (!audioReady) return;
    var f = new Float32Array(count);
    for (var i=0;i<count;i++) f[i] = (samples[i] - 1400) / 2800;   // unipolar ~1400-center int16 -> ~±0.5 float
    samplesSent += count;
    self.postMessage({ audio: f }, [f.buffer]);
  };
  if (_pendingCanvas) { applyCanvas(_pendingCanvas); _pendingCanvas = null; }
}

// Retail: the dumped, baked-in firmware for this unit (firmware_<unit>.js).
function bootRetail(){
  var FW = self.__ARM_FW[_cfg.key];
  var fw = { internal: AT.b64ToBytes(FW.internal), external: AT.b64ToBytes(FW.external) };
  var m = AT.loadUnit(fw, { axiSramMB: 2 });
  machine = m; cpu = m.cpu; bus = m.bus; periph = m.periph;
  setupCommon();
  // Zelda cold-boots to a "PRESS TIME BUTTON" attract and only advances to the
  // clock on a fresh TIME falling edge (firmware starts watching ~48.4M in).
  if (_cfg.key === 'zelda') { periph.pressTime = true; periph.timePressStart = 52000000; periph.timePressEnd = 60000000; }
  cpu.reset(); bootWall = performance.now(); pump();
}

// Custom: user-supplied flash images (internal + external) — a retro-go / homebrew
// STM32H7B0 build. Same board; external flash is plain (OTFDEC never enabled).
function bootCustom(internal, external){
  var m = AT.loadUnit({ internal: internal, external: external }, { unit:'retrogo', axiSramMB: 2, usbPower: false });
  machine = m; cpu = m.cpu; bus = m.bus; periph = m.periph;
  periph._retrogo = true;                             // GPIO model: PC5 = TIME button (not VBUS)
  setupCommon();
  cpu.reset(); bootWall = performance.now(); pump();
}

// ---- render (OffscreenCanvas, wired when the page transfers it) ------------
function render(){
  if (!octx || !cpu) return;
  AT.composeFrame(bus, periph, { w:320, h:240, rgba: img.data });
  octx.putImageData(img, 0, 0);
}

// Downscale the current 320x240 RGBA framebuffer to a small save-slot thumbnail
// (nearest-neighbour; no DOM rasterisation). Returns { w, h, rgba:Uint8Array }.
function makeThumb(){
  if (!img) return null;
  var sw = 320, sh = 240, dw = 96, dh = 72, src = img.data, dst = new Uint8Array(dw*dh*4);
  for (var y=0; y<dh; y++){
    var sy = (y*sh/dh) | 0;
    for (var x=0; x<dw; x++){
      var sx = (x*sw/dw) | 0, si = (sy*sw+sx)*4, di = (y*dw+x)*4;
      dst[di] = src[si]; dst[di+1] = src[si+1]; dst[di+2] = src[si+2]; dst[di+3] = 255;
    }
  }
  return { w:dw, h:dh, rgba:dst };
}

// Fulfil a queued save at a SAFE boundary: we're between cpu.run() slices; also
// require no DMA2D blit mid-flight (dma2dDueCycle==0) so the snapshot never
// catches a half-finished Chrom-ART transfer. Retries next tick if not clean.
function doPendingSave(){
  if (_pendingSave == null || !cpu || !machine || !AT.snapshot) return;
  if (cpu.dma2dDueCycle !== 0) {
    // A DMA2D completion is scheduled. Its pixels are already moved (the model
    // blits synchronously on CR.START); only the completion IRQ is pending.
    if (!paused) return;                             // running: just wait for the next clean pump tick
    var cb = cpu.dma2dCallback;                      // frozen: no tick will advance us -> deliver the
    cpu.dma2dCallback = null; cpu.dma2dDueCycle = 0;  // completion NOW so its IRQ is captured, not dropped
    if (cb) { try { cb(); } catch (e) {} }
  }
  var slot = _pendingSave; _pendingSave = null;
  var snap;
  try { snap = AT.snapshot(machine); }
  catch (err){ self.postMessage({ saveError: String((err && err.message) || err), slot: slot }); return; }
  render();                                          // freshen the framebuffer for the thumbnail
  var thumb = makeThumb();
  var transfer = [];
  for (var i=0; i<snap.regions.length; i++) transfer.push(snap.regions[i].bytes.buffer);
  if (thumb) transfer.push(thumb.rgba.buffer);
  self.postMessage({ saveResult: { slot: slot, unit: _cfg.key, snap: snap, thumb: thumb, time: Date.now() } }, transfer);
}

// ---- run loop (paced emulation) — identical pacing to the single-thread build
var SLICE_CYCLES = 200000, RING_TARGET = 2600;   // ~118ms audio buffer: absorbs burstier 60fps production + the worker->main->worklet relay
var _lastT = performance.now(), _target = 0, _emuBusy = 0, wallFallbacks = 0;
var mc = new MessageChannel();
function realHz(){ return (periph && periph.coreClockHz && cpu.ipc) ? (periph.coreClockHz / cpu.ipc) : 61.1e6; }

// render cadence (adaptive: aim for 60fps; fall back to 30fps only near saturation)
var RENDER_MS = 1000/60, _lastRender = -1e9, fpsT = performance.now(), lastCyc = 0;
function renderTick(){
  var now = performance.now();
  if (!_readyPosted && cpu && cpu.cycles >= _READY_CYCLES) { _readyPosted = true; self.postMessage({ ready: 1 }); }  // built -> harness may reveal
  if (now - _lastRender >= RENDER_MS) { render(); _lastRender = now; }
  var wallSec = (now - bootWall) / 1000;
  if (wallSec > 0.5 && cpu.cycles > 0) periph.rtcCPS = cpu.cycles / wallSec;
  if (now - fpsT > 500) {
    var win = now - fpsT;
    var cps = (cpu.cycles - lastCyc) / (win / 1000);
    var busy = _emuBusy / win; _emuBusy = 0;
    if (busy > 0.85) RENDER_MS = 1000/30;            // near-saturated -> protect the emulator, drop to 30fps
    else if (busy < 0.78) RENDER_MS = 1000/60;       // headroom -> 60fps (hysteresis gap 0.78..0.85)
    lastCyc = cpu.cycles; fpsT = now;
    var rHz = (periph.coreClockHz && cpu.ipc) ? (periph.coreClockHz / cpu.ipc) : 61.1e6;
    var t = periph._rtcDate ? periph._rtcDate() : new Date();
    self.postMessage({ status:1, halted:cpu.halted, pct:Math.round(cps/rHz*100), fps:Math.round(1000/RENDER_MS),
      busy:Math.round(busy*100), wasm:!!cpu._wasmRun, audioReady:audioReady, fw:FWMODE,
      h:t.getHours(), mi:t.getMinutes(), s:t.getSeconds() });
  }
}

// Single-schedule guard: exactly one pump is ever queued (immediate via the
// MessageChannel, or a delayed setTimeout). Prevents two concurrent pump chains
// after a pause/resume — which would double the emulation rate and the clock.
var _pumpQueued = false;
function queuePump(delayMs){
  if (_pumpQueued) return;
  _pumpQueued = true;
  if (delayMs <= 0) mc.port2.postMessage(0); else setTimeout(pump, delayMs);
}

function pump(){
  _pumpQueued = false;
  if (paused){ doPendingSave(); queuePump(60); return; }   // paused: idle tick (allows a save), NO emulation, NO clock advance
  renderTick();                                      // keep the frame moving every scheduler turn
  doPendingSave();
  if (!cpu || cpu.halted) return;
  var now = performance.now();
  var CPS = realHz();
  if (audioReady && !drcOn) {                        // latency lock: ±2% nudge to hold the audio ring at RING_TARGET
    var adj = (RING_TARGET - (samplesSent - workletR)) / 66000;
    if (adj > 0.02) adj = 0.02; else if (adj < -0.02) adj = -0.02;
    CPS *= 1 + adj;
  }
  var dt = (now - _lastT) / 1000; _lastT = now;
  if (dt > 0.25) dt = 0;                             // long gap (tab stall) -> resume, don't fast-forward
  _target += dt * CPS;
  if (_target - cpu.cycles > 0.25 * CPS) { _target = cpu.cycles + 0.05 * CPS; wallFallbacks++; }  // load spike -> drop debt
  if (cpu.cycles >= _target) { queuePump(3); return; }        // caught up -> one short timer
  while (!cpu.halted && cpu.cycles < _target && (performance.now() - now) < 8) { cpu.run(cpu.cycles + SLICE_CYCLES); }
  _emuBusy += performance.now() - now;
  if (!cpu.halted) queuePump(0);                     // behind -> re-post immediately
}
mc.port1.onmessage = pump;

// ---- messages from the page ------------------------------------------------
self.onmessage = function(e){
  var d = e.data; if (!d) return;
  if (d.canvas) {
    applyCanvas(d.canvas);                            // canvas is independent of the machine; safe before boot
  } else if (d.input !== undefined) {
    if (periph && d.input in periph.input) { periph.input[d.input] = d.down; periph.markInputDirty(); }
  } else if (d.audioReady !== undefined) {
    audioReady = d.audioReady;
  } else if (d.wr !== undefined) {
    workletR = d.wr;
  } else if (d.pause) {                               // emulator Pause: halt the whole loop, freeze the clock
    if (!paused) { paused = true; _pauseWall = performance.now(); }
  } else if (d.resume) {                              // resume: re-anchor timing so the clock does NOT jump
    if (paused) {
      var gap = performance.now() - _pauseWall;
      bootWall += gap;                                // exclude the paused wall-time from the RTC mapping (rtcCPS=cycles/wallSec)
      var nowR = performance.now();
      _lastT = nowR;                                  // don't let dt spike on the first post-resume slice
      _target = cpu ? cpu.cycles : 0;                 // don't fast-forward the accumulated debt
      fpsT = nowR; lastCyc = cpu ? cpu.cycles : 0; _lastRender = nowR;
      paused = false;
      queuePump(0);                                   // ensure the loop is running (no-op if already queued)
    }
  } else if (d.save) {                                // request a save-state capture (fulfilled at the next safe boundary)
    _pendingSave = (d.save.slot != null) ? d.save.slot : 0;
    if (paused) doPendingSave();                      // frozen (Saves overlay): capture the at-rest state immediately
  } else if (d.load) {                                // restore a save-state, then re-anchor the clock to the restored cycles
    if (cpu && machine && AT.restore && d.load.snap) {
      var ok = false;
      try { ok = AT.restore(machine, d.load.snap); }
      catch (err) { self.postMessage({ loadError: String((err && err.message) || err), slot: d.load.slot }); }
      if (ok) {
        var nowL = performance.now(), sn = d.load.snap;
        // Make the clock resume showing the snapshot's time and tick forward in
        // real time: pick bootWall so wallSec == cycles/rtcCPS at this instant,
        // which keeps _rtcDate == rtcBaseMs + wallSec*1000 continuous.
        var rtcCPS = (sn.periph && sn.periph.rtcCPS) ? sn.periph.rtcCPS : (periph.rtcCPS || 16000000);
        bootWall = nowL - (cpu.cycles / rtcCPS) * 1000;
        _lastT = nowL; _target = cpu.cycles; fpsT = nowL; lastCyc = cpu.cycles; _lastRender = nowL - 1e9;
        if (paused) _pauseWall = nowL;                 // frozen load: measure the eventual resume-gap from HERE,
                                                       // so bootWall (just re-anchored) isn't double-shifted on thaw
        _readyPosted = true;                          // already past the reveal gate
        render();
        self.postMessage({ loadResult: { slot: d.load.slot, ok: true } });
        if (!paused) queuePump(0);
      }
    }
  } else if (d.customFw) {                            // custom mode: user firmware relayed by the page -> boot it now
    if (AT && !cpu) {
      try { bootCustom(new Uint8Array(d.customFw.internal), new Uint8Array(d.customFw.external)); }
      catch (err) {
        self.postMessage({ status:1, halted:true, fps:0, pct:0, busy:0, wasm:false, fw:'custom', h:0, mi:0, s:0,
          fwError: 'Could not boot that firmware: ' + (err && err.message ? err.message : err) + '. Expected two STM32H7B0 flash images (internal + external).' });
      }
    }
  } else if (d.retailFw) {                             // code-only build: retail firmware relayed from a content pack (base64)
    self.__ARM_FW = self.__ARM_FW || {};
    self.__ARM_FW[_cfg.key] = d.retailFw;
    if (AT && !cpu) {
      try { bootRetail(); }
      catch (err) {
        self.postMessage({ status:1, halted:true, fps:0, pct:0, busy:0, wasm:false, fw:'retail', h:0, mi:0, s:0,
          fwError: 'Could not boot that firmware: ' + (err && err.message ? err.message : err) });
      }
    }
  }
};

// ---- start -----------------------------------------------------------------
if (FWMODE === 'custom') {
  importScripts(CFWV);                                // retro-go-capable engine; firmware arrives via {customFw}
  AT = self.ArmTwin;
  self.postMessage({ status:1, halted:false, fps:0, pct:0, busy:0, wasm:false, fw:'custom', h:0, mi:0, s:0, awaitingCustom:1 });
} else {
  importScripts(TWINV);                                // engine — always shipped (code)
  AT = self.ArmTwin;
  if (self.__ARM_FW && self.__ARM_FW[_cfg.key]) {
    bootRetail();                                      // firmware already present on self
  } else {
    try { importScripts(_cfg.fw); } catch (e) {}       // baked firmware_<unit>.js — absent in code-only builds
    if (self.__ARM_FW && self.__ARM_FW[_cfg.key]) bootRetail();
    else self.postMessage({ needFw: _cfg.key });       // ask the page to relay a content-pack firmware
  }
}
