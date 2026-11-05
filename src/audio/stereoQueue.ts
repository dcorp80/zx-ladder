/** Interleaved stereo ring with one shared cursor and bounded latency. */
export class StereoQueue {
  private readonly data: Float32Array;
  private read = 0;
  private count = 0;
  private playing = false;
  private left = 0;
  private right = 0;
  private fade = 0;
  private fadeLeft = 0;
  private fadeRight = 0;
  constructor(readonly sampleRate: number) {
    this.data = new Float32Array(Math.ceil(sampleRate * 0.12) * 2);
  }
  get queued(): number {
    return this.count;
  }
  reset(): void {
    this.read = this.count = 0;
    this.playing = false;
    this.fadeLeft = this.left;
    this.fadeRight = this.right;
    this.fade = 128;
  }
  push(samples: Float32Array, frames: number): void {
    const capacity = this.data.length / 2;
    const start = Math.max(0, frames - capacity);
    frames -= start;
    if (this.count + frames > capacity) this.reset();
    let write = (this.read + this.count) % capacity;
    for (let i = start; i < start + frames; i++) {
      this.data[write * 2] = samples[i * 2];
      this.data[write * 2 + 1] = samples[i * 2 + 1];
      write = (write + 1) % capacity;
    }
    this.count += frames;
  }
  render(left: Float32Array, right: Float32Array): void {
    if (!this.playing && this.count >= Math.ceil(this.sampleRate * 0.04)) {
      this.playing = true;
      this.fade = 0;
    }
    for (let i = 0; i < left.length; i++) {
      if (this.playing && this.count) {
        this.left = this.data[this.read * 2];
        this.right = this.data[this.read * 2 + 1];
        this.read = (this.read + 1) % (this.data.length / 2);
        this.count--;
      } else {
        if (this.playing) {
          this.playing = false;
          this.fade = 128;
          this.fadeLeft = this.left;
          this.fadeRight = this.right;
        }
        const gain = this.fade ? --this.fade / 128 : 0;
        this.left = this.fadeLeft * gain;
        this.right = this.fadeRight * gain;
      }
      left[i] = this.left;
      right[i] = this.right;
    }
  }
}
