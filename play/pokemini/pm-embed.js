/* pm-embed.js — self-contained, embeddable Pokémon mini device module.
 *
 * A clean mount/teardown API so the validated core can drop into the main G&W
 * frontend without the debug harness. Creates its own DOM (self-made SVG bezel
 * + LCD canvas), wires canvas blit / AudioWorklet / keyboard input / IndexedDB
 * saves / rewind, and tears all of it down on demand.
 *
 * Bezel note (commission §10): the shape is ORIGINAL art drawn here; only the
 * PROPORTIONS reference the documented shell (198×254, 96×64 window @ 51,58).
 * No third-party image is shipped.
 *
 *   import { PokemonMiniDevice } from "./pm-embed.js";
 *   const dev = new PokemonMiniDevice(containerEl, { scale: 2.6, saveKey: "tetris" });
 *   await dev.mount();
 *   dev.loadBios(biosU8); dev.loadRom(romU8);   // or dev.mount({bios,rom})
 *   dev.start();  ... dev.pause();  ... dev.teardown();
 */

const WASM_URL = new URL("../build/pokemini.wasm", import.meta.url);
const WORKLET_URL = new URL("./audio-worklet.js", import.meta.url);

// Shell geometry (proportions only — original art below).
const SHELL_W = 198, SHELL_H = 254, WIN_X = 51, WIN_Y = 58, WIN_W = 96, WIN_H = 64;

/* Minimal IndexedDB kv (BIOS/ROM/EEPROM saves; local-only, never uploaded). */
const b64ToU8 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

