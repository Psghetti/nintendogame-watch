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
var TWINV  = 'twin.js?v=20260727-selstart';
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
var AT, cpu, bus, periph;
var octx = null, img = null, _pendingCanvas = null;
var bootWall = performance.now();
var audioReady = false, samplesSent = 0, workletR = 0, drcOn = false;

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
  cpu = m.cpu; bus = m.bus; periph = m.periph;
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
  cpu = m.cpu; bus = m.bus; periph = m.periph;
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

function pump(){
  renderTick();                                      // keep the frame moving every scheduler turn
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
  if (cpu.cycles >= _target) { setTimeout(pump, 3); return; }        // caught up -> one short timer
  while (!cpu.halted && cpu.cycles < _target && (performance.now() - now) < 8) { cpu.run(cpu.cycles + SLICE_CYCLES); }
  _emuBusy += performance.now() - now;
  if (!cpu.halted) mc.port2.postMessage(0);          // behind -> re-post immediately
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
