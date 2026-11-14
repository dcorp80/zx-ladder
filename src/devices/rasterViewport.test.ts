import { expect, it } from "vitest";
import {
  copyRasterViewport,
  rasterViewport,
  renderCapturedFrame,
} from "./frameRenderer";
import type { CapturePlanes } from "./video";
import {
  LVIV_VIDEO_PRESET,
  PENTAGON_VIDEO_PRESET,
  type VideoPreset,
} from "./videoPresets";

const builtins = [
  {
    preset: PENTAGON_VIDEO_PRESET,
    viewport: { sourceX: 68, sourceY: 10, width: 370, height: 304 },
  },
  {
    preset: LVIV_VIDEO_PRESET,
    viewport: { sourceX: 80, sourceY: 20, width: 352, height: 288 },
  },
];

function technical(preset: VideoPreset, x: number, y: number): boolean {
  const h =
    preset.hReload +
    ((Math.floor(x / 2) + preset.hOrigin - preset.hReload) %
      (preset.width / 2));
  const advanceX =
    ((preset.vAdvance - preset.hOrigin + preset.width / 2) %
      (preset.width / 2)) *
    2;
  const v =
    (preset.vOrigin + y + (advanceX > 0 && x >= advanceX ? 1 : 0)) %
    preset.height;
  const inside = (value: number, [start, end]: readonly [number, number]) =>
    start < end ? value >= start && value < end : value >= start || value < end;
  return (
    inside(h, preset.hBlank) ||
    inside(h, preset.hSync) ||
    inside(v, preset.vBlank) ||
    inside(v, preset.vSync)
  );
}

function expectAllVisibleIncluded(preset: VideoPreset): void {
  const viewport = rasterViewport(preset, false);
  const included = new Uint8Array(preset.pixelsPerFrame);
  for (let y = 0; y < viewport.height; y++)
    for (let x = 0; x < viewport.width; x++) {
      const sourceX = (viewport.sourceX + x) % preset.width;
      const sourceY = (viewport.sourceY + y) % preset.height;
      included[sourceY * preset.width + sourceX] = 1;
    }
  let missed = 0;
  for (let y = 0; y < preset.height; y++)
    for (let x = 0; x < preset.width; x++)
      if (!technical(preset, x, y) && !included[y * preset.width + x]) missed++;
  expect(missed).toBe(0);
}

function expectCopy(preset: VideoPreset): void {
  const viewport = rasterViewport(preset, false);
  // Encode both full source coordinates, including bits above 255.
  const source = new Uint8ClampedArray(preset.pixelsPerFrame * 4);
  for (let y = 0; y < preset.height; y++)
    for (let x = 0; x < preset.width; x++) {
      const offset = (y * preset.width + x) * 4;
      source[offset] = x & 255;
      source[offset + 1] = y & 255;
      source[offset + 2] = (x >>> 8) | ((y >>> 8) << 1);
      source[offset + 3] = 255;
    }
  const original = new Uint8ClampedArray(source);
  const expected = new Uint8ClampedArray(viewport.width * viewport.height * 4);
  for (let y = 0; y < viewport.height; y++)
    for (let x = 0; x < viewport.width; x++) {
      const sourceX = (viewport.sourceX + x) % preset.width;
      const sourceY = (viewport.sourceY + y) % preset.height;
      const input = (sourceY * preset.width + sourceX) * 4;
      const output = (y * viewport.width + x) * 4;
      for (let channel = 0; channel < 4; channel++)
        expected[output + channel] = source[input + channel];
    }
  const storage = new Uint8ClampedArray(expected.length + 11).fill(237);
  const target = storage.subarray(5, storage.length - 6);
  copyRasterViewport(source, preset, target, viewport);
  expect(target).toEqual(expected);
  expect(storage.subarray(0, 5)).toEqual(new Uint8ClampedArray(5).fill(237));
  expect(storage.subarray(storage.length - 6)).toEqual(
    new Uint8ClampedArray(6).fill(237),
  );
  expect(source).toEqual(original);
}

