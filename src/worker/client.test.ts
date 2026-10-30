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
  private engine = new WorkerEngine((message, transfer = []) => {
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (!this.terminated) this.onmessage?.({ data } as MessageEvent);
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
    expect(stopped.ticks).toBe(500);
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
