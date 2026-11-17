import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SOUND } from "../audio/mixer";
import {
  compactCaptureCapacity,
  compactCaptureViews,
} from "../devices/compactCapture";
import {
  captureByteLength,
  createRasterMasks,
  renderCapturedFrame,
} from "../devices/frameRenderer";
import {
  LVIV_VIDEO_PRESET,
  PENTAGON_VIDEO_PRESET,
} from "../devices/videoPresets";
import { Counter } from "../machine/counters";
import { createMachine } from "../machine/machine";
import { WorkerEngine } from "./engine";
import type { Command, FromWorker } from "./protocol";

const rom = new Uint8Array(16384);
rom.set([0x21, 0, 0x80, 0x34, 0x3e, 0x17, 0xd3, 0xfe, 0xc3, 3, 0]);
function harness(rawFrames = false) {
  const messages: FromWorker[] = [];
  const engine = new WorkerEngine((message, transfer = []) => {
    messages.push(structuredClone(message, { transfer }));
  });
  let id = 0;
  const send = (command: Command, epoch = 0) => {
    engine.receive({ id: ++id, epoch, command });
    return messages.findLast(
      (m) => m.type === "reply" && m.id === id,
    ) as Extract<FromWorker, { type: "reply" }>;
  };
  send({
    type: "init",
    rom,
    preset: PENTAGON_VIDEO_PRESET,
    turbo: false,
    rawFrames,
  });
  const ticks = () =>
    messages.reduce(
      (total, m) => total + ("state" in m ? (m.state?.tickDelta ?? 0) : 0),
      0,
    );
  return { engine, messages, send, ticks };
}
beforeEach(() => {
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = {
        onmessage: undefined as undefined | ((event: { data: number }) => void),
        close() {},
      };
      port2 = {
        postMessage: (data: number) =>
          setTimeout(() => this.port1.onmessage?.({ data }), 0),
        close() {},
      };
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("applies AY availability through sound settings in 48K mode independently of playback and volume", () => {
  const h = harness();
  const program = [
    0x01,
    0xfd,
    0xff, // LD BC,FFFD.
    0x3e,
    8,
    0xed,
    0x79, // Select R8.
    0x06,
    0xbf,
    0x3e,
    15,
    0xed,
    0x79, // Write volume 15.
    0x06,
    0xff,
    0xed,
    0x78, // Read R8.
    0x32,
    0,
    0x80,
    0xc3,
    0,
    0, // Save readback and repeat.
  ];
  const pair = new Uint8Array(32768);
  pair.set(program);
  pair.set(program, 16384);
  try {
    h.send({
      type: "init",
      rom: pair,
      preset: PENTAGON_VIDEO_PRESET,
      turbo: false,
      mode48k: true,
    });
    const settings = { ...DEFAULT_SOUND, beeperEnabled: false, ayVolume: 0 };
    for (const enabled of [false, true, false]) {
      h.send({
        type: "sound",
        settings: { ...settings, ayEnabled: enabled },
        sampleRate: 48000,
      });
      const state = h.send({ type: "step", pixels: 2000 }).state;
      expect(state?.active48kMode).toBe(true);
      expect(state?.memoryMapping).toEqual({
        ramPage: 0,
        romPage: 1,
        screenPage: 5,
      });
      expect(
        h.send({ type: "inspect", address: 0x8000, length: 1 }).memory?.[0],
      ).toBe(enabled ? 15 : 255);
    }
    expect(h.messages.some((message) => message.type === "audio")).toBe(false);
  } finally {
    h.engine.dispose();
  }
});
it.each([false, true])(
  "matches synchronous execution and raster through transferable buffers (raw=%s)",
  (raw) => {
    const h = harness(raw);
    const rgba = (bytes: Uint8ClampedArray) => {
      if (!raw) return bytes;
      const views = compactCaptureViews(
        bytes,
        PENTAGON_VIDEO_PRESET.pixelsPerFrame,
      );
      views.refresh();
      return renderCapturedFrame(
        views,
        createRasterMasks(PENTAGON_VIDEO_PRESET),
        new Uint8ClampedArray(PENTAGON_VIDEO_PRESET.pixelsPerFrame * 4),
      );
    };
    const direct = createMachine({ rom });
    try {
      direct.advanceFrame();
      const result = h.send({ type: "step" });
      expect(result.state?.pc).toBe(direct.cpu.regs.pc);
      expect(h.ticks()).toBe(direct.takeElapsedTicks());
      const frame = h.messages.find((m) => m.type === "frame") as Extract<
        FromWorker,
        { type: "frame" }
      >;
      expect(
        rgba(frame.bytes).every(
          (value, index) => value === direct.renderFrame()[index],
        ),
      ).toBe(true);
      const read = h.send({ type: "inspect", address: 0x8000, length: 4 });
      expect(read.memory?.[0]).toBe(direct.memory.read(0x8000));
      h.engine.receive(
        structuredClone(
          { recycle: "frame" as const, bytes: frame.bytes, presented: true },
          { transfer: [frame.bytes.buffer] },
        ),
      );
      expect(frame.bytes.byteLength).toBe(0);
      direct.advanceFrame();
      h.send({ type: "step" });
      const next = h.messages.findLast((m) => m.type === "frame") as Extract<
        FromWorker,
        { type: "frame" }
      >;
      expect(
        rgba(next.bytes).every(
          (value, index) => value === direct.renderFrame()[index],
        ),
      ).toBe(true);
    } finally {
      h.engine.dispose();
    }
  },
);
it("keeps one video packet in flight and returns the latest paused frame after recycling", () => {
  const h = harness();
  try {
    h.send({ type: "step" });
    h.send({ type: "step" });
    h.send({ type: "step" });
    const frames = h.messages.filter((m) => m.type === "frame");
    expect(frames).toHaveLength(1);
    const frame = frames[0] as Extract<FromWorker, { type: "frame" }>;
    h.engine.receive({ recycle: "frame", bytes: frame.bytes, presented: true });
    const latest = h.messages.findLast((m) => m.type === "frame") as Extract<
      FromWorker,
      { type: "frame" }
    >;
    expect(latest.state.frameCount).toBe(3);
  } finally {
    h.engine.dispose();
  }
});

it("grows compact frame buffers for event-heavy frames and reuses their capacity for quiet frames", () => {
  const h = harness(true);
  const firmware = new Uint8Array(16384);
  // Emit 512 border changes, then HALT. The following frame has no FE events.
  firmware.set([
    0x01, 0, 2, 0x16, 0, 0x7a, 0xee, 7, 0x57, 0xd3, 0xfe, 0x0b, 0x78, 0xb1,
    0xc2, 5, 0, 0x76,
  ]);
  try {
    h.send({
      type: "init",
      rom: firmware,
      preset: PENTAGON_VIDEO_PRESET,
      turbo: false,
      rawFrames: true,
    });
    h.send({ type: "step" });
    const first = h.messages.findLast((m) => m.type === "frame") as Extract<
      FromWorker,
      { type: "frame" }
    >;
    const capacity = first.bytes.buffer.byteLength;
    expect(capacity).toBeGreaterThan(
      compactCaptureCapacity(PENTAGON_VIDEO_PRESET.pixelsPerFrame),
    );
    expect(first.bytes.length).toBeLessThan(capacity);
    h.engine.receive(
      structuredClone(
        { recycle: "frame" as const, bytes: first.bytes, presented: true },
        { transfer: [first.bytes.buffer] },
      ),
    );
    expect(first.bytes.byteLength).toBe(0);
    h.send({ type: "step" });
    const quiet = h.messages.findLast((m) => m.type === "frame") as Extract<
      FromWorker,
      { type: "frame" }
    >;
    expect(quiet.bytes.length).toBe(
      44 + PENTAGON_VIDEO_PRESET.pixelsPerFrame / 4,
    );
    expect(quiet.bytes.buffer.byteLength).toBe(capacity);
  } finally {
    h.engine.dispose();
  }
});

it.each([false, true])(
  "reports technical fields while retaining full raster packets (raw=%s)",
  (raw) => {
    const h = harness(raw);
    try {
      const changed = h.send({ type: "technicalFields", value: false }, 1);
      expect(changed.state?.showTechnicalFields).toBe(false);
      h.send({ type: "step" }, 1);
      const frame = h.messages.find((m) => m.type === "frame") as Extract<
        FromWorker,
        { type: "frame" }
      >;
      expect(frame.state.showTechnicalFields).toBe(false);
      if (raw) {
        expect(frame.compact).toBe(true);
        expect(frame.bytes.length).toBeLessThan(
          compactCaptureCapacity(PENTAGON_VIDEO_PRESET.pixelsPerFrame),
        );
        expect(frame.bytes.buffer.byteLength).toBeLessThan(
          captureByteLength(PENTAGON_VIDEO_PRESET.pixelsPerFrame) / 6,
        );
      } else
        expect(frame.bytes.length).toBe(
          PENTAGON_VIDEO_PRESET.pixelsPerFrame * 4,
        );
      expect(
        h.send({ type: "technicalFields", value: true }, 2).state
          ?.showTechnicalFields,
      ).toBe(true);
    } finally {
      h.engine.dispose();
    }
  },
);
it("discards obsolete geometry and re-presents rejected packets at the current epoch", () => {
  const h = harness();
  try {
    h.send({ type: "step" });
    const old = h.messages.find((m) => m.type === "frame") as Extract<
      FromWorker,
      { type: "frame" }
    >;
    h.send({ type: "video", preset: LVIV_VIDEO_PRESET }, 1);
    h.send({ type: "step" }, 1);
    h.engine.receive({ recycle: "frame", bytes: old.bytes, presented: false });
    const frame = h.messages.findLast((m) => m.type === "frame") as Extract<
      FromWorker,
      { type: "frame" }
    >;
    expect(frame.epoch).toBe(1);
    expect(frame.bytes.length).toBe(448 * 312 * 4);
  } finally {
    h.engine.dispose();
  }
});
it("preserves overlapping keyboard sources and worker-paced extended sequences", () => {
  const h = harness();
  try {
    h.send({
      type: "keyboard",
      input: { action: "press", source: "host", keys: ["CAPS_SHIFT"] },
    });
    h.send({
      type: "keyboard",
      input: { action: "extended", source: "touch", key: "Y", shifted: true },
    });
    h.send({ type: "step" });
    const after = h.send({ type: "step" });
    expect(after.state?.keys).toEqual(
      expect.arrayContaining(["CAPS_SHIFT", "SYMBOL_SHIFT", "Y"]),
    );
    const released = h.send({
      type: "keyboard",
      input: { action: "release", source: "touch" },
    });
    expect(released.state?.keys).toEqual(["CAPS_SHIFT"]);
    expect(
      h.send({ type: "keyboard", input: { action: "releaseAll" } }).state?.keys,
    ).toEqual([]);
  } finally {
    h.engine.dispose();
  }
});
it("yields to pause, visibility and free-run commands without advancing after acknowledgment", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness();
  try {
    h.send({ type: "run", value: true });
    vi.advanceTimersByTime(40);
    h.send({ type: "run", value: false });
    const pausedTicks = h.ticks();
    expect(pausedTicks).toBeGreaterThan(0);
    vi.advanceTimersByTime(40);
    h.send({ type: "inspect", address: 0, length: 0 });
    expect(h.ticks()).toBe(pausedTicks);
    h.send({ type: "visible", value: false });
    h.send({ type: "run", value: true });
    vi.advanceTimersByTime(40);
    h.send({ type: "inspect", address: 0, length: 0 });
    expect(h.ticks()).toBe(pausedTicks);
    h.send({ type: "visible", value: true });
    vi.advanceTimersByTime(20);
    h.send({ type: "run", value: false });
    expect(h.ticks()).toBeGreaterThan(pausedTicks);
  } finally {
    h.engine.dispose();
  }
});
it("rejects unsupported tape loads before changing machine state", () => {
  const h = harness();
  try {
    h.send({ type: "step", pixels: 100 });
    const before = h.ticks();
    const result = h.send({
      type: "tape",
      bytes: new Uint8Array([2, 0, 255, 255]),
      name: "test.tap",
    });
    expect(result.error).toContain("not supported");
    h.send({ type: "inspect", address: 0, length: 0 });
    expect(h.ticks()).toBe(before);
  } finally {
    h.engine.dispose();
  }
});

it("reports tick deltas while a video transfer is still in flight", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness();
  try {
    h.send({ type: "step" }); // Hold the only display buffer on the UI side.
    const before = h.ticks();
    h.send({ type: "run", value: true });
    vi.advanceTimersByTime(60);
    expect(h.ticks()).toBeGreaterThan(before);
    expect(h.messages.filter((m) => m.type === "frame")).toHaveLength(1);
    expect(
      h.messages.some((m) => m.type === "state" && m.state.tickDelta > 0),
    ).toBe(true);
  } finally {
    h.engine.dispose();
  }
});

