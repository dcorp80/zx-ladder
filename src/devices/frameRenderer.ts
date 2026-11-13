import { createCaptureEvents } from "./captureEvents";
import type { CapturePlanes } from "./video";
import type { VideoPreset } from "./videoPresets";

const BORDER = 1,
  BLANK = 2,
  SYNC = 4;
// Building through byte views gives native-endian words on every host.
const paletteBytes = new Uint8Array(19 * 4);
for (let i = 0; i < 16; i++) {
  const level = i & 8 ? 255 : 215;
  paletteBytes.set(
    [i & 2 ? level : 0, i & 4 ? level : 0, i & 1 ? level : 0, 255],
    i * 4,
  );
}
paletteBytes.set([20, 20, 20, 255, 54, 54, 54, 255, 255, 96, 0, 255], 64);
const palette = new Uint32Array(paletteBytes.buffer);
const outputViews = new WeakMap<Uint8ClampedArray, Uint32Array>();
interface RasterSpan {
  start: number;
  end: number;
  kind: number;
}
type RasterMasks = number[] | Uint8Array;
const spanCache = new WeakMap<RasterMasks, RasterSpan[]>();
// Masks are immutable preset geometry. Compile once, not once per frame.
function rasterSpans(masks: RasterMasks): RasterSpan[] {
  const cached = spanCache.get(masks);
  if (cached) return cached;
  const spans: RasterSpan[] = [];
  for (let start = 0; start < masks.length; ) {
    const mask = masks[start];
    const kind = mask & SYNC ? SYNC : mask & BLANK ? BLANK : mask & BORDER;
    let end = start + 1;
    while (end < masks.length) {
      const next = masks[end];
      if ((next & SYNC ? SYNC : next & BLANK ? BLANK : next & BORDER) !== kind)
        break;
      end++;
    }
    spans.push({ start, end, kind });
    start = end;
  }
  spanCache.set(masks, spans);
  return spans;
}
export function renderCapturedFrame(
  frame: CapturePlanes,
  masks: RasterMasks,
  rgba: Uint8ClampedArray,
  showBorder = true,
): Uint8ClampedArray {
  // Canvas ImageData is aligned; retain correct output for arbitrary subviews.
  const aligned = rgba.byteOffset % 4 === 0;
  let words = outputViews.get(rgba);
  if (!words || words.length !== masks.length) {
    words = aligned
      ? new Uint32Array(rgba.buffer, rgba.byteOffset, masks.length)
      : new Uint32Array(masks.length);
    outputViews.set(rgba, words);
  }
  const { pixels, attributes, border, extended, events } = frame;
  let modeIndex = 0,
    mode = events?.initialExtended ?? 0;
  let feIndex = 0,
    fe = events?.initialFe ?? 0;
  for (const { start, end, kind } of rasterSpans(masks)) {
    if (kind === SYNC || kind === BLANK) {
      words.fill(palette[kind === SYNC ? 17 : 16], start, end);
      continue;
    }
    const borderSpan = showBorder && kind === BORDER;
    for (let c = start; c < end; ) {
      const symbol = c >>> 3;
      const stop = Math.min(end, (symbol + 1) * 8);
      if (events?.modeEvents)
        while (
          modeIndex < events.modeCount &&
          events.modeTimes[modeIndex] <= symbol
        ) {
          mode ^= 1;
          modeIndex++;
        }
      const expanded = events?.modeEvents ? mode : extended[symbol];
      if (borderSpan && !expanded) {
        for (; c < stop; c++) {
          if (events && !events.feDense) {
            while (feIndex < events.feCount && events.feTimes[feIndex] <= c)
              fe = events.feValues[feIndex++];
            words[c] = palette[fe & 7];
          } else words[c] = palette[border[c] & 7];
        }
      } else {
        const attr = attributes[symbol];
        const bits = pixels[symbol] ^ (attr & 0x80 ? 255 : 0);
        const bright = attr & 64 ? 8 : 0;
        const ink = palette[(attr & 7) | bright];
        const paper = palette[((attr >>> 3) & 7) | bright];
        for (; c < stop; c++) words[c] = bits & (128 >>> (c & 7)) ? ink : paper;
      }
    }
  }
  // INT overlays include blanking/sync and need not align with symbols/spans.
  if (events && !events.intComplex) {
    if (events.intStart >= 0)
      words.fill(palette[18], events.intStart, events.intEnd);
  } else
    for (let i = 0; i < frame.interruptCount; i++) {
      const { start, endExclusive } = frame.interrupts[i];
      words.fill(palette[18], start, endExclusive);
    }
  if (!aligned) rgba.set(new Uint8Array(words.buffer));
  return rgba;
}

// Static output geometry only; address arbitration remains in TimedVideo.
export function createRasterMasks(preset: VideoPreset): number[] {
  const { width, height, pixelsPerFrame } = preset;
  const masks = new Array<number>(pixelsPerFrame).fill(0);
  const advanceX =
    ((preset.vAdvance - preset.hOrigin + width / 2) % (width / 2)) * 2;
  const inside = (v: number, r: readonly [number, number]) =>
    r[0] < r[1] ? v >= r[0] && v < r[1] : v >= r[0] || v < r[1];
  for (let c = 0; c < pixelsPerFrame; c++) {
    const x = c % width,
      y = Math.floor(c / width);
    const h =
      preset.hReload +
      ((Math.floor(x / 2) + preset.hOrigin - preset.hReload) % (width / 2));
    const v =
      (preset.vOrigin + y + (advanceX > 0 && x >= advanceX ? 1 : 0)) % height;
    masks[c] =
      (inside(h, preset.hBorder) || v >= preset.vPaperEnd ? BORDER : 0) |
      (inside(h, preset.hBlank) || inside(v, preset.vBlank) ? BLANK : 0) |
      (inside(h, preset.hSync) || inside(v, preset.vSync) ? SYNC : 0);
  }
  const border = masks.map((v) => v & BORDER),
    delay = preset.borderShift * 2;
  for (let c = 0; c < pixelsPerFrame; c++)
    masks[c] =
      (masks[c] & ~BORDER) |
      border[(c - delay + pixelsPerFrame) % pixelsPerFrame];
  return masks;
}
// Fixed reusable transport: legacy planes/FE region, INT header, then a mode
// event header and room for one transition per symbol (the physical maximum).
// Capture arrays in the machine are never detached; only this copy is transferred.
export const captureByteLength = (slots: number) =>
  slots + (slots / 8) * 7 + 34;
