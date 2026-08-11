/* audio-worklet.js — drains the core's band-limited square samples (rung 5).
 *
 * The core synthesises ONE PolyBLEP square voice directly at the output sample
 * rate (see src/pokemini.c) — clean by construction, never point-sampled here.
 * This processor keeps a small ring fed float32 chunks from the main thread via
 * port.postMessage, output with the G&W ring discipline: underrun -> silence,
 * overrun -> drop oldest.
 */
class PMSink extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 16384;                 // ~370 ms at 44.1 kHz
    this.ring = new Float32Array(this.cap);
    this.wr = 0; this.rd = 0;
    this.port.onmessage = (e) => {
      const chunk = e.data;            // Float32Array
      for (let i = 0; i < chunk.length; i++) { this.ring[this.wr % this.cap] = chunk[i]; this.wr++; }
      if (this.wr - this.rd > this.cap) this.rd = this.wr - this.cap;   // drop oldest
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) out[i] = (this.rd < this.wr) ? this.ring[this.rd++ % this.cap] : 0.0;
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}
registerProcessor("pm-sink", PMSink);
