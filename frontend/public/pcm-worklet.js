// AudioWorklet: mic audio (context sample rate, e.g. 48 kHz) -> 16 kHz mono Int16,
// posted to the main thread in ~100 ms frames, plus an RMS level for the meter.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0; // fractional read position into incoming audio
    this.frame = new Int16Array(1600); // 100 ms at 16 kHz
    this.n = 0;
    this.sumSq = 0;
    this.prev = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    const len = ch.length;
    // linear interpolation resampling
    while (this.pos < len) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i === 0 && frac < 0 ? this.prev : ch[i];
      const b = i + 1 < len ? ch[i + 1] : ch[i];
      const s = Math.max(-1, Math.min(1, a + (b - a) * frac));
      this.frame[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.sumSq += s * s;
      if (this.n === this.frame.length) {
        const rms = Math.sqrt(this.sumSq / this.n);
        this.port.postMessage({ pcm: this.frame.buffer, rms }, [this.frame.buffer]);
        this.frame = new Int16Array(1600);
        this.n = 0;
        this.sumSq = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= len;
    this.prev = ch[len - 1];
    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorklet);
