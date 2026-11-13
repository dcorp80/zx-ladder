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
  masks: number[] | Uint8Array,
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
    frame.events = undefined;
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

it("matches every pixel/attribute combination with slot-varying border and masks", () => {
  const symbols = 256 * 256,
    slots = symbols * 8;
  const frame: CapturePlanes = {
    pixels: new Uint8Array(symbols),
    attributes: new Uint8Array(symbols),
    extended: new Uint8Array(symbols),
    border: new Uint8Array(slots),
    interrupts: [],
    interruptCount: 0,
  };
  const masks = new Uint8Array(slots);
  for (let s = 0; s < symbols; s++) {
    frame.pixels[s] = s & 255;
    frame.attributes[s] = s >>> 8;
    frame.extended[s] = s & 1;
  }
  for (let c = 0; c < slots; c++) {
    masks[c] = (c + (c >>> 3)) & 7;
    frame.border[c] = (c * 3) & 7;
  }
  for (const border of [true, false]) {
    expect(
      renderCapturedFrame(
        frame,
        masks,
        new Uint8ClampedArray(slots * 4),
        border,
      ),
    ).toEqual(
      reference(frame, masks, new Uint8ClampedArray(slots * 4), border),
    );
  }
});

it("preserves partial-symbol spans and unaligned target views without touching surrounding bytes", () => {
  const masks = Uint8Array.from([
    0, 1, 2, 4, 6, 0, 1, 0, 4, 4, 2, 1, 0, 1, 0, 0, 1, 2, 0,
  ]);
  const frame: CapturePlanes = {
    pixels: Uint8Array.from([0xa5, 0x3c, 0xff]),
    attributes: Uint8Array.from([0xc7, 0x2a, 0x76]),
    extended: Uint8Array.from([0, 1, 0]),
    border: Uint8Array.from(masks, (_, i) => i & 7),
    interrupts: [{ start: 3, endExclusive: 11 }],
    interruptCount: 1,
  };
  for (const offset of [0, 1, 4]) {
    for (const border of [true, false]) {
      const backing = new Uint8ClampedArray(masks.length * 4 + offset + 5).fill(
        123,
      );
      const target = backing.subarray(offset, offset + masks.length * 4);
      expect(renderCapturedFrame(frame, masks, target, border)).toBe(target);
      expect(target).toEqual(
        reference(frame, masks, new Uint8ClampedArray(target.length), border),
      );
      expect(Array.from(backing.subarray(0, offset))).toEqual(
        Array(offset).fill(123),
      );
      expect(Array.from(backing.subarray(offset + target.length))).toEqual(
        Array(5).fill(123),
      );
    }
  }
});

it("refreshes capture metadata in place while retaining all views and interval objects", () => {
  const slots = 16,
    length = captureByteLength(slots);
  const bytes = new Uint8ClampedArray(length + 5).subarray(3, 3 + length);
  const source: CapturePlanes = {
    pixels: Uint8Array.from([0xa5, 0x3c]),
    attributes: Uint8Array.from([0xc7, 0x2a]),
    extended: Uint8Array.from([0, 1]),
    border: new Uint8Array(slots).fill(3),
    interruptCount: 1,
    interrupts: [
      { start: 2, endExclusive: 5 },
      { start: 0, endExclusive: 0 },
      { start: 0, endExclusive: 0 },
    ],
  };
  copyCapture(source, bytes);
  const views = captureViews(bytes, slots);
  const pixels = views.pixels,
    attributes = views.attributes,
    extended = views.extended,
    border = views.border;
  const intervals = views.interrupts,
    first = intervals[0],
    second = intervals[1],
    third = intervals[2];
  for (const count of [3, 0, 1]) {
    source.pixels[0] ^= 255;
    source.attributes[1] ^= 0xc0;
    source.extended[0] ^= 1;
    source.border.fill(count);
    source.interruptCount = count;
    for (let i = 0; i < 3; i++) {
      source.interrupts[i].start = i + count;
      source.interrupts[i].endExclusive = i + count + 3;
    }
    copyCapture(source, bytes);
    views.refresh();
    expect(views.pixels).toBe(pixels);
    expect(views.attributes).toBe(attributes);
    expect(views.extended).toBe(extended);
    expect(views.border).toBe(border);
    expect(views.interrupts).toBe(intervals);
    expect(intervals[0]).toBe(first);
    expect(intervals[1]).toBe(second);
    expect(intervals[2]).toBe(third);
    expect(views.interruptCount).toBe(count);
    expect(views.interrupts).toEqual(source.interrupts);
    const masks = new Uint8Array(slots);
    expect(
      renderCapturedFrame(views, masks, new Uint8ClampedArray(slots * 4)),
    ).toEqual(reference(source, masks, new Uint8ClampedArray(slots * 4), true));
  }
});

