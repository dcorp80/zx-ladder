import { expect, it } from "vitest";
import {
  captureByteLength,
  captureViews,
  copyCapture,
  createRasterMasks,
  renderCapturedFrame,
} from "./frameRenderer";
import { type CapturePlanes, TimedVideo } from "./video";
import { LVIV_VIDEO_PRESET, PENTAGON_VIDEO_PRESET } from "./videoPresets";

const BORDER = 1,
  BLANK = 2,
  SYNC = 4;
// Frozen pre-extraction scalar renderer: independent output oracle.
function reference(
  frame: CapturePlanes,
  masks: Uint8Array,
  rgba: Uint8ClampedArray,
  showBorder: boolean,
) {
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
it.each([PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET])(
  "preserves captured raster output and ownership for $id",
  (preset) => {
    const video = new TimedVideo(preset),
      frame = video.completed;
    for (let i = 0; i < frame.pixels.length; i++) {
      frame.pixels[i] = (i * 37) & 255;
      frame.attributes[i] = (i * 71) & 255;
      frame.extended[i] = (i >>> 3) & 1;
    }
    for (let i = 0; i < frame.border.length; i++) frame.border[i] = i & 7;
    frame.interruptCount = 3;
    frame.interrupts[0] = { start: 0, endExclusive: 17 };
    frame.interrupts[1] = { start: 711, endExclusive: 1234 };
    frame.interrupts[2] = {
      start: preset.pixelsPerFrame - 50,
      endExclusive: preset.pixelsPerFrame,
    };
    const bytes = new Uint8ClampedArray(
      captureByteLength(preset.pixelsPerFrame),
    );
    copyCapture(frame, bytes);
    const decoded = captureViews(bytes, preset.pixelsPerFrame),
      masks = createRasterMasks(preset);
    expect(masks).toEqual(video.masks);
    for (const border of [true, false]) {
      const target = new Uint8ClampedArray(preset.pixelsPerFrame * 4);
      expect(renderCapturedFrame(decoded, masks, target, border)).toBe(target);
      expect(target).toEqual(
        reference(
          frame,
          video.masks,
          new Uint8ClampedArray(target.length),
          border,
        ),
      );
    }
    const before = decoded.pixels[0];
    frame.pixels[0] ^= 255;
    expect(decoded.pixels[0]).toBe(before);
  },
);
