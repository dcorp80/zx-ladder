import { afterEach, expect, it, vi } from "vitest";
import { LVIV_VIDEO_PRESET } from "../devices/videoPresets";
import { WorkerMachine } from "./client";
import { WorkerEngine } from "./engine";
import type { ToWorker } from "./protocol";

/** Exercise the real protocol with detached transfers and asynchronous delivery. */
class LoopbackWorker {
  static instances: LoopbackWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  suppressSnapshots = false;
  private engine = new WorkerEngine((message, transfer = []) => {
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (
        !this.terminated &&
        !(
          this.suppressSnapshots &&
          (data.type === "state" || data.type === "frame")
        )
      )
        this.onmessage?.({ data } as MessageEvent);
    });
  });
  constructor() {
    LoopbackWorker.instances.push(this);
  }
  postMessage(message: ToWorker, transfer: Transferable[] = []) {
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (!this.terminated) this.engine.receive(data);
    });
  }
  terminate() {
    this.terminated = true;
    this.engine.dispose();
  }
}
afterEach(() => {
  for (const instance of LoopbackWorker.instances) instance.terminate();
  LoopbackWorker.instances = [];
  vi.unstubAllGlobals();
});
it("provides acknowledged control, stable render storage, keyboard and coherent memory reads", async () => {
  vi.stubGlobal("Worker", LoopbackWorker);
  const rom = new Uint8Array(16384);
  rom[0] = 0x76;
  const machine = new WorkerMachine({ rom });
  const onUpdate = vi.fn(),
    onError = vi.fn();
  machine.createLoop({ onUpdate, onError });
  try {
    await machine.stepPixels(500);
    const stopped = await machine.pauseExecution();
    expect(stopped.framePosition).toBe(500);
    expect(machine.takeElapsedTicks()).toBe(500);
    expect(machine.takeElapsedTicks()).toBe(0);
    expect((await machine.inspectMemory(0, 1))[0]).toBe(0x76);
    const buffer = machine.renderFrame();
    machine.advanceFrame();
    await machine.inspectMemory(0, 0);
    expect(machine.hasFrame).toBe(true);
    expect(machine.renderFrame()).toBe(buffer);
    expect(machine.presentationVersion).toBeGreaterThan(0);
    machine.keyboard.press("host:A", "A");
    await machine.inspectMemory(0, 0);
    expect(machine.keyboard.isPressed("A")).toBe(true);
    machine.keyboard.release("host:A");
    await machine.inspectMemory(0, 0);
    expect(machine.keyboard.isPressed("A")).toBe(false);
    const oldVersion = machine.presentationVersion;
    machine.setShowBorder(false);
    await machine.inspectMemory(0, 0);
    expect(machine.presentationVersion).toBeGreaterThan(oldVersion);
    machine.setVideoPreset(LVIV_VIDEO_PRESET);
    machine.advanceFrame();
    await machine.inspectMemory(0, 0);
    expect(machine.height).toBe(312);
    expect(machine.renderFrame().length).toBe(448 * 312 * 4);
    await expect(
      machine.loadTape(new Uint8Array([2, 0, 255, 255]), "test.tap"),
    ).rejects.toThrow("not supported");
    expect(onError).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalled();
  } finally {
    machine.dispose();
  }
});
it("rejects outstanding requests and reports worker failure once", async () => {
  vi.stubGlobal("Worker", LoopbackWorker);
  const machine = new WorkerMachine({ rom: new Uint8Array(16384) });
  const onError = vi.fn();
  machine.createLoop({ onError });
  const inspection = machine.inspectMemory(0, 4);
  const rejection = expect(inspection).rejects.toThrow("disposed");
  LoopbackWorker.instances[0].onerror?.({
    message: "Worker crashed",
  } as ErrorEvent);
  await rejection;
  expect(onError).toHaveBeenCalledTimes(1);
  expect(LoopbackWorker.instances[0].terminated).toBe(true);
});

it("accounts for execution in rejected frames and across preset changes exactly once", async () => {
  vi.stubGlobal("Worker", LoopbackWorker);
  const machine = new WorkerMachine({ rom: new Uint8Array(16384) });
  machine.createLoop({});
  try {
    // Queue execution, then invalidate its presentation before its reply arrives.
    const step = machine.stepPixels(448 * 320 + 17);
    machine.setVideoPreset(LVIV_VIDEO_PRESET);
    await step;
    await machine.inspectMemory(0, 0);
    expect(machine.hasFrame).toBe(false);
    expect(machine.takeElapsedTicks()).toBe(448 * 320 + 17);
    expect(machine.takeElapsedTicks()).toBe(0);
    machine.setReset(true);
    machine.setReset(false);
    await machine.stepPixels(31);
    await machine.pauseExecution();
    await machine.inspectMemory(0, 0);
    expect(machine.takeElapsedTicks()).toBe(31);
    expect(machine.takeElapsedTicks()).toBe(0);
  } finally {
    machine.dispose();
  }
});

it("publishes the acknowledged stopped snapshot even when presentation snapshots are unavailable", async () => {
  vi.stubGlobal("Worker", LoopbackWorker);
  const machine = new WorkerMachine({ rom: new Uint8Array(16384) });
  const onUpdate = vi.fn();
  machine.createLoop({ onUpdate });
  try {
    await machine.inspectMemory(0, 0);
    const worker = LoopbackWorker.instances.at(-1);
    if (!worker) throw new Error("Expected worker");
    worker.suppressSnapshots = true;
    await machine.stepPixels(123);
    expect(machine.framePosition).toBe(0);
    const stopped = await machine.pauseExecution();
    expect(machine.framePosition).toBe(123);
    expect(machine.cpu.regs.pc).toBe(stopped.pc);
    expect([...machine.counters]).toEqual(stopped.counters);
    expect(onUpdate).toHaveBeenCalled();
  } finally {
    machine.dispose();
  }
});

it("reports the selected RAM, ROM and screen after CPU paging and reset", async () => {
  vi.stubGlobal("Worker", LoopbackWorker);
  const rom = new Uint8Array(32768);
  // Select RAM 3, ROM 1, screen 7, then lock paging. Both ROMs end in HALT.
  const program = [0x3e, 0x3b, 0x01, 0xfd, 0x7f, 0xed, 0x79, 0x76];
  rom.set(program);
  rom.set(program, 16384);
  const machine = new WorkerMachine({ rom });
  try {
    await machine.stepPixels(1000);
    const stopped = await machine.pauseExecution();
    expect(stopped.memoryMapping).toEqual({
      ramPage: 3,
      romPage: 1,
      screenPage: 7,
    });
    expect(machine.memoryMapping).toEqual(stopped.memoryMapping);
    machine.setReset(true);
    await machine.pauseExecution();
    expect(machine.memoryMapping).toEqual({
      ramPage: 0,
      romPage: 0,
      screenPage: 5,
    });
  } finally {
    machine.dispose();
  }
});
