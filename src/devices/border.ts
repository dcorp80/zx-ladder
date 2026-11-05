import type { Device, IoClaim } from "../machine/devices";
import { IO_EVENT_CAPACITY } from "../machine/ioCapture";

/** One full-byte FE history, reusable by beeper, MIC and border consumers. */
export interface FeBatch {
  readonly origin: number;
  readonly duration: number;
  readonly initialValue: number;
  readonly time: readonly number[];
  readonly value: readonly number[];
  readonly count: number;
}
/** Consume synchronously; the device reuses storage immediately after return. */
export type FeBatchSink = (batch: FeBatch) => void;

export class BorderDevice implements Device {
  readonly id = "border";
  private latch = 0;
  private sink?: FeBatchSink;
  setSink(sink?: FeBatchSink): void {
    this.sink = sink;
  }
  private readonly capture = {
    origin: 0,
    duration: 0,
    initialValue: 0,
    time: new Array<number>(IO_EVENT_CAPACITY).fill(0),
    value: new Array<number>(IO_EVENT_CAPACITY).fill(0),
    count: 0,
  };
  get batch(): FeBatch {
    return this.capture;
  }
  /** Full FE output latch: D0–D2 border, D3 MIC, D4 beeper. */
  get value(): number {
    return this.latch;
  }
  set value(value: number) {
    const b = this.capture;
    if (b.count === IO_EVENT_CAPACITY)
      throw new Error("FE event buffer overflow");
    value &= 255;
    b.time[b.count] = this.now() - b.origin;
    b.value[b.count++] = value;
    this.latch = value;
  }
  get color(): number {
    return this.latch & 7;
  }
  set color(color: number) {
    this.value = (this.latch & 0xf8) | (color & 7);
  }
  readonly io: readonly IoClaim[];
  constructor(
    mask = 1,
    value = 0,
    private readonly now: () => number = () => 0,
  ) {
    this.capture.origin = now();
    this.io = [
      {
        lowMask: mask,
        lowValue: value,
        write: (_a, data) => {
          this.value = data;
        },
      },
    ];
  }
  /** End may equal a write's effective tick: it becomes the next batch's latch. */
  flush(end: number, sink: FeBatchSink): void {
    const b = this.capture;
    b.duration = end - b.origin;
    sink(b);
    this.sink?.(b);
    b.origin = end;
    b.duration = 0;
    b.count = 0;
    b.initialValue = this.latch;
  }
}