const DB = "pokemini", ST = "blobs";
function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>r.result.createObjectStore(ST); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function idbGet(k){ const db=await idb(); return new Promise((res,rej)=>{ const t=db.transaction(ST,"readonly"); const q=t.objectStore(ST).get(k); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); }
async function idbPut(k,v){ const db=await idb(); return new Promise((res,rej)=>{ const t=db.transaction(ST,"readwrite"); t.objectStore(ST).put(v,k); t.oncomplete=res; t.onerror=()=>rej(t.error); }); }

// Original self-made bezel (inline SVG). Colour-selectable to match the
// catalogue tile (blue/green/purple/…). Proportions per §10; original art.
const SHELL_COLORS = {
  purple: ["#7b5cc7","#5a3fa0","#3d2b70","#c9b8f0"],
  blue:   ["#5b8fe0","#3f63b0","#2b4180","#b8ccf0"],
  green:  ["#5fbf7a","#3f9a55","#2b7040","#b8f0c9"],
  red:    ["#e06a6a","#b04040","#802b2b","#f0b8b8"],
  black:  ["#4a4a54","#2a2a34","#151520","#b8b8c8"],
};
function bezelSVG(color) {
  const [c0,c1,edge,txt] = SHELL_COLORS[color] || SHELL_COLORS.purple;
  return `<svg viewBox="0 0 ${SHELL_W} ${SHELL_H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-label="Pokémon mini device">
    <defs><linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs>
    <rect x="2" y="2" width="${SHELL_W-4}" height="${SHELL_H-4}" rx="30" ry="30" fill="url(#body)" stroke="${edge}" stroke-width="3"/>
    <rect x="34" y="40" width="130" height="100" rx="8" fill="#2a2440" stroke="#1c1830" stroke-width="2"/>
    <rect x="${WIN_X}" y="${WIN_Y}" width="${WIN_W}" height="${WIN_H}" fill="#8a9a3a"/>
    <g fill="${edge}"><rect x="34" y="176" width="42" height="14" rx="4"/><rect x="48" y="162" width="14" height="42" rx="4"/></g>
    <circle cx="150" cy="176" r="12" fill="#e05a7a"/><circle cx="126" cy="196" r="12" fill="#e05a7a"/>
    <text x="99" y="245" fill="${txt}" font-size="11" text-anchor="middle" font-family="monospace">POKéMON mini</text>
  </svg>`;
}

export class PokemonMiniDevice {
  constructor(container, opts = {}) {
    this.container = container;
    this.scale = opts.scale || 2.6;
    this.saveKey = opts.saveKey || null;      // per-title EEPROM key; null = derived from ROM
    this.color = opts.color || "purple";      // self-made bezel colour (blue/green/purple/...)
    this.bezelImage = opts.bezelImage || null;// host-supplied bezel image (URL/dataURI); overrides SVG
    this.datetimeSeconds = (opts.datetimeSeconds !== undefined) ? opts.datetimeSeconds : null; // null = host now
    this.demoScript = opts.demoScript || null; // input macro to reach the main screen
    this._demoActive = -1;
    this.bootState = opts.bootState || null;   // base64/Uint8Array main-screen snapshot
    this.demoMode = !!opts.demoMode;           // demo tile: keep captured EEPROM (no player save)
    // asset locations — override so the host can lay files out however it likes
    this.wasmUrl = opts.wasmUrl || WASM_URL;
    this.workletUrl = opts.workletUrl || WORKLET_URL;
    this.opts = opts;
    this.exp = null; this.mem = null;
    this._raf = 0; this._running = false; this._lastT = 0;
    this._audioCtx = null; this._audioNode = null;
    this._keyMask = 0; this._biosLoaded = false; this._romLoaded = false;
    this._flushCtr = 0; this._rewind = null; this._rewindHead = 0; this._rewindCount = 0; this._rewindCtr = 0;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._tick = this._tick.bind(this);
    this._gesture = () => this._enableAudio();
  }

  async mount(content) {
    // instantiate a fresh core
    const bytes = await fetch(this.wasmUrl, { cache: "no-store" }).then(r => r.arrayBuffer());
    this.exp = (await WebAssembly.instantiate(bytes, { env: {} })).instance.exports;
    this.exp.pm_init(); this.exp.pm_reset();

    // build DOM: bezel + overlaid LCD canvas
    const root = document.createElement("div");
    root.style.cssText = `position:relative;width:${SHELL_W*this.scale}px;height:${SHELL_H*this.scale}px;user-select:none;touch-action:none;outline:none;-webkit-tap-highlight-color:transparent`;
    root.tabIndex = 0;
    if (this.bezelImage) {
      // host-supplied bezel image (e.g. the translucent console artwork), sized
      // to the shell proportions; the LCD canvas overlays the window rect.
      const img = document.createElement("img");
      img.src = this.bezelImage; img.alt = "Pokémon mini";
      img.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none";
      root.appendChild(img);
    } else {
      root.innerHTML = bezelSVG(this.color);   // self-made SVG fallback
    }
    const cv = document.createElement("canvas");
    cv.width = WIN_W; cv.height = WIN_H;
    cv.style.cssText = `position:absolute;image-rendering:pixelated;` +
      `left:${WIN_X*this.scale}px;top:${WIN_Y*this.scale}px;width:${WIN_W*this.scale}px;height:${WIN_H*this.scale}px`;
    root.appendChild(cv);
    this.container.appendChild(root);
    this.root = root; this.canvas = cv;
    this._ctx = cv.getContext("2d"); this._img = this._ctx.createImageData(WIN_W, WIN_H);

    // input + audio-enable gestures (scoped to the device element)
    root.addEventListener("keydown", this._onKeyDown);
    root.addEventListener("keyup", this._onKeyUp);
    root.addEventListener("pointerdown", this._gesture);
    root.addEventListener("keydown", this._gesture);

    // content: from opts, args, or IndexedDB
    const c = content || this.opts;
    if (c && c.bios) this.loadBios(c.bios); else { const b = await idbGet("bios"); if (b) this.loadBios(new Uint8Array(b)); }
    if (c && c.rom)  this.loadRom(c.rom);   else { const r = await idbGet("rom");  if (r) this.loadRom(new Uint8Array(r)); }

    this._raf = requestAnimationFrame(this._tick);
    return this;
  }

  loadBios(u8) {
    const n = Math.min(u8.length, this.exp.pm_bios_size());
    new Uint8Array(this.exp.memory.buffer, this.exp.pm_bios_ptr(), n).set(u8.subarray(0, n));
    this._biosLoaded = true; this._bootIfReady();
  }
  loadRom(u8) {
    new Uint8Array(this.exp.memory.buffer, this.exp.pm_rom_ptr(), u8.length).set(u8);
    this.exp.pm_load(u8.length);
    if (!this.saveKey) { let h = 2166136261>>>0; for (let i=0;i<u8.length;i+=521){ h^=u8[i]; h=Math.imul(h,16777619);} this.saveKey = (h>>>0).toString(16)+"-"+u8.length; }
    this._romLoaded = true; this._bootIfReady();
  }
  async _restorePlayerSave() {
    // player's per-title EEPROM (from IndexedDB) wins over any captured EEPROM,
    // except on a demo tile which keeps the clean captured state.
    if (this.demoMode || !this.saveKey) return;
    const s = await idbGet("eeprom:" + this.saveKey);
    if (s) { const n = Math.min(s.byteLength, this.exp.pm_eeprom_size());
      new Uint8Array(this.exp.memory.buffer, this.exp.pm_eeprom_ptr(), n).set(new Uint8Array(s).subarray(0, n));
      this.exp.pm_eeprom_clear_dirty(); }
  }
  async _bootIfReady() {
    if (!(this._biosLoaded && this._romLoaded)) return;
    this.exp.pm_reset();
    if (this.bootState) { await this.loadBootState(this.bootState); return; }  // instant main screen
    await this._restorePlayerSave();
    this.setDateTime(this.datetimeSeconds);   // seed the console RTC from host time
    this.start();
  }

  /* Load a captured main-screen boot state, re-seed the RTC to the current host
   * time, restore the player's own EEPROM save (play path), and resume ("power
   * on"). Call it whenever the host chooses — e.g. after N live slot-in frames
   * for the hybrid boot animation. blob = base64 string or Uint8Array. */
  async loadBootState(blob) {
    const u8 = (typeof blob === "string") ? b64ToU8(blob) : blob;
    new Uint8Array(this.exp.memory.buffer, this.exp.pm_boot_state_ptr(), u8.length).set(u8);
    this.exp.pm_boot_state_load(u8.length);
    await this._restorePlayerSave();          // player save wins over the captured EEPROM
    this.setDateTime(this.datetimeSeconds);   // clock = current host time
    this.start();
  }

  /* Capture a main-screen boot state by fast-running this device's demoScript
   * (no realtime pacing), then snapshotting. Returns a Uint8Array (~14 KB) the
   * host can cache (e.g. IndexedDB) for instant boots. Requires demoScript set. */
  captureBootState() {
    if (!this.demoScript) return null;
    this.exp.pm_reset();
    this.setDateTime(this.datetimeSeconds);
    const pf = () => Number(this.exp.pm_prc_frame_count());
    const last = this.demoScript.reduce((m, s) => Math.max(m, s.frame + (s.hold || 6)), 0);
    let guard = 0;
    while (pf() < last + 400 && guard < 80_000_000 && !this.exp.pm_cpu_trapped()) {
      let mask = 0; const f = pf();
      for (const s of this.demoScript) if (f >= s.frame && f < s.frame + (s.hold || 6)) mask |= s.keys;
      this.exp.pm_set_keys(mask);
      this.exp.pm_run_cycles(4000); guard++;
    }
    this.exp.pm_set_keys(0);
    const size = this.exp.pm_boot_state_save();
    return new Uint8Array(new Uint8Array(this.exp.memory.buffer, this.exp.pm_boot_state_ptr(), size)); // copy
  }
  /* Seed the console RTC. `seconds` null = derive from the host clock. The PM
   * second counter is 24-bit (stored mod 2^24). See docs/EMBED.md. */
  setDateTime(seconds) {
    if (seconds == null) { const d = new Date(); seconds = Math.floor(d.getTime()/1000); }
    this.exp.pm_set_datetime(seconds >>> 0);
  }

  start(){ this._running = true; this._lastT = 0; }
  pause(){ this._running = false; }
  reset(){ this.exp.pm_reset(); }

  _enableAudio() {
    if (this._audioCtx) { if (this._audioCtx.state === "suspended") this._audioCtx.resume(); return; }
    this._audioCtx = new AudioContext();
    this._audioCtx.audioWorklet.addModule(this.workletUrl).then(() => {
      this._audioNode = new AudioWorkletNode(this._audioCtx, "pm-sink", { outputChannelCount: [1] });
      this._audioNode.connect(this._audioCtx.destination);
      this.exp.pm_set_sample_rate(this._audioCtx.sampleRate | 0);
      this._audioCtx.resume();
    }).catch(e => console.warn("pm audio:", e));
  }
  _drainAudio() {
    if (!this._audioNode) return;
    const avail = this.exp.pm_audio_count(); if (avail <= 0) return;
    const sz = this.exp.pm_audio_ring_size(), rd = this.exp.pm_audio_rd();
    const ring = new Float32Array(this.exp.memory.buffer, this.exp.pm_audio_ptr(), sz);
    const chunk = new Float32Array(avail);
    for (let i=0;i<avail;i++) chunk[i] = ring[(rd+i)%sz];
    this.exp.pm_audio_advance(avail);
    this._audioNode.port.postMessage(chunk, [chunk.buffer]);
  }
  async _flushEeprom() {
    if (!this.saveKey || !this.exp.pm_eeprom_dirty()) return;
    const n = this.exp.pm_eeprom_size();
    const save = new Uint8Array(new Uint8Array(this.exp.memory.buffer, this.exp.pm_eeprom_ptr(), n));
    this.exp.pm_eeprom_clear_dirty();
    await idbPut("eeprom:" + this.saveKey, save);
  }

  loadColor(u8) {                                     // .minc colour data (rung 10)
    new Uint8Array(this.exp.memory.buffer, this.exp.pm_color_ptr(), u8.length).set(u8);
    return this.exp.pm_color_load(u8.length);         // 0 = ok
  }
  _blit() {
    const d = this._img.data;
    if (this.exp.pm_color_enabled()) {                // colourised render path
      const idx = new Uint8Array(this.exp.memory.buffer, this.exp.pm_color_fb_ptr(), WIN_W*WIN_H);
      const pal = new Uint32Array(this.exp.memory.buffer, this.exp.pm_color_palette_ptr(), 256);
      const out = new Uint32Array(this._img.data.buffer);
      for (let i=0;i<WIN_W*WIN_H;i++) out[i] = pal[idx[i]];   // RGBA LE
    } else {
      const s = new Uint8Array(this.exp.memory.buffer, this.exp.pm_fb_ptr(), WIN_W*WIN_H);
      for (let i=0;i<WIN_W*WIN_H;i++){ const on=s[i]/255;
        d[i*4]=Math.round(0xb0*(1-on)+0x10*on); d[i*4+1]=Math.round(0xc0*(1-on)+0x20*on);
        d[i*4+2]=Math.round(0x50*(1-on)+0x10*on); d[i*4+3]=255; }
    }
    this._ctx.putImageData(this._img, 0, 0);
  }

  // key layout: arrows = D-pad, Z=B, X=A, D=C (the C shoulder trigger), P=Power,
  // K=shake, Backspace=rewind. (Z/X map to the console's physical left-B / right-A
  // button order; the C shoulder trigger is on the D key — next to A/B.)
  static KEYS = { ArrowUp:3, ArrowDown:4, ArrowLeft:5, ArrowRight:6, KeyZ:1, KeyX:0, KeyD:2, KeyP:7 };
  _onKeyDown(e){
    const b = PokemonMiniDevice.KEYS[e.code];
    if (b!==undefined){ this._keyMask |= 1<<b; this.exp.pm_set_keys(this._keyMask); e.preventDefault(); return; }
    if (e.key && e.key.toUpperCase()==="K"){ this.exp.pm_shake(4); e.preventDefault(); }
    else if (e.key==="Backspace"){ this._rewindBack(); e.preventDefault(); }
  }
  _onKeyUp(e){ const b = PokemonMiniDevice.KEYS[e.code]; if (b!==undefined){ this._keyMask &= ~(1<<b); this.exp.pm_set_keys(this._keyMask); e.preventDefault(); } }

  _ensureRewind(){ if (this._rewind) return; const n=this.exp.pm_state_size(); this._rewind = Array.from({length:16},()=>new Uint8Array(n)); }
  _rewindCapture(){ if(!this._rewind)return; const n=this.exp.pm_state_size(); this._rewind[this._rewindHead].set(new Uint8Array(this.exp.memory.buffer,this.exp.pm_state_ptr(),n)); this._rewindHead=(this._rewindHead+1)%16; if(this._rewindCount<16)this._rewindCount++; }
  _rewindBack(){ if(!this._rewind||this._rewindCount===0)return; const n=this.exp.pm_state_size(); this._rewindHead=(this._rewindHead-1+16)%16; this._rewindCount--; new Uint8Array(this.exp.memory.buffer,this.exp.pm_state_ptr(),n).set(this._rewind[this._rewindHead]); }

  _tick(now){
    if (this._running && !this.exp.pm_cpu_trapped()){
      if (!this._lastT) this._lastT = now;
      let dt = (now-this._lastT)/1000; this._lastT = now; if (dt>0.05) dt=0.05;
      const budget = Math.floor(dt*4_000_000);
      if (budget>0) this.exp.pm_run_cycles(budget);
      this._applyDemoScript();
      this._drainAudio();
      this._ensureRewind();
      if (++this._rewindCtr>=20){ this._rewindCtr=0; this._rewindCapture(); }
      if (++this._flushCtr>=120){ this._flushCtr=0; this._flushEeprom(); }
    } else this._lastT = now;
    this._blit();
    this._raf = requestAnimationFrame(this._tick);
  }

  /* Demo-only auto-input: apply the demoScript by PRC frame number to walk a
   * freshly-booted title past its date/time/language/name setup screens. This is
   * NOT on the normal playable path — only runs when a demoScript is set. */
  runDemoBoot(script){ this.demoScript = script; this._demoActive = -1; }
  _applyDemoScript(){
    if (!this.demoScript) return;
    const pf = Number(this.exp.pm_prc_frame_count());
    let mask = 0;
    for (const s of this.demoScript) if (pf >= s.frame && pf < s.frame + (s.hold || 6)) mask |= s.keys;
    if (mask !== this._demoActive){ this._demoActive = mask; this.exp.pm_set_keys(mask | this._keyMask); }
  }

  teardown(){
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._flushEeprom();
    if (this._audioNode) try { this._audioNode.disconnect(); } catch {}
    if (this._audioCtx) try { this._audioCtx.close(); } catch {}
    if (this.root){ this.root.removeEventListener("keydown", this._onKeyDown); this.root.removeEventListener("keyup", this._onKeyUp); this.root.remove(); }
    this.exp = null;   // release the core (its linear memory is GC'd with the instance)
  }
}
