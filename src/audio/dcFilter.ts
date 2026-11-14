/** Stateful stereo DC removal before playback gaps can turn offsets into clicks. */
export class StereoDcFilter {
  private readonly b0: number;
  private readonly a1: number;
  private readonly a2: number;
  private readonly x1 = [0, 0];
  private readonly x2 = [0, 0];
  private readonly y1 = [0, 0];
  private readonly y2 = [0, 0];
  private initialize = true;

  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 40)
      throw new RangeError(
        "Sample rate must exceed 40 Hz for the 20 Hz DC filter",
      );
    // Match the former Web Audio high-pass: 20 Hz, default Q = 1 dB.
    // https://www.w3.org/TR/webaudio/#filters-characteristics
    const omega = (2 * Math.PI * 20) / sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * 10 ** (1 / 20));
    const a0 = 1 + alpha;
    this.b0 = (1 + cosine) / (2 * a0);
    this.a1 = (-2 * cosine) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  /** Explicit playback reset; queue starvation/overflow must not reset this. */
  reset(): void {
    this.initialize = true;
    this.y1.fill(0);
    this.y2.fill(0);
  }

  /** Filter only the active interleaved frames in the recyclable input buffer. */
  process(samples: Float32Array, frames: number): void {
    if (frames === 0) return;
    if (this.initialize) {
      // Start at the incoming DC level instead of inventing a step from zero.
      this.x1[0] = this.x2[0] = samples[0];
      this.x1[1] = this.x2[1] = samples[1];
      this.initialize = false;
    }
    for (let i = 0; i < frames * 2; i++) {
      const channel = i & 1;
      const input = samples[i];
      const value =
        this.b0 *
          (input - this.x1[channel] - (this.x1[channel] - this.x2[channel])) -
        this.a1 * this.y1[channel] -
        this.a2 * this.y2[channel];
      // Avoid denormal tails on long silent stretches in the audio thread.
      const output = Math.abs(value) < 1e-24 ? 0 : value;
      this.x2[channel] = this.x1[channel];
      this.x1[channel] = input;
      this.y2[channel] = this.y1[channel];
      this.y1[channel] = output;
      samples[i] = output;
    }
  }
}
