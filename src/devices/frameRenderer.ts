import type { CapturePlanes } from "./video";
import type { VideoPreset } from "./videoPresets";

const BORDER = 1,
  BLANK = 2,
  SYNC = 4;
export function renderCapturedFrame(
  frame: CapturePlanes,
  masks: Uint8Array,
  rgba: Uint8ClampedArray,
  showBorder = true,
): Uint8ClampedArray {
  const { pixels, attributes, border } = frame;
  for (let c = 0; c < masks.length; c++) {
    const offset = c * 4;
    const mask = masks[c];
    if (mask & (SYNC | BLANK)) {
      const shade = mask & SYNC ? 54 : 20;
      rgba[offset] = shade;
      rgba[offset + 1] = shade;
      rgba[offset + 2] = shade;
    } else {
      const s = c >>> 3;
      const attr = attributes[s];
      let bit = (pixels[s] >>> (7 - (c & 7))) & 1;
      if (attr & 0x80) bit ^= 1;
      const useBorder =
        showBorder && !frame.extended[s] && (mask & BORDER) !== 0;
      const color = useBorder
        ? border[c] & 7
        : bit
          ? attr & 7
          : (attr >>> 3) & 7;
      const level = !useBorder && attr & 64 ? 255 : 215;
      rgba[offset] = color & 2 ? level : 0;
      rgba[offset + 1] = color & 4 ? level : 0;
      rgba[offset + 2] = color & 1 ? level : 0;
    }
    rgba[offset + 3] = 255;
  }
  // Overlay only captured intervals, including pixels in blanking and sync.
  for (let i = 0; i < frame.interruptCount; i++) {
    const { start, endExclusive } = frame.interrupts[i];
    for (let c = start; c < endExclusive; c++) {
      const offset = c * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 96;
      rgba[offset + 2] = 0;
    }
  }
  return rgba;
}

// Static output geometry only; address arbitration remains in TimedVideo.
export function createRasterMasks(preset: VideoPreset): Uint8Array {
  const { width, height, pixelsPerFrame } = preset;
  const masks = new Uint8Array(pixelsPerFrame);
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
// Packed transport: three symbol planes, slot border plane, then seven uint32s.
// Capture arrays in the machine are never detached; only this copy is transferred.
export const captureByteLength = (slots: number) =>
  slots + (slots / 8) * 3 + 28;
export function captureViews(
  bytes: Uint8ClampedArray,
  slots: number,
): CapturePlanes {
  const symbols = slots / 8;
  const view = (offset: number, length: number) =>
    new Uint8Array(bytes.buffer, bytes.byteOffset + offset, length);
  const ints = new DataView(
    bytes.buffer,
    bytes.byteOffset + slots + symbols * 3,
    28,
  );
  return {
    pixels: view(0, symbols),
    attributes: view(symbols, symbols),
    extended: view(symbols * 2, symbols),
    border: view(symbols * 3, slots),
    interruptCount: ints.getUint32(0, true),
    interrupts: Array.from({ length: 3 }, (_, i) => ({
      start: ints.getUint32(4 + i * 8, true),
      endExclusive: ints.getUint32(8 + i * 8, true),
    })),
  };
}
export function copyCapture(
  frame: CapturePlanes,
  bytes: Uint8ClampedArray,
): void {
  const symbols = frame.pixels.length,
    slots = frame.border.length;
  bytes.set(frame.pixels);
  bytes.set(frame.attributes, symbols);
  bytes.set(frame.extended, symbols * 2);
  bytes.set(frame.border, symbols * 3);
  const ints = new DataView(
    bytes.buffer,
    bytes.byteOffset + slots + symbols * 3,
    28,
  );
  ints.setUint32(0, frame.interruptCount, true);
  for (let i = 0; i < 3; i++) {
    ints.setUint32(4 + i * 8, frame.interrupts[i].start, true);
    ints.setUint32(8 + i * 8, frame.interrupts[i].endExclusive, true);
  }
}