it.each(builtins)(
  "preserves the complete $preset.id raster by default",
  ({ preset }) => {
    const expected = {
      sourceX: 0,
      sourceY: 0,
      width: preset.width,
      height: preset.height,
    };
    expect(rasterViewport(preset)).toEqual(expected);
    expect(rasterViewport(preset, true)).toEqual(expected);
    const source = Uint8ClampedArray.from(
      { length: preset.pixelsPerFrame * 4 },
      (_, index) => (index * 79 + (index >>> 10)) & 255,
    );
    const target = new Uint8ClampedArray(source.length);
    copyRasterViewport(source, preset, target, rasterViewport(preset));
    expect(target).toEqual(source);
  },
);

it.each(builtins)(
  "crops exactly the visible counter area for $preset.id",
  ({ preset, viewport }) => {
    expect(rasterViewport(preset, false)).toEqual(viewport);
    let technicalPixels = 0;
    for (let y = viewport.sourceY; y < viewport.sourceY + viewport.height; y++)
      for (let x = viewport.sourceX; x < viewport.sourceX + viewport.width; x++)
        if (technical(preset, x % preset.width, y % preset.height))
          technicalPixels++;
    expect(technicalPixels).toBe(0);
    expectAllVisibleIncluded(preset);
    expectCopy(preset);
  },
);

it("wraps vertically when the raster origin lies inside visible counter lines", () => {
  const preset = { ...PENTAGON_VIDEO_PRESET, id: "vertical-wrap", vOrigin: 0 };
  expect(rasterViewport(preset, false)).toEqual({
    sourceX: 68,
    sourceY: 256,
    width: 370,
    height: 304,
  });
  expectAllVisibleIncluded(preset);
  expectCopy(preset);
});

it("retains visible rows on both sides of a wrapped horizontal V advance", () => {
  const preset = {
    ...PENTAGON_VIDEO_PRESET,
    id: "horizontal-and-vertical-wrap",
    hOrigin: 32,
    vOrigin: 0,
  };
  expect(rasterViewport(preset, false)).toEqual({
    sourceX: 140,
    sourceY: 255,
    width: 370,
    height: 305,
  });
  expectAllVisibleIncluded(preset);
  expectCopy(preset);
});

it("keeps the crop independent of the delayed raw border signal", () => {
  for (const { preset, viewport } of builtins) {
    expect(rasterViewport({ ...preset, borderShift: 0 }, false)).toEqual(
      viewport,
    );
    expect(rasterViewport({ ...preset, borderShift: 15 }, false)).toEqual(
      viewport,
    );
  }
});

it("includes every visible pixel when custom sync windows split visible spans", () => {
  const preset = {
    ...PENTAGON_VIDEO_PRESET,
    id: "disjoint-sync",
    hSync: [128, 144] as const,
    vSync: [192, 196] as const,
  };
  expect(rasterViewport(preset, false)).toEqual({
    sourceX: 68,
    sourceY: 10,
    width: 370,
    height: 304,
  });
  expectAllVisibleIncluded(preset);
});

it("retains the complete raster when a custom preset blanks every pixel", () => {
  const preset = {
    ...PENTAGON_VIDEO_PRESET,
    id: "all-blank",
    vBlank: [0, PENTAGON_VIDEO_PRESET.height] as const,
  };
  expect(rasterViewport(preset, false)).toEqual(rasterViewport(preset, true));
  expectCopy(preset);
});

it("keeps INT overlays in the technical view and removes them from normal pixels", () => {
  const frame: CapturePlanes = {
    pixels: [255],
    attributes: [2],
    border: new Array<number>(8).fill(1),
    extended: [0],
    interrupts: [{ start: 1, endExclusive: 4 }],
    interruptCount: 1,
  };
  const masks = new Array<number>(8).fill(0);
  const technicalView = renderCapturedFrame(
    frame,
    masks,
    new Uint8ClampedArray(32),
  );
  const visibleView = renderCapturedFrame(
    frame,
    masks,
    new Uint8ClampedArray(32),
    true,
    false,
  );
  expect([...technicalView.subarray(4, 8)]).toEqual([255, 96, 0, 255]);
  for (let i = 0; i < 8; i++)
    expect([...visibleView.subarray(i * 4, i * 4 + 4)]).toEqual([
      215, 0, 0, 255,
    ]);
});
