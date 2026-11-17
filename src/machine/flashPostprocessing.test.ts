import { expect, it } from "vitest";
import {
  captureByteLength,
  captureViews,
  copyCapture,
  createRasterMasks,
  renderCapturedFrame,
} from "../devices/frameRenderer";
import { type CapturePlanes, TimedVideo } from "../devices/video";
import {
  LVIV_VIDEO_PRESET,
  PENTAGON_VIDEO_PRESET,
  type VideoPreset,
} from "../devices/videoPresets";
import { Counter } from "./counters";
import { createMachine, type Machine } from "./machine";

function fillScreen(machine: Machine): void {
  machine.memory.ramPages[5].fill(255, 0, 0x1800);
  machine.memory.ramPages[5].fill(0x82, 0x1800, 0x1b00);
}

function pair(preset: VideoPreset, cpu7 = false) {
  const rom = new Uint8Array(16384);
  rom[0] = 0x76;
  const current = createMachine({ rom, videoPreset: preset, cpu7 });
  // The default standalone TimedVideo keeps the old capture-time mask.
  const legacy = createMachine({
    rom,
    videoPreset: preset,
    cpu7,
    videoFactory: (p) => new TimedVideo(p),
  });
  fillScreen(current);
  fillScreen(legacy);
  return { current, legacy };
}

function completed(machine: Machine): CapturePlanes {
  return machine.video.rawCompleted ?? machine.video.completed;
}

function paperPixel(machine: Machine): number {
  return (machine.video as TimedVideo).masks.indexOf(0);
}

function flashSlot(machine: Machine): number {
  const video = machine.video;
  const symbol = video.vPositions.findIndex(
    (v, index) =>
      v === machine.videoPreset.flashLine &&
      (index * 8) % machine.width === video.advanceX,
  );
  expect(symbol).toBeGreaterThanOrEqual(0);
  return symbol * 8;
}

function equalBytes(actual: Uint8ClampedArray, expected: Uint8ClampedArray) {
  expect(actual.length).toBe(expected.length);
  expect(actual.every((value, index) => value === expected[index])).toBe(true);
}

function equivalent(current: Machine, legacy: Machine): void {
  expect(current.cpu.snapshot()).toEqual(legacy.cpu.snapshot());
  expect(Array.from(current.counters)).toEqual(Array.from(legacy.counters));
  expect(current.framePosition).toBe(legacy.framePosition);
  for (let page = 0; page < current.memory.ramPages.length; page++)
    expect(
      current.memory.ramPages[page].every(
        (value, index) => value === legacy.memory.ramPages[page][index],
      ),
    ).toBe(true);
  const a = completed(current),
    b = completed(legacy);
  expect(a.pixels.every((value, index) => value === b.pixels[index])).toBe(
    true,
  );
  for (const border of [false, true])
    equalBytes(current.renderFrame(border), legacy.renderFrame(border));
}

it.each(
  [PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET].flatMap((preset) =>
    [false, true].map((cpu7) => ({ preset, cpu7 })),
  ),
)(
  "keeps $preset.id frame 16 off and frame 17 on with raw FLASH attributes (turbo=$cpu7)",
  ({ preset, cpu7 }) => {
    const { current, legacy } = pair(preset, cpu7);
    const pixel = paperPixel(current),
      symbol = pixel >>> 3;
    for (let frame = 1; frame <= 17; frame++) {
      current.advanceFrame();
      legacy.advanceFrame();
      if (frame !== 1 && frame !== 16 && frame !== 17) continue;
      const phase = frame === 17 ? 1 : 0;
      expect(completed(current).flashPhase).toBe(phase);
      expect(completed(legacy).flashPhase).toBeUndefined();
      expect(completed(current).attributes[symbol]).toBe(0x82);
      expect(completed(legacy).attributes[symbol]).toBe(phase ? 0x82 : 2);
      equivalent(current, legacy);
      expect([
        ...current.renderFrame().subarray(pixel * 4, pixel * 4 + 4),
      ]).toEqual(phase ? [0, 0, 0, 255] : [215, 0, 0, 255]);
    }
    expect(current.counters[Counter.flash]).toBe(17);
  },
);

it.each([PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET])(
  "repaints the old $id frame with its saved phase after the next partial trigger",
  (preset) => {
    const { current, legacy } = pair(preset);
    for (let frame = 0; frame < 15; frame++) {
      current.advanceFrame();
      legacy.advanceFrame();
    }
    const old = completed(current);
    const withBorder = new Uint8ClampedArray(current.renderFrame(true));
    const withoutBorder = new Uint8ClampedArray(current.renderFrame(false));
    const count = flashSlot(current) + 8;
    current.advancePixels(count);
    legacy.advancePixels(count);
    expect(current.frameCount).toBe(15);
    expect(current.counters[Counter.flash]).toBe(16);
    expect(completed(current)).toBe(old);
    expect(old.flashPhase).toBe(0);
    // Changing border forces actual rerendering, rather than just a cached view.
    equalBytes(current.renderFrame(true), withBorder);
    equalBytes(current.renderFrame(false), withoutBorder);
    equivalent(current, legacy);
  },
);

