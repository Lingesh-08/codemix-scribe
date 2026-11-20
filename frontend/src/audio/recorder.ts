/** Captures the microphone and calls onFrame with 100 ms of 16 kHz mono PCM16. */
export class MicRecorder {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;

  constructor(
    private onFrame: (pcm: ArrayBuffer) => void,
    private onLevel: (rms: number) => void,
  ) {}

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule("/pcm-worklet.js");
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-worklet");
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      this.onFrame(e.data.pcm);
      this.onLevel(e.data.rms);
    };
    src.connect(this.node);
    // keep the graph pulling audio without playing it back
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
  }

  async stop() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.node = undefined;
    this.stream = undefined;
    this.ctx = undefined;
  }
}
