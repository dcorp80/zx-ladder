import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  captureByteLength,
  captureViews,
  createRasterMasks,
  renderCapturedFrame,
} from "../devices/frameRenderer";
import {
  LVIV_VIDEO_PRESET,
  PENTAGON_VIDEO_PRESET,
} from "../devices/videoPresets";
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
    lateInt: false,
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
it.each([false, true])(
  "matches synchronous execution and raster through transferable buffers (raw=%s)",
  (raw) => {
    const h = harness(raw);
    const rgba = (bytes: Uint8ClampedArray) =>
      raw
        ? renderCapturedFrame(
            captureViews(bytes, PENTAGON_VIDEO_PRESET.pixelsPerFrame),
            createRasterMasks(PENTAGON_VIDEO_PRESET),
            new Uint8ClampedArray(PENTAGON_VIDEO_PRESET.pixelsPerFrame * 4),
          )
        : bytes;
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

it("routes live paging decode changes to the worker and keeps page contents", () => {
  const h = harness();
  const firmware = new Uint8Array(32768);
  // OUT (FD),3; LD A,91; LD (C000),A; HALT
  firmware.set([0x3e, 3, 0xd3, 0xfd, 0x3e, 91, 0x32, 0, 0xc0, 0x76]);
  try {
    h.send({
      type: "init",
      rom: firmware,
      preset: PENTAGON_VIDEO_PRESET,
      turbo: false,
      lateInt: false,
      decodeFd: false,
    });
    h.send({ type: "decodeFd", value: true });
    h.send({ type: "step", pixels: 1000 });
    expect(
      h.send({ type: "inspect", address: 0xc000, length: 1 }).memory?.[0],
    ).toBe(91);
    h.send({ type: "reset", value: true });
    h.send({ type: "reset", value: false });
    // Reset maps page 0, proving that OUT (03FD),A selected a different page.
    expect(
      h.send({ type: "inspect", address: 0xc000, length: 1 }).memory?.[0],
    ).toBe(255);
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
    h.send({ type: "lateInt", value: true });
    vi.advanceTimersByTime(80);
    const state = h.send({ type: "inspect", address: 0, length: 0 }).state;
    expect(state?.extendedMode).toBe(true);
    expect(state?.frameCount).toBeGreaterThan(1);
    const frame = h.messages.findLast((m) => m.type === "frame");
    expect(frame?.type === "frame" && frame.bytes.length).toBe(
      captureByteLength(LVIV_VIDEO_PRESET.pixelsPerFrame),
    );
    h.send({ type: "run", value: false });
  } finally {
    h.engine.dispose();
  }
});
