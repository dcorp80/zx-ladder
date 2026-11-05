import type { AyBatch } from "../devices/ay";

const SLOT_HZ = 7_000_000;
// AY master clock / 8. Tone toggles here; noise and envelope divide further.
const GENERATOR_TICKS = 32;
const BLOCK_SIZE = 256;
// Ideal 3 dB steps, normalized to 1; analog load and chip variation are not modeled.
export const AY_LEVELS: readonly number[] = Array.from(
  { length: 16 },
  (_, i) => (i === 0 ? 0 : 10 ** (((i - 15) * 3) / 20)),
);

export interface AyPcmBlock {
  readonly a: readonly number[];
  readonly b: readonly number[];
  readonly c: readonly number[];
  readonly count: number;
  readonly sampleRate: number;
}
/** Consume synchronously; the same block and arrays are reused after return. */
export type AyPcmSink = (block: AyPcmBlock) => void;

/** Independent replay state, never reads the device's live registers. */
export class AySynth {
  private readonly registers = new Array<number>(15).fill(0);
  private readonly toneCount = [0, 0, 0];
  private readonly toneHigh = [0, 0, 0];
  private readonly levels = [0, 0, 0];
  private noiseCount = 0;
  private noiseSeed = 1;
  private envelopeCount = 0;
  private envelopeStep = 15;
  private envelopeAttack = 0;
  private envelopeHolding = false;
  private envelopeLevel = 15;
  private dividerRemaining = GENERATOR_TICKS;
  private resetActive = false;
  private position = 0;
  private filled = 0;
  private readonly area = [0, 0, 0];
  private sink?: AyPcmSink;
  private readonly block = {
    a: new Array<number>(BLOCK_SIZE).fill(0),
    b: new Array<number>(BLOCK_SIZE).fill(0),
    c: new Array<number>(BLOCK_SIZE).fill(0),
    count: 0,
    sampleRate: 48_000,
  };

  constructor(sampleRate = 48_000) {
    this.setSampleRate(sampleRate);
  }
  setSink(sink?: AyPcmSink): void {
    this.sink = sink;
  }
  /** Reconfigure sampling at a batch boundary, preserving all chip state. */
  setSampleRate(sampleRate: number): void {
    if (
      !Number.isSafeInteger(sampleRate) ||
      sampleRate <= 0 ||
      sampleRate > SLOT_HZ
    )
      throw new RangeError("Invalid AY sample rate");
    if (sampleRate === this.block.sampleRate) return;
    this.block.sampleRate = sampleRate;
    this.filled = 0;
    this.area.fill(0);
    this.block.count = 0;
  }

  process(batch: AyBatch): void {
    if (
      batch.origin !== this.position ||
      !Number.isSafeInteger(batch.duration) ||
      batch.duration < 0
    )
      throw new Error("Noncontiguous AY batch");
    if (batch.startsInReset !== this.resetActive)
      throw new Error("Inconsistent AY reset continuation");
    let cursor = 0;
    let write = 0;
    let reset = 0;
    let start = true;
    while (true) {
      const pair = batch.resetIntervals[reset];
      const resetTime = pair ? pair[start ? 0 : 1] : Infinity;
      const writeTime = write < batch.count ? batch.time[write] : Infinity;
      const next = Math.min(resetTime, writeTime, batch.duration);
      if (!Number.isSafeInteger(next) || next < cursor)
        throw new Error("Invalid AY event timestamp");
      this.advance(next - cursor);
      cursor = next;
      // Process reset edges before writes at the same timestamp. Zero-length
      // pulses still assert/reset, then release, before subsequent writes.
      while (reset < batch.resetIntervals.length) {
        const interval = batch.resetIntervals[reset];
        if (interval[start ? 0 : 1] !== cursor) break;
        if (start) {
          if (!(reset === 0 && batch.startsInReset)) this.resetChip();
          this.resetActive = true;
          start = false;
        } else {
          this.resetActive =
            batch.endsInReset && reset === batch.resetIntervals.length - 1;
          start = true;
          reset++;
        }
      }
      while (write < batch.count && batch.time[write] === cursor) {
        if (!this.resetActive) this.write(batch.reg[write], batch.value[write]);
        write++;
      }
      if (cursor === batch.duration) break;
    }
    if (
      write !== batch.count ||
      reset !== batch.resetIntervals.length ||
      this.resetActive !== batch.endsInReset
    )
      throw new Error("AY event outside batch");
    this.position += batch.duration;
    this.deliver();
  }

