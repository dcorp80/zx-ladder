import type { Device, IoClaim } from "../machine/devices";

export const AY_CLOCK_HZ = 1_750_000;
export const AY_MAX_BATCH_TICKS = 143_360;
// At maximum turbo one CPU clock is one raster slot; an I/O cycle needs 4T.
export const AY_EVENT_CAPACITY = Math.ceil(AY_MAX_BATCH_TICKS / 4) + 1;
const REGISTER_MASKS = [
  255, 15, 255, 15, 255, 15, 31, 255, 31, 31, 31, 255, 255, 15, 255,
];

export interface AyBatch {
  readonly origin: number;
  readonly duration: number;
  readonly time: readonly number[];
  readonly reg: readonly number[];
  readonly value: readonly number[];
  readonly count: number;
  readonly resetIntervals: ReadonlyArray<readonly [number, number]>;
  /** Distinguish a continued reset from a fresh assertion at tick zero. */
  readonly startsInReset: boolean;
  readonly endsInReset: boolean;
}
/** Synchronous consumer: all batch storage is reused immediately after return. */
export type AyBatchSink = (batch: AyBatch) => void;

/** AY-3-8912 bus state and timed capture; oscillator state belongs to synthesis. */
export class AyDevice implements Device {
  readonly id = "ay";
  readonly clockHz = AY_CLOCK_HZ;
  readonly registers: number[] = new Array(15).fill(0);
  selectedRegister = 0;
  private resetActive = false;
  private sink?: AyBatchSink;
  private readonly capture = {
    origin: 0,
    duration: 0,
    time: new Array<number>(AY_EVENT_CAPACITY).fill(0),
    reg: new Array<number>(AY_EVENT_CAPACITY).fill(0),
    value: new Array<number>(AY_EVENT_CAPACITY).fill(0),
    count: 0,
    resetIntervals: [] as [number, number][],
    startsInReset: false,
    endsInReset: false,
  };
  get batch(): AyBatch {
    return this.capture;
  }
  get inReset(): boolean {
    return this.resetActive;
  }
  readonly io: readonly IoClaim[];

  constructor(private readonly now: () => number) {
    this.capture.origin = now();
    this.io = [
      {
        lowMask: 255,
        lowValue: 0xfd,
        highMask: 255,
        highValue: 0xff,
        read: () => this.read(),
        write: (_address, value) => this.select(value),
      },
      {
        lowMask: 255,
        lowValue: 0xfd,
        highMask: 255,
        highValue: 0xbf,
        write: (_address, value) => this.write(value),
      },
    ];
  }

  select(value: number): void {
    // The standard chip only latches addresses whose upper nibble is zero.
    if (!this.resetActive && (value & 0xf0) === 0)
      this.selectedRegister = value & 15;
  }
  read(): number {
    const reg = this.selectedRegister;
    // Port B is absent on the 8912. No external peripheral drives port A;
    // its input pins read high, while output mode reads the stored latch.
    if (reg === 15) return 255;
    if (reg === 14 && (this.registers[7] & 0x40) === 0) return 255;
    return this.registers[reg];
  }
  write(value: number): void {
    const reg = this.selectedRegister;
    if (this.resetActive || reg === 15) return;
    const b = this.capture;
    if (b.count === AY_EVENT_CAPACITY)
      throw new Error("AY event buffer overflow");
    value &= REGISTER_MASKS[reg];
    this.registers[reg] = value;
    const i = b.count;
    b.time[i] = this.now() - b.origin;
    b.reg[i] = reg;
    b.value[i] = value;
    b.count = i + 1;
  }

  setReset(active: boolean): void {
    if (active === this.resetActive) return;
    const b = this.capture;
    const tick = this.now() - b.origin;
    this.resetActive = active;
    if (active) {
      this.registers.fill(0);
      this.selectedRegister = 0;
      b.resetIntervals.push([tick, -1]);
    } else {
      b.resetIntervals[b.resetIntervals.length - 1][1] = tick;
    }
  }

  setSink(sink?: AyBatchSink): void {
    this.sink = sink;
  }
  /** Called at frame/partial-frame boundaries, including while audio is muted. */
  flush(): void {
    const b = this.capture;
    const end = this.now();
    const duration = end - b.origin;
    if (duration === 0 && b.count === 0 && b.resetIntervals.length === 0)
      return;
    b.duration = duration;
    b.endsInReset = this.resetActive;
    if (this.resetActive)
      b.resetIntervals[b.resetIntervals.length - 1][1] = duration;
    this.sink?.(b);
    b.origin = end;
    b.duration = 0;
    b.count = 0;
    b.resetIntervals.length = 0;
    b.startsInReset = this.resetActive;
    if (this.resetActive) b.resetIntervals.push([0, -1]);
  }
}
