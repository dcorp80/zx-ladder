import type { VideoPreset } from "../devices/videoPresets";
import { Counter } from "../machine/counters";
import type { ClockHook, Device, DeviceBus, IoClaim } from "../machine/devices";
import {
  type CaptureEvents,
  createCaptureEvents,
  expandEvents,
} from "./captureEvents";
import { createRasterMasks, renderCapturedFrame } from "./frameRenderer";

export function pixelAddress(v: number, column: number): number {
  return (
    0x4000 |
    ((v & 0xc0) << 5) |
    ((v & 7) << 8) |
    ((v & 0x38) << 2) |
    (column & 31)
  );
}
export function attributeAddress(v: number, column: number): number {
  return 0x5800 | ((v & 0xf8) << 2) | (column & 31);
}
export function captureAttribute(
  attribute: number,
  flashCount: number,
  flashBit = 4,
): number {
  return (
    (attribute & 0x7f) |
    (attribute & 0x80 && flashCount & (1 << flashBit) ? 0x80 : 0)
  );
}
export interface InterruptInterval {
  start: number;
  endExclusive: number;
}
export type CaptureArray = number[] | Uint8Array;
export interface CapturePlanes {
  events?: CaptureEvents;
  /** Dense compatibility/overflow storage; events own the ordinary capture. */
  extended: CaptureArray;
  pixels: CaptureArray;
  attributes: CaptureArray;
  /** Dense compatibility/overflow border; ordinary frames retain FE events. */
  border: CaptureArray;
  /** Custom-preset fallback; ordinary INT endpoints live in events. */
  interrupts: InterruptInterval[];
  interruptCount: number;
}
export interface RasterVideo extends Device {
  extendedMode?: boolean;
  readonly hPositions: number[];
  readonly vPositions: number[];
  readonly advanceX: number;
  readonly completed: CapturePlanes;
  readonly rawCompleted?: CapturePlanes;
  readonly hasFrame: boolean;
  fetch(bus: Pick<DeviceBus, "readMemory">, symbolIndex: number): void;
  cpuAccess(): void;
  captureBorder(position: number, latch: number): void;
  captureBorderSpan(start: number, end: number, latch: number): void;
  /** Called only when sampled INT changes; frame clipping is internal. */
  captureInterrupt(position: number, active: boolean): void;
  finishFrame(): void;
  render(showBorder?: boolean): Uint8ClampedArray;
}

const inWindow = (v: number, range: readonly [number, number]) =>
  range[0] < range[1]
    ? v >= range[0] && v < range[1]
    : v >= range[0] || v < range[1];

export class TimedVideo implements RasterVideo {
  readonly id = "video";
  readonly clock: readonly ClockHook[];
  readonly hPositions: number[];
  readonly vPositions: number[];
  readonly advanceX: number;
  readonly pixelAddresses: number[];
  readonly attributeAddresses: number[];
  readonly masks: number[];
  extendedMode = false;
  readonly io: readonly IoClaim[] = [
    {
      lowMask: 255,
      lowValue: 0xf7,
      highMask: 255,
      highValue: 0xef,
      write: (_, value) => {
        this.extendedMode = !!(value & 64);
      },
    },
  ];
  private readonly extendedPixels: number[];
  private readonly extendedAttributes: number[];
  pixelFetch = 0;
  attributeFetch = 0;
  nextFetchIsPixel = true;
  hasFrame = false;
  private back: CapturePlanes;
  private front: CapturePlanes;
  private rgba?: Uint8ClampedArray;
  private renderDirty = true;
  private interruptActive = false;
  private renderedBorder = true;

