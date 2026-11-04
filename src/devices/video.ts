import type { VideoPreset } from "../devices/videoPresets";
import { Counter } from "../machine/counters";
import type { ClockHook, Device, DeviceBus } from "../machine/devices";

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
export interface CapturePlanes {
  pixels: Uint8Array;
  attributes: Uint8Array;
  /** Full FE latch sampled each 7 MHz slot; low three bits are border. */
  border: Uint8Array;
  /** Fixed storage: carry-in plus normal/late trigger intervals. */
  interrupts: InterruptInterval[];
  interruptCount: number;
}
export interface RasterVideo extends Device {
  readonly hPositions: Uint16Array;
  readonly vPositions: Uint16Array;
  readonly advanceX: number;
  readonly completed: CapturePlanes;
  readonly hasFrame: boolean;
  fetch(bus: DeviceBus, symbolIndex: number): void;
  cpuAccess(): void;
  captureBorder(position: number, latch: number): void;
  /** Called only when sampled INT changes; frame clipping is internal. */
  captureInterrupt(position: number, active: boolean): void;
  finishFrame(): void;
  render(showBorder?: boolean): Uint8ClampedArray;
}

const BORDER = 1,
  BLANK = 2,
  SYNC = 4;
const inWindow = (v: number, range: readonly [number, number]) =>
  range[0] < range[1]
    ? v >= range[0] && v < range[1]
    : v >= range[0] || v < range[1];

export class TimedVideo implements RasterVideo {
  readonly id = "video";
  readonly clock: readonly ClockHook[];
  readonly hPositions: Uint16Array;
  readonly vPositions: Uint16Array;
  readonly advanceX: number;
  readonly pixelAddresses: Uint16Array;
  readonly attributeAddresses: Uint16Array;
  readonly masks: Uint8Array;
  pixelFetch = 0;
  attributeFetch = 0;
  nextFetchIsPixel = true;
  hasFrame = false;
  private back: CapturePlanes;
  private front: CapturePlanes;
  private readonly rgba: Uint8ClampedArray;
  private renderDirty = true;
  private interruptActive = false;
  private renderedBorder = true;

  constructor(readonly preset: VideoPreset) {
    const { width, height, pixelsPerFrame } = preset;
    const symbols = pixelsPerFrame / 8;
    this.advanceX =
      ((preset.vAdvance - preset.hOrigin + width / 2) % (width / 2)) * 2;
    this.hPositions = new Uint16Array(width);
    this.vPositions = new Uint16Array(symbols);
    this.pixelAddresses = new Uint16Array(symbols);
    this.attributeAddresses = new Uint16Array(symbols);
    this.masks = new Uint8Array(pixelsPerFrame);
    const planes = (): CapturePlanes => ({
      pixels: new Uint8Array(symbols),
      attributes: new Uint8Array(symbols),
      border: new Uint8Array(pixelsPerFrame),
      interrupts: Array.from({ length: 3 }, () => ({
        start: 0,
        endExclusive: 0,
      })),
      interruptCount: 0,
    });
    this.back = planes();
    this.front = planes();
    this.rgba = new Uint8ClampedArray(pixelsPerFrame * 4);
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
        this.masks[c] =
          (inWindow(h, preset.hBorder) || v >= preset.vPaperEnd ? BORDER : 0) |
          (inWindow(h, preset.hBlank) || inWindow(v, preset.vBlank)
            ? BLANK
            : 0) |
          (inWindow(h, preset.hSync) || inWindow(v, preset.vSync) ? SYNC : 0);
        if ((x & 7) === 0) {
          const s = c >>> 3;
          this.vPositions[s] = v;
          const column = (h >>> 2) & 31;
          // Initial 48K address wiring: V8 is not connected to screen RAM.
          this.pixelAddresses[s] = pixelAddress(v, column);
          this.attributeAddresses[s] = attributeAddress(v, column);
        }
      }
    }
    this.clock = [
      {
        divider: 1,
        phase: 0,
        tick: (context) => {
          const c = context.framePosition;
          if ((c & 7) === 0)
            this.captureSymbol(c >>> 3, context.counters[Counter.flash]);
        },
      },
    ];
  }
  get completed(): CapturePlanes {
    return this.front;
  }
  captureSymbol(index: number, flash: number): void {
    this.back.pixels[index] = this.pixelFetch;
    this.back.attributes[index] = captureAttribute(
      this.attributeFetch,
      flash,
      this.preset.flashBit,
    );
  }
  fetch(bus: DeviceBus, symbolIndex: number): void {
    if (this.nextFetchIsPixel)
      this.pixelFetch = bus.readMemory(this.pixelAddresses[symbolIndex]);
    else
      this.attributeFetch = bus.readMemory(
        this.attributeAddresses[symbolIndex],
      );
    this.nextFetchIsPixel = !this.nextFetchIsPixel;
  }
  cpuAccess(): void {
    this.nextFetchIsPixel = true;
  }
  captureBorder(position: number, latch: number): void {
    this.back.border[position] = latch;
  }
  captureInterrupt(position: number, active: boolean): void {
    this.interruptActive = active;
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
    // A pulse crossing frame zero is clipped into each frame independently.
    if (this.interruptActive) this.captureInterrupt(0, true);
    this.hasFrame = true;
    this.renderDirty = true;
  }
  render(showBorder = true): Uint8ClampedArray {
    if (!this.renderDirty && showBorder === this.renderedBorder)
      return this.rgba;
    const { pixels, attributes, border } = this.front;
    for (let c = 0; c < this.preset.pixelsPerFrame; c++) {
      const offset = c * 4;
      const mask = this.masks[c];
      if (mask & (SYNC | BLANK)) {
        const shade = mask & SYNC ? 54 : 20;
        this.rgba[offset] = shade;
        this.rgba[offset + 1] = shade;
        this.rgba[offset + 2] = shade;
      } else {
        const s = c >>> 3;
        const attr = attributes[s];
        let bit = (pixels[s] >>> (7 - (c & 7))) & 1;
        if (attr & 0x80) bit ^= 1;
        const useBorder = showBorder && (mask & BORDER) !== 0;
        const color = useBorder
          ? border[c] & 7
          : bit
            ? attr & 7
            : (attr >>> 3) & 7;
        const level = !useBorder && attr & 64 ? 255 : 215;
        this.rgba[offset] = color & 2 ? level : 0;
        this.rgba[offset + 1] = color & 4 ? level : 0;
        this.rgba[offset + 2] = color & 1 ? level : 0;
      }
      this.rgba[offset + 3] = 255;
    }
    // Overlay only captured intervals, including pixels in blanking and sync.
    for (let i = 0; i < this.front.interruptCount; i++) {
      const { start, endExclusive } = this.front.interrupts[i];
      for (let c = start; c < endExclusive; c++) {
        const offset = c * 4;
        this.rgba[offset] = 255;
        this.rgba[offset + 1] = 96;
        this.rgba[offset + 2] = 0;
      }
    }
    this.renderDirty = false;
    this.renderedBorder = showBorder;
    return this.rgba;
  }
}