it("applies 48K mode on worker initialization and reset without clearing RAM", () => {
  const h = harness();
  const firmware = new Uint8Array(32768);
  // OUT (FD),3; LD A,91; LD (C000),A; HALT in both ROM pages.
  const program = [0x3e, 3, 0xd3, 0xfd, 0x3e, 91, 0x32, 0, 0xc0, 0x76];
  firmware.set(program);
  firmware.set(program, 16384);
  const fixed48k = { ramPage: 0, romPage: 1, screenPage: 5 };
  try {
    const initialized = h.send({
      type: "init",
      rom: firmware,
      preset: PENTAGON_VIDEO_PRESET,
      turbo: false,
      mode48k: true,
    });
    expect(initialized.state?.memoryMapping).toEqual(fixed48k);
    expect(initialized.state?.active48kMode).toBe(true);
    // The locked 48K mapping ignores the program's paging attempt.
    expect(h.send({ type: "step", pixels: 1000 }).state?.memoryMapping).toEqual(
      fixed48k,
    );
    expect(
      h.send({ type: "inspect", address: 0xc000, length: 1 }).memory?.[0],
    ).toBe(91);
    const pending128k = h.send({ type: "mode48k", value: false });
    expect(pending128k.state?.memoryMapping).toEqual(fixed48k);
    expect(pending128k.state?.active48kMode).toBe(true);
    h.send({ type: "reset", value: true });
    const reset = h.send({ type: "reset", value: false });
    expect(reset.state?.memoryMapping).toEqual({
      ramPage: 0,
      romPage: 0,
      screenPage: 5,
    });
    expect(reset.state?.active48kMode).toBe(false);
    expect(
      h.send({ type: "inspect", address: 0xc000, length: 1 }).memory?.[0],
    ).toBe(91);
    expect(h.send({ type: "step", pixels: 1000 }).state?.memoryMapping).toEqual(
      {
        ramPage: 3,
        romPage: 0,
        screenPage: 5,
      },
    );
    const pending48k = h.send({ type: "mode48k", value: true });
    expect(pending48k.state?.memoryMapping?.ramPage).toBe(3);
    expect(pending48k.state?.active48kMode).toBe(false);
    h.send({ type: "reset", value: true });
    const reset48k = h.send({ type: "reset", value: false });
    expect(reset48k.state?.memoryMapping).toEqual(fixed48k);
    expect(reset48k.state?.active48kMode).toBe(true);
    expect(
      h.send({ type: "inspect", address: 0xc000, length: 1 }).memory?.[0],
    ).toBe(91);
  } finally {
    h.engine.dispose();
  }
});

