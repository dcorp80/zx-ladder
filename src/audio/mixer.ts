import type { FeBatch } from "../devices/border";
import { IO_MAX_BATCH_TICKS } from "../machine/ioCapture";
import type { AyPcmBlock } from "./aySynth";

export type AyStereo = "ABC" | "ACB" | "Mono";
export interface SoundSettings {
  beeperEnabled: boolean;
  beeperVolume: number;
  ayEnabled: boolean;
  ayVolume: number;
  ayStereo: AyStereo;
  ayMiddle: number;
}
export const DEFAULT_SOUND: SoundSettings = {
  beeperEnabled: true,
  beeperVolume: 0.2,
  ayEnabled: true,
  ayVolume: 0.2,
  ayStereo: "ABC",
  ayMiddle: 0.5,
};
export type StereoSink = (
  samples: Float32Array,
  frames: number,
  sampleRate: number,
) => void;
export const PCM_BLOCK_FRAMES = 256;
export const MAX_SAMPLE_RATE = 192_000;
const SLOT_HZ = 7_000_000;
const MAX_SAMPLES =
  Math.ceil((IO_MAX_BATCH_TICKS * MAX_SAMPLE_RATE) / SLOT_HZ) + 1;

/** Synchronous frame/partial-frame mixer. All sample storage is allocated once. */
export class SoundMixer {
  private readonly ayA = new Array<number>(MAX_SAMPLES).fill(0);
  private readonly ayB = new Array<number>(MAX_SAMPLES).fill(0);
  private readonly ayC = new Array<number>(MAX_SAMPLES).fill(0);
  private ayCount = 0;
  private filled = 0;
  private area = 0;
  private filtered = 0;
  private readonly output = new Float32Array(PCM_BLOCK_FRAMES * 2);
  private outputCount = 0;
  private rate = 48_000;
  private smoothing = 0;
  private filter = 0;
  private readonly gains = [0.2, 0.05, 0, 0.025, 0.025, 0, 0.05];
  private readonly targets = [...this.gains];
  private sink?: StereoSink;
  constructor(private readonly hasAy: boolean) {
    this.setSampleRate(this.rate);
  }
  get sampleRate(): number {
    return this.rate;
  }
  setSink(sink?: StereoSink): void {
    this.sink = sink;
  }
  setSampleRate(rate: number): void {
    if (!Number.isSafeInteger(rate) || rate < 8_000 || rate > MAX_SAMPLE_RATE)
      throw new RangeError("Unsupported audio sample rate");
    this.rate = rate;
    this.smoothing = 1 - Math.exp(-1 / (rate * 0.01));
    this.filter =
      1 - Math.exp((-2 * Math.PI * Math.min(8000, rate * 0.4)) / rate);
    this.filled =
      this.area =
      this.filtered =
      this.ayCount =
      this.outputCount =
        0;
  }
  configure(settings: SoundSettings): void {
    const s = settings;
    const ay = s.ayEnabled ? s.ayVolume * 0.25 : 0;
    this.targets[0] = s.beeperEnabled ? s.beeperVolume : 0;
    if (s.ayStereo === "Mono") {
      for (let i = 1; i < 7; i++) this.targets[i] = ay / 3;
    } else {
      this.targets[1] = ay;
      this.targets[2] = 0;
      this.targets[3] = s.ayStereo === "ABC" ? ay * s.ayMiddle : 0;
      this.targets[4] = s.ayStereo === "ABC" ? ay * s.ayMiddle : ay;
      this.targets[5] = s.ayStereo === "ABC" ? 0 : ay * s.ayMiddle;
      this.targets[6] = s.ayStereo === "ABC" ? ay : ay * s.ayMiddle;
    }
  }
  captureAy(block: AyPcmBlock): void {
    if (
      block.sampleRate !== this.rate ||
      this.ayCount + block.count > MAX_SAMPLES
    )
      throw new Error("AY mixer capture mismatch");
    for (let i = 0; i < block.count; i++) {
      this.ayA[this.ayCount] = block.a[i];
      this.ayB[this.ayCount] = block.b[i];
      this.ayC[this.ayCount++] = block.c[i];
    }
  }
  consume(batch: FeBatch): void {
    let index = 0;
    let offset = 0;
    let value = batch.initialValue;
    let event = 0;
    while (offset < batch.duration) {
      // Retain every full-byte event, but synthesize only bit-4 transitions.
      while (event < batch.count && batch.time[event] === offset)
        value = batch.value[event++];
      let next = batch.duration;
      while (event < batch.count) {
        if ((batch.value[event] & 16) !== (value & 16)) {
          next = batch.time[event];
          break;
        }
        event++;
      }
      if (next < offset || next > batch.duration)
        throw new Error("Invalid FE event timestamp");
      const level = value & 16 ? 0.5 : -0.5;
      let units = (next - offset) * this.rate;
      while (units > 0) {
        const span = Math.min(units, SLOT_HZ - this.filled);
        this.area += span * level;
        this.filled += span;
        units -= span;
        if (this.filled === SLOT_HZ) {
          this.filtered += this.filter * (this.area / SLOT_HZ - this.filtered);
          this.filled = this.area = 0;
          if (this.hasAy && index >= this.ayCount)
            throw new Error("Missing AY samples");
          const a = this.hasAy ? this.ayA[index] : 0;
          const b = this.hasAy ? this.ayB[index] : 0;
          const c = this.hasAy ? this.ayC[index] : 0;
          for (let g = 0; g < 7; g++)
            this.gains[g] += this.smoothing * (this.targets[g] - this.gains[g]);
          const g = this.gains;
          const beep = this.filtered * g[0];
          const out = this.outputCount++ * 2;
          this.output[out] = beep + a * g[1] + b * g[3] + c * g[5];
          this.output[out + 1] = beep + a * g[2] + b * g[4] + c * g[6];
          index++;
          if (this.outputCount === PCM_BLOCK_FRAMES) this.deliver();
        }
      }
      offset = next;
    }
    if (this.hasAy && index !== this.ayCount)
      throw new Error("Extra AY samples");
    this.ayCount = 0;
    this.deliver();
  }
  private deliver(): void {
    if (this.outputCount) this.sink?.(this.output, this.outputCount, this.rate);
    this.outputCount = 0;
  }
}