/** Views are retained with their backing buffer; refresh scalar metadata after copying a frame. */
export interface CaptureViews extends CapturePlanes {
  refresh(): void;
}
export function captureViews(
  bytes: Uint8ClampedArray,
  slots: number,
): CaptureViews {
  const symbols = slots / 8;
  const view = (offset: number, length: number) =>
    new Uint8Array(bytes.buffer, bytes.byteOffset + offset, length);
  const ints = new DataView(
    bytes.buffer,
    bytes.byteOffset + slots + symbols * 3,
    28,
  );
  const events = createCaptureEvents(slots);
  const metadata = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const frame: CaptureViews = {
    pixels: view(0, symbols),
    attributes: view(symbols, symbols),
    extended: view(symbols * 2, symbols),
    border: view(symbols * 3, slots),
    interruptCount: 0,
    interrupts: Array.from({ length: 3 }, () => ({
      start: 0,
      endExclusive: 0,
    })),
    refresh() {
      const feOffset = symbols * 3;
      const modeHeader = slots + symbols * 3 + 28;
      events.modeEvents = bytes[modeHeader] === 254;
      if (events.modeEvents || bytes[feOffset] === 254) {
        this.events = events;
        if (events.modeEvents) {
          events.initialExtended = bytes[modeHeader + 1];
          events.modeCount = metadata.getUint32(modeHeader + 2, true);
          if (events.modeCount > symbols)
            throw new RangeError("Invalid mode event count");
          for (let i = 0; i < events.modeCount; i++)
            events.modeTimes[i] = metadata.getUint32(
              modeHeader + 6 + i * 4,
              true,
            );
        }
        events.feDense = bytes[feOffset] !== 254;
        if (!events.feDense) {
          events.initialFe = bytes[feOffset + 1];
          events.feCount = metadata.getUint32(feOffset + 2, true);
          for (let i = 0; i < events.feCount; i++) {
            events.feTimes[i] = metadata.getUint32(feOffset + 6 + i * 5, true);
            events.feValues[i] = bytes[feOffset + 10 + i * 5];
          }
        }
      } else {
        this.events = undefined;
        events.modeEvents = false;
        events.feDense = true;
      }
      const intTag = ints.getUint32(0, true);
      if (intTag === 0xffffffff) {
        this.events = events;
        events.intComplex = false;
        events.intStart = ints.getInt32(4, true);
        events.intEnd = ints.getInt32(8, true);
        this.interruptCount = events.intStart < 0 ? 0 : 1;
        this.interrupts[0].start = events.intStart;
        this.interrupts[0].endExclusive = events.intEnd;
        return;
      }
      events.intComplex = true;
      this.interruptCount = intTag;
      for (let i = 0; i < 3; i++) {
        this.interrupts[i].start = ints.getUint32(4 + i * 8, true);
        this.interrupts[i].endExclusive = ints.getUint32(8 + i * 8, true);
      }
    },
  };
  frame.refresh();
  return frame;
}
function write32(
  bytes: Uint8ClampedArray,
  offset: number,
  value: number,
): void {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
  bytes[offset + 2] = (value >>> 16) & 255;
  bytes[offset + 3] = value >>> 24;
}
export function copyCapture(
  frame: CapturePlanes,
  bytes: Uint8ClampedArray,
): void {
  const symbols = frame.pixels.length,
    slots = frame.border.length;
  bytes.set(frame.pixels);
  bytes.set(frame.attributes, symbols);
  const e = frame.events;

  const modeHeader = slots + symbols * 3 + 28;
  if (e) {
    bytes[modeHeader] = 254;
    bytes[modeHeader + 1] = e.initialExtended;
    write32(bytes, modeHeader + 2, e.modeCount);
    for (let i = 0; i < e.modeCount; i++)
      write32(bytes, modeHeader + 6 + i * 4, e.modeTimes[i]);
  } else {
    bytes[modeHeader] = 0;
    bytes.set(frame.extended, symbols * 2);
  }
  if (e && !e.feDense) {
    const offset = symbols * 3;
    bytes[offset] = 254;
    bytes[offset + 1] = e.initialFe;
    write32(bytes, offset + 2, e.feCount);
    for (let i = 0; i < e.feCount; i++) {
      write32(bytes, offset + 6 + i * 5, e.feTimes[i]);
      bytes[offset + 10 + i * 5] = e.feValues[i];
    }
  } else bytes.set(frame.border, symbols * 3);
  const intOffset = slots + symbols * 3;
  if (e && !e.intComplex) {
    write32(bytes, intOffset, 0xffffffff);
    write32(bytes, intOffset + 4, e.intStart);
    write32(bytes, intOffset + 8, e.intEnd);
    return;
  }
  write32(bytes, intOffset, frame.interruptCount);
  for (let i = 0; i < 3; i++) {
    write32(bytes, intOffset + 4 + i * 8, frame.interrupts[i].start);
    write32(bytes, intOffset + 8 + i * 8, frame.interrupts[i].endExclusive);
  }
}
