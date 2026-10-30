/** Integrate the FE beeper duty cycle over each audio sample interval.
 * Fractional sample time and area survive video frame boundaries.
 */
export class BeeperResampler {
  private filled = 0;
  private area = 0;
  private clock = 0;
  constructor(readonly sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0)
      throw new Error("Invalid audio sample rate");
  }
  reset(): void {
    this.filled = 0;
    this.area = 0;
    this.clock = 0;
  }
  convert(latch: Uint8Array, slotHz: number): Float32Array {
    if (!Number.isFinite(slotHz) || slotHz <= 0)
      throw new Error("Invalid capture clock");
    if (this.clock && this.clock !== slotHz) this.reset();
    this.clock = slotHz;
    // Integer clock units avoid frame-dependent floating point drift:
    // one captured slot occupies sampleRate units; one output sample slotHz.
    const output = new Float32Array(
      Math.floor((this.filled + latch.length * this.sampleRate) / slotHz),
    );
    let written = 0,
      start = 0;
    while (start < latch.length) {
      const high = (latch[start] & 0x10) !== 0;
      let end = start + 1;
      while (end < latch.length && ((latch[end] & 0x10) !== 0) === high) end++;
      let duration = (end - start) * this.sampleRate;
      const level = high ? 0.5 : -0.5;
      while (duration > 0) {
        const span = Math.min(duration, slotHz - this.filled);
        this.area += level * span;
        this.filled += span;
        duration -= span;
        if (this.filled === slotHz) {
          output[written++] = this.area / slotHz;
          this.filled = 0;
          this.area = 0;
        }
      }
      start = end;
    }
    return output;
  }
}