it.each([
  [PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET],
  [LVIV_VIDEO_PRESET, PENTAGON_VIDEO_PRESET],
])(
  "retains capture phase across a partial-trigger rephase from %s to %s",
  (before, after) => {
    const { current, legacy } = pair(before);
    for (let frame = 0; frame < 15; frame++) {
      current.advanceFrame();
      legacy.advanceFrame();
    }
    const count = flashSlot(current) + 8;
    current.advancePixels(count);
    legacy.advancePixels(count);
    expect(current.counters[Counter.flash]).toBe(16);
    expect(current.frameCount).toBe(15);
    current.setVideoPreset(after);
    legacy.setVideoPreset(after);
    current.advanceFrame();
    legacy.advanceFrame();
    expect(current.frameCount).toBe(16);
    expect(current.counters[Counter.flash]).toBe(17);
    expect(completed(current).flashPhase).toBe(1);
    const pixel = paperPixel(current);
    expect([
      ...current.renderFrame().subarray(pixel * 4, pixel * 4 + 4),
    ]).toEqual([0, 0, 0, 255]);
    equivalent(current, legacy);
  },
);

it.each([PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET])(
  "round-trips raw and resolved $id captures through one reused packed buffer",
  (preset) => {
    const { current, legacy } = pair(preset, true);
    const bytes = new Uint8ClampedArray(
      captureByteLength(preset.pixelsPerFrame),
    );
    const decoded = captureViews(bytes, preset.pixelsPerFrame);
    const masks = createRasterMasks(preset);
    const rgba = new Uint8ClampedArray(preset.pixelsPerFrame * 4);
    for (let frame = 1; frame <= 17; frame++) {
      current.advanceFrame();
      legacy.advanceFrame();
      if (frame !== 1 && frame !== 16 && frame !== 17) continue;
      copyCapture(completed(current), bytes);
      decoded.refresh();
      expect(decoded.flashPhase).toBe(frame === 17 ? 1 : 0);
      renderCapturedFrame(decoded, masks, rgba);
      equalBytes(rgba, legacy.renderFrame());
      copyCapture(completed(legacy), bytes);
      decoded.refresh();
      expect(decoded.flashPhase).toBeUndefined();
      renderCapturedFrame(decoded, masks, rgba);
      equalBytes(rgba, legacy.renderFrame());
    }
  },
);

it("keeps a visible custom FLASH trigger resolved at each capture", () => {
  const preset: VideoPreset = {
    id: "visible-flash-edge",
    label: "Visible FLASH edge",
    width: 8,
    height: 8,
    pixelsPerFrame: 64,
    hReload: 0,
    hLimit: 4,
    hOrigin: 0,
    vOrigin: 0,
    vAdvance: 0,
    borderShift: 0,
    hBorder: [0, 1],
    hBlank: [0, 1],
    hSync: [0, 1],
    vPaperEnd: 6,
    vBlank: [6, 7],
    vSync: [6, 7],
    interruptLine: 6,
    flashLine: 4,
    flashBit: 0,
  };
  const { current, legacy } = pair(preset);
  for (const machine of [current, legacy]) {
    const video = machine.video as TimedVideo;
    video.pixelFetch = 255;
    video.attributeFetch = 0x82;
    machine.advanceFrame();
  }
  expect(completed(current).flashPhase).toBeUndefined();
  expect(Array.from(completed(current).attributes)).toEqual([
    2, 2, 2, 2, 0x82, 0x82, 0x82, 0x82,
  ]);
  equivalent(current, legacy);
});

it("leaves standalone video and machines with injected devices resolved", () => {
  const standalone = new TimedVideo(PENTAGON_VIDEO_PRESET);
  standalone.attributeFetch = 0x82;
  standalone.captureSymbol(0, 0);
  standalone.finishFrame();
  expect(standalone.rawCompleted.flashPhase).toBeUndefined();
  expect(standalone.rawCompleted.attributes[0]).toBe(2);
  const rom = new Uint8Array(16384);
  rom[0] = 0x76;
  const injected = createMachine({
    rom,
    devices: [{ id: "custom-flash-contract" }],
  });
  fillScreen(injected);
  injected.advanceFrame();
  expect(completed(injected).flashPhase).toBeUndefined();
  expect(completed(injected).attributes[paperPixel(injected) >>> 3]).toBe(2);
});