it("recycles bounded stereo PCM buffers and keeps executing when playback is backpressured", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness();
  try {
    h.send({ type: "audio", value: true }, 1);
    h.send({ type: "run", value: true }, 1);
    vi.advanceTimersByTime(400);
    const audio = h.messages.filter((m) => m.type === "audio");
    expect(audio).toHaveLength(32);
    expect(
      audio.every(
        (m) =>
          ArrayBuffer.isView(m.bytes) &&
          m.length <= 256 &&
          m.sampleRate === 48000,
      ),
    ).toBe(true);
    const before = h.ticks();
    vi.advanceTimersByTime(100);
    expect(h.ticks()).toBeGreaterThan(before);
    expect(h.messages.filter((m) => m.type === "audio")).toHaveLength(32);
    const recycled = audio[0];
    h.engine.receive(
      structuredClone(
        { recycle: "audio" as const, bytes: recycled.bytes },
        { transfer: [recycled.bytes.buffer] },
      ),
    );
    expect(recycled.bytes.byteLength).toBe(0);
    vi.advanceTimersByTime(40);
    expect(h.messages.filter((m) => m.type === "audio")).toHaveLength(33);
    h.send({ type: "run", value: false }, 2);
    const paused = h.messages.filter((m) => m.type === "audio").length;
    vi.advanceTimersByTime(50);
    expect(h.messages.filter((m) => m.type === "audio")).toHaveLength(paused);
    expect(h.messages.some((m) => m.type === "error")).toBe(false);
  } finally {
    h.engine.dispose();
  }
});