it("replays FE and mode events identically through transport, including FE overflow and more than 32 mode transitions", () => {
  for (const overflow of [false, true]) {
    const video = new TimedVideo(PENTAGON_VIDEO_PRESET);
    const n = PENTAGON_VIDEO_PRESET.pixelsPerFrame;
    const stride = overflow ? 1 : 8000;
    for (let c = 0; c < n; c += stride)
      video.captureBorderSpan(
        c,
        Math.min(n, c + stride),
        Math.floor(c / stride) & 7,
      );
    for (let s = 0; s < n / 8; s++) {
      video.extendedMode = overflow ? !!(s & 1) : s >= 40 && s < 80;
      video.pixelFetch = (s * 37) & 255;
      video.attributeFetch = (s * 71) & 255;
      video.captureSymbol(s, 17);
    }
    video.captureInterrupt(100, true);
    video.captureInterrupt(137, false);
    video.finishFrame();
    const raw = video.rawCompleted,
      events = raw.events;
    expect(events?.modeCount).toBe(overflow ? n / 8 - 1 : 2);
    expect(events?.modeEvents).toBe(true);
    expect(events?.feDense).toBe(overflow);
    const bytes = new Uint8ClampedArray(captureByteLength(n));
    copyCapture(raw, bytes);
    const decoded = captureViews(bytes, n);
    const expanded = video.completed;
    for (const border of [true, false]) {
      const expected = reference(
        expanded,
        video.masks,
        new Uint8ClampedArray(n * 4),
        border,
      );
      expect(video.render(border)).toEqual(expected);
      expect(
        renderCapturedFrame(
          decoded,
          video.masks,
          new Uint8ClampedArray(n * 4),
          border,
        ),
      ).toEqual(expected);
    }
  }
});

it("retains grown mode arrays across frame reuse and ignores stale tail entries", () => {
  const preset = PENTAGON_VIDEO_PRESET,
    video = new TimedVideo(preset);
  const bytes = new Uint8ClampedArray(captureByteLength(preset.pixelsPerFrame));
  const decoded = captureViews(bytes, preset.pixelsPerFrame);
  let firstTimes: number[] | undefined;
  for (const [frameIndex, flips] of [65, 1, 1, 0].entries()) {
    for (let s = 0; s < preset.pixelsPerFrame / 8; s++) {
      video.extendedMode = !!(Math.min(s, flips) & 1);
      video.captureSymbol(s, 0);
    }
    video.finishFrame();
    const raw = video.rawCompleted,
      events = raw.events;
    expect(events?.modeCount).toBe(flips);
    if (frameIndex === 0) firstTimes = events?.modeTimes;
    if (frameIndex === 2) {
      expect(events?.modeTimes).toBe(firstTimes);
      expect(events?.modeTimes.length).toBe(65);
    }
    copyCapture(raw, bytes);
    decoded.refresh();
    expect(decoded.events?.modeCount).toBe(flips);
    expect(decoded.events?.modeTimes.length).toBe(65);
    expect(
      renderCapturedFrame(
        decoded,
        video.masks,
        new Uint8ClampedArray(preset.pixelsPerFrame * 4),
      ),
    ).toEqual(
      reference(
        video.completed,
        video.masks,
        new Uint8ClampedArray(preset.pixelsPerFrame * 4),
        true,
      ),
    );
  }
});
