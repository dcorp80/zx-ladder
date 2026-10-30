/** Bounded mono queue shared by the worklet and deterministic tests. */
export class PcmQueue {
  private readonly data: Float32Array;
  private read = 0;
  private count = 0;
  private playing = false;
  private last = 0;
  private fade = 0;
  private fadeStart = 0;
  constructor(readonly sampleRate: number) {
    this.data = new Float32Array(Math.ceil(sampleRate * 0.12));
  }
  get queued(): number {
    return this.count;
  }
  reset(): void {
    this.read = 0;
    this.count = 0;
    this.playing = false;
    this.fadeStart = this.last;
    this.fade = 128;
  }
  push(samples: Float32Array): void {
    if (samples.length > this.data.length)
      samples = samples.subarray(samples.length - this.data.length);
    if (this.count + samples.length > this.data.length) {
      // Host catch-up must not create a growing delay: retain recent output.
      this.read = 0;
      this.count = 0;
      this.playing = false;
    }
    let write = (this.read + this.count) % this.data.length;
    for (const sample of samples) {
      this.data[write] = sample;
      write = (write + 1) % this.data.length;
    }
    this.count += samples.length;
  }
  render(output: Float32Array): void {
    if (!this.playing && this.count >= Math.ceil(this.sampleRate * 0.04)) {
      this.playing = true;
      this.fade = 0;
    }
    for (let i = 0; i < output.length; i++) {
      if (this.playing && this.count) {
        this.last = this.data[this.read];
        this.read = (this.read + 1) % this.data.length;
        this.count--;
      } else {
        if (this.playing) {
          this.playing = false;
          this.fadeStart = this.last;
          this.fade = 128;
        }
        this.last = this.fade ? this.fadeStart * (--this.fade / 128) : 0;
      }
      output[i] = this.last;
    }
  }
}