it("defers host video changes to the next frame while running", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const h = harness(true);
  try {
    h.send({ type: "step", pixels: 100 });
    h.send({ type: "run", value: true });
    h.send({ type: "video", preset: LVIV_VIDEO_PRESET });
    const pending = h.send({ type: "extendedMode", value: true });
    expect(pending.state?.framePosition).toBe(100);
    expect(pending.state?.extendedMode).toBe(false);
    vi.advanceTimersByTime(80);
    const state = h.send({ type: "inspect", address: 0, length: 0 }).state;
    expect(state?.extendedMode).toBe(true);
    expect(state?.frameCount).toBeGreaterThan(1);
    const frame = h.messages.findLast((m) => m.type === "frame");
    expect(frame?.type === "frame" && frame.compact).toBe(true);
    expect(frame?.type === "frame" && frame.bytes.length).toBeLessThan(
      compactCaptureCapacity(LVIV_VIDEO_PRESET.pixelsPerFrame),
    );
    h.send({ type: "run", value: false });
  } finally {
    h.engine.dispose();
  }
});

it.each([false, true])(
  "transfers captured FLASH phase across frames 16/17 for both presets (raw=%s)",
  (raw) => {
    const firmware = new Uint8Array(16384);
    firmware.set([0x3e, 0x80, 0x32, 0, 0x40, 0x3e, 0x91, 0x32, 0, 0x58, 0x76]);
    for (const preset of [PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET]) {
      const h = harness(raw);
      const masks = createRasterMasks(preset);
      const paper = masks.indexOf(0);
      const target = new Uint8ClampedArray(preset.pixelsPerFrame * 4);
      const latest = () => {
        const frame = h.messages.findLast(
          (message) => message.type === "frame",
        );
        if (frame?.type !== "frame") throw new Error("Expected frame");
        return frame;
      };
      const recycle = (frame: ReturnType<typeof latest>) => {
        h.engine.receive(
          structuredClone(
            { recycle: "frame" as const, bytes: frame.bytes, presented: true },
            { transfer: [frame.bytes.buffer] },
          ),
        );
      };
      const pixels = (frame: ReturnType<typeof latest>) => {
        if (!raw) return frame.bytes;
        const views = compactCaptureViews(frame.bytes, preset.pixelsPerFrame);
        views.refresh();
        expect(views.attributes[paper >>> 3]).toBe(0x91);
        expect(views.flashPhase).toBe(frame.state.frameCount === 16 ? 0 : 1);
        return renderCapturedFrame(views, masks, target);
      };
      try {
        h.send({
          type: "init",
          rom: firmware,
          preset,
          turbo: false,
          rawFrames: raw,
        });
        for (let frame = 1; frame <= 16; frame++) {
          h.send({ type: "step" });
          if (frame < 16) recycle(latest());
        }
        const before = latest();
        expect(before.state.frameCount).toBe(16);
        expect(before.state.counters[Counter.flash]).toBe(16);
        const rgba = pixels(before);
        expect(Array.from(rgba.subarray(paper * 4, paper * 4 + 4))).toEqual([
          0, 0, 215, 255,
        ]);
        const count = h.messages.filter(
          (message) => message.type === "frame",
        ).length;
        const partial = h.send({
          type: "step",
          pixels: preset.pixelsPerFrame - 1,
        });
        expect(partial.state?.counters[Counter.flash]).toBe(17);
        expect(partial.state?.frameCount).toBe(16);
        expect(
          h.messages.filter((message) => message.type === "frame"),
        ).toHaveLength(count);
        expect(
          Array.from(pixels(before).subarray(paper * 4, paper * 4 + 4)),
        ).toEqual([0, 0, 215, 255]);
        recycle(before);
        expect(before.bytes.byteLength).toBe(0);
        h.send({ type: "step", pixels: 1 });
        const after = latest();
        expect(after.state.frameCount).toBe(17);
        expect(after.state.counters[Counter.flash]).toBe(17);
        expect(
          Array.from(pixels(after).subarray(paper * 4, paper * 4 + 4)),
        ).toEqual([215, 0, 0, 255]);
      } finally {
        h.engine.dispose();
      }
    }
  },
);
