import { afterEach, expect, it, vi } from "vitest";
import {
  LVIV_VIDEO_PRESET,
  PENTAGON_VIDEO_PRESET,
} from "../devices/videoPresets";
import { createMachine } from "../machine/machine";
import { WorkerEngine } from "./engine";
import type { Command, FromWorker } from "./protocol";

const rom = new Uint8Array(16384);
rom.set([0x21, 0, 0x80, 0x34, 0x3e, 0x17, 0xd3, 0xfe, 0xc3, 3, 0]);
function harness() {
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
    lateInt: false,
  });
  return { engine, messages, send };
}
afterEach(() => vi.useRealTimers());
it("matches synchronous execution and raster exactly through transferable buffers", () => {
  const h = harness();
  const direct = createMachine({ rom });
  try {
    direct.advanceFrame();
    const result = h.send({ type: "step" });
    expect(result.state?.pc).toBe(direct.cpu.regs.pc);
    expect(result.state?.ticks).toBe(direct.counters[0]);
    const frame = h.messages.find((m) => m.type === "frame") as Extract<
      FromWorker,
      { type: "frame" }
    >;
    expect(
      frame.bytes.every(
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
      next.bytes.every((value, index) => value === direct.renderFrame()[index]),
    ).toBe(true);
  } finally {
    h.engine.dispose();
  }
});
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
    const paused = h.send({ type: "run", value: false });
    expect(paused.state?.ticks).toBeGreaterThan(0);
    vi.advanceTimersByTime(40);
    expect(
      h.send({ type: "inspect", address: 0, length: 0 }).state?.ticks,
    ).toBe(paused.state?.ticks);
    h.send({ type: "visible", value: false });
    h.send({ type: "run", value: true });
    vi.advanceTimersByTime(40);
    expect(
      h.send({ type: "inspect", address: 0, length: 0 }).state?.ticks,
    ).toBe(paused.state?.ticks);
    h.send({ type: "visible", value: true });
    vi.advanceTimersByTime(20);
    expect(h.send({ type: "run", value: false }).state?.ticks).toBeGreaterThan(
      paused.state?.ticks ?? 0,
    );
  } finally {
    h.engine.dispose();
  }
});
it("rejects unsupported tape loads before changing machine state", () => {
  const h = harness();
  try {
    const before = h.send({ type: "step", pixels: 100 });
    const result = h.send({
      type: "tape",
      bytes: new Uint8Array([2, 0, 255, 255]),
      name: "test.tap",
    });
    expect(result.error).toContain("not supported");
    const after = h.send({ type: "inspect", address: 0, length: 0 });
    expect(after.state?.ticks).toBe(before.state?.ticks);
  } finally {
    h.engine.dispose();
  }
});