  private write(reg: number, value: number): void {
    this.registers[reg] = value;
    if (reg === 13) {
      this.envelopeCount = 0;
      this.envelopeStep = 15;
      this.envelopeAttack = value & 4 ? 15 : 0;
      this.envelopeHolding = false;
      this.envelopeLevel = this.envelopeStep ^ this.envelopeAttack;
    }
    this.updateLevels();
  }
  private resetChip(): void {
    this.registers.fill(0);
    this.toneCount.fill(0);
    this.toneHigh.fill(0);
    this.levels.fill(0);
    this.noiseCount = 0;
    this.noiseSeed = 1;
    this.envelopeCount = 0;
    this.envelopeStep = 15;
    this.envelopeAttack = 0;
    this.envelopeLevel = 15;
    this.envelopeHolding = false;
    this.dividerRemaining = GENERATOR_TICKS;
  }
  private clockGenerators(): void {
    const r = this.registers;
    for (let ch = 0; ch < 3; ch++) {
      const period = r[ch * 2] | (r[ch * 2 + 1] << 8) || 1;
      if (++this.toneCount[ch] >= period) {
        this.toneCount[ch] = 0;
        this.toneHigh[ch] ^= 1;
      }
    }
    if (++this.noiseCount >= (r[6] || 1) * 2) {
      this.noiseCount = 0;
      const feedback = (this.noiseSeed ^ (this.noiseSeed >>> 3)) & 1;
      this.noiseSeed = (this.noiseSeed >>> 1) | (feedback << 16);
    }
    // AY has 16 envelope steps per ramp, one step per 16*period master clocks.
    // Period zero is half period one: one /8 generator tick instead of two.
    if (
      !this.envelopeHolding &&
      ++this.envelopeCount >= ((r[11] | (r[12] << 8)) * 2 || 1)
    ) {
      this.envelopeCount = 0;
      if (this.envelopeStep > 0) this.envelopeStep--;
      else if (!(r[13] & 8)) {
        this.envelopeHolding = true;
        this.envelopeStep = 0;
        this.envelopeAttack = 0;
      } else if (r[13] & 1) {
        this.envelopeHolding = true;
        if (r[13] & 2) this.envelopeAttack ^= 15;
      } else {
        this.envelopeStep = 15;
        if (r[13] & 2) this.envelopeAttack ^= 15;
      }
      this.envelopeLevel = this.envelopeStep ^ this.envelopeAttack;
    }
    this.updateLevels();
  }
  private updateLevels(): void {
    const r = this.registers;
    for (let ch = 0; ch < 3; ch++) {
      const gate =
        (this.toneHigh[ch] || r[7] & (1 << ch)) &&
        (this.noiseSeed & 1 || r[7] & (8 << ch));
      const volume = r[8 + ch];
      this.levels[ch] = gate
        ? AY_LEVELS[volume & 16 ? this.envelopeLevel : volume & 15]
        : 0;
    }
  }
  private advance(ticks: number): void {
    if (this.resetActive) {
      this.integrate(ticks);
      return;
    }
    while (ticks > 0) {
      const span = Math.min(ticks, this.dividerRemaining);
      this.integrate(span);
      ticks -= span;
      this.dividerRemaining -= span;
      if (this.dividerRemaining === 0) {
        this.clockGenerators();
        this.dividerRemaining = GENERATOR_TICKS;
      }
    }
  }
  private integrate(ticks: number): void {
    let units = ticks * this.block.sampleRate;
    while (units > 0) {
      const span = Math.min(units, SLOT_HZ - this.filled);
      this.area[0] += this.levels[0] * span;
      this.area[1] += this.levels[1] * span;
      this.area[2] += this.levels[2] * span;
      units -= span;
      this.filled += span;
      if (this.filled === SLOT_HZ) {
        const i = this.block.count++;
        this.block.a[i] = this.area[0] / SLOT_HZ;
        this.block.b[i] = this.area[1] / SLOT_HZ;
        this.block.c[i] = this.area[2] / SLOT_HZ;
        this.filled = 0;
        this.area.fill(0);
        if (this.block.count === BLOCK_SIZE) this.deliver();
      }
    }
  }
  private deliver(): void {
    if (this.block.count === 0) return;
    this.sink?.(this.block);
    this.block.count = 0;
  }
  /** Debug/test snapshot; deliberately outside capture and synthesis loops. */
  snapshot() {
    return {
      registers: this.registers.slice(),
      toneCount: this.toneCount.slice(),
      toneHigh: this.toneHigh.slice(),
      levels: this.levels.slice(),
      noiseCount: this.noiseCount,
      noiseSeed: this.noiseSeed,
      envelopeCount: this.envelopeCount,
      envelopeLevel: this.envelopeLevel,
      envelopeStep: this.envelopeStep,
      envelopeAttack: this.envelopeAttack,
      envelopeHolding: this.envelopeHolding,
      dividerRemaining: this.dividerRemaining,
      resetActive: this.resetActive,
      position: this.position,
    };
  }
}