  constructor(readonly preset: VideoPreset) {
    const { width, height, pixelsPerFrame } = preset;
    const symbols = pixelsPerFrame / 8;
    this.advanceX =
      ((preset.vAdvance - preset.hOrigin + width / 2) % (width / 2)) * 2;
    this.hPositions = new Array<number>(width).fill(0);
    this.vPositions = new Array<number>(symbols).fill(0);
    this.pixelAddresses = new Array<number>(symbols).fill(0);
    this.attributeAddresses = new Array<number>(symbols).fill(0);
    this.extendedPixels = new Array<number>(symbols).fill(0);
    this.extendedAttributes = new Array<number>(symbols).fill(0);
    this.masks = createRasterMasks(preset);
    const planes = (): CapturePlanes => ({
      events: createCaptureEvents(pixelsPerFrame),
      extended: new Array<number>(symbols).fill(0),
      pixels: new Array<number>(symbols).fill(0),
      attributes: new Array<number>(symbols).fill(0),
      border: new Array<number>(pixelsPerFrame).fill(0),
      interrupts: Array.from({ length: 3 }, () => ({
        start: 0,
        endExclusive: 0,
      })),
      interruptCount: 0,
    });
    this.back = planes();
    this.front = planes();
    for (let x = 0; x < width; x++) {
      this.hPositions[x] =
        preset.hReload +
        ((Math.floor(x / 2) + preset.hOrigin - preset.hReload) % (width / 2));
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const h = this.hPositions[x];
        const v =
          (preset.vOrigin +
            y +
            (this.advanceX > 0 && x >= this.advanceX ? 1 : 0)) %
          height;
        const c = y * width + x;
        if ((x & 7) === 0) {
          const s = c >>> 3;
          this.vPositions[s] = v;
          const column = (h >>> 2) & 31;
          // Initial 48K address wiring: V8 is not connected to screen RAM.
          this.pixelAddresses[s] = pixelAddress(v, column);
          this.attributeAddresses[s] = attributeAddress(v, column);
          // A13 follows horizontal paper; A14 selects the vertical-border page.
          const verticalBorder = v >= preset.vPaperEnd;
          const high =
            (inWindow(h, preset.hBorder) ? 0 : 0x2000) |
            (verticalBorder ? 0x4000 : 0);
          this.extendedPixels[s] = (this.pixelAddresses[s] & 0x1fff) | high;
          // The attribute-select circuit gates A11 off in vertical border.
          this.extendedAttributes[s] =
            (this.attributeAddresses[s] & (verticalBorder ? 0x17ff : 0x1fff)) |
            high;
        }
      }
    }
    this.clock = [
      {
        divider: 8,
        phase: 0,
        tick: (context) => {
          const c = context.framePosition;
          this.captureSymbol(c >>> 3, context.counters[Counter.flash]);
        },
      },
    ];
  }
  get rawCompleted(): CapturePlanes {
    return this.front;
  }
  get completed(): CapturePlanes {
    if (this.front.events)
      expandEvents(this.front.events, this.front.border, this.front.extended);
    const e = this.front.events;
    if (e && !e.intComplex) {
      this.front.interruptCount = e.intStart < 0 ? 0 : 1;
      this.front.interrupts[0].start = e.intStart;
      this.front.interrupts[0].endExclusive = e.intEnd;
    }
    return this.front;
  }
  captureSymbol(index: number, flash: number): void {
    const events = this.back.events;
    const mode = Number(this.extendedMode);
    if (events) {
      if (index === 0) events.initialExtended = mode;
      const previous = events.initialExtended ^ (events.modeCount & 1);
      if (mode !== previous) events.modeTimes[events.modeCount++] = index;
    }
    this.back.pixels[index] = this.pixelFetch & 255;
    this.back.attributes[index] = captureAttribute(
      this.attributeFetch,
      flash,
      this.preset.flashBit,
    );
  }
  fetch(bus: Pick<DeviceBus, "readMemory">, symbolIndex: number): void {
    if (this.nextFetchIsPixel)
      this.pixelFetch = bus.readMemory(
        this.extendedMode
          ? this.extendedPixels[symbolIndex]
          : this.pixelAddresses[symbolIndex],
      );
    else
      this.attributeFetch = bus.readMemory(
        this.extendedMode
          ? this.extendedAttributes[symbolIndex]
          : this.attributeAddresses[symbolIndex],
      );
    this.nextFetchIsPixel = !this.nextFetchIsPixel;
  }
  cpuAccess(): void {
    this.nextFetchIsPixel = true;
  }
  captureBorderSpan(start: number, end: number, latch: number): void {
    const e = this.back.events;
    if (!e || e.feDense) {
      this.back.border.fill(latch & 7, start, end);
      return;
    }
    if (start === 0) e.initialFe = latch;
    const previous = e.feCount ? e.feValues[e.feCount - 1] : e.initialFe;
    if (previous === latch) return;
    if (e.feCount === e.feTimes.length) {
      expandEvents(e, this.back.border, this.back.extended);
      e.feDense = true;
      this.back.border.fill(latch & 7, start, end);
    } else {
      e.feTimes[e.feCount] = start;
      e.feValues[e.feCount++] = latch;
    }
  }
  captureBorder(position: number, latch: number): void {
    this.captureBorderSpan(position, position + 1, latch);
  }
  captureInterrupt(position: number, active: boolean): void {
    this.interruptActive = active;
    const e = this.back.events;
    if (e && !e.intComplex) {
      if (active && e.intStart >= 0) {
        e.intComplex = true;
        this.back.interruptCount = 1;
        this.back.interrupts[0].start = e.intStart;
        this.back.interrupts[0].endExclusive = e.intEnd;
      } else {
        if (active) {
          e.intStart = position;
          e.intEnd = e.slots;
        } else if (e.intStart === position) {
          e.intStart = -1;
          e.intEnd = -1;
        } else e.intEnd = position;
        return;
      }
    }
    if (active) {
      const range = this.back.interrupts[this.back.interruptCount++];
      if (!range) throw new Error("Too many INT intervals in one raster frame");
      range.start = position;
      range.endExclusive = this.preset.pixelsPerFrame;
    } else if (this.back.interruptCount > 0) {
      const range = this.back.interrupts[this.back.interruptCount - 1];
      range.endExclusive = position;
      if (range.start === position) this.back.interruptCount--;
    }
  }
  finishFrame(): void {
    const old = this.front;
    this.front = this.back;
    this.back = old;
    this.back.interruptCount = 0;
    const events = this.back.events;
    if (events) {
      events.intStart = -1;
      events.intEnd = -1;
      events.intComplex = false;
      events.feCount = 0;
      events.feDense = false;
      events.modeCount = 0;
    }
    // A pulse crossing frame zero is clipped into each frame independently.
    if (this.interruptActive) this.captureInterrupt(0, true);
    this.hasFrame = true;
    this.renderDirty = true;
  }
  render(showBorder = true): Uint8ClampedArray {
    this.rgba ??= new Uint8ClampedArray(this.preset.pixelsPerFrame * 4);
    const rgba = this.rgba;
    if (!this.renderDirty && showBorder === this.renderedBorder) return rgba;
    renderCapturedFrame(this.front, this.masks, rgba, showBorder);
    this.renderDirty = false;
    this.renderedBorder = showBorder;
    return rgba;
  }
}
