import { expect, it, vi } from "vitest";
import { createMachine } from "../machine/machine";
import { MemoryBackend } from "../storage/memory";
import { makeFakeLoop } from "../test/fakes";
import { createAppStore, MACHINE_METER_REFRESH_MS } from ".";

it("accumulates actual slots across chunks, presets and reset, clearing only on replacement", async () => {
  const store = await createAppStore({
    backend: new MemoryBackend({
      initial: { name: "test.rom", bytes: new Uint8Array(16384) },
    }),
    machineFactory: createMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  try {
    const machine = store.machine();
    if (!machine) throw new Error("Expected initialized machine");
    machine.advancePixels(448 * 320 + 17);
    store.refresh();
    expect(store.status().ticks).toBe(448 * 320 + 17);
    store.refresh();
    expect(store.status().ticks).toBe(448 * 320 + 17);
    machine.advancePixels(19); // Unreported work must survive a raster rephase.
    store.setVideoPreset("lviv");
    expect(store.status().ticks).toBe(448 * 320 + 36);
    machine.setReset(true);
    machine.setReset(false);
    machine.advancePixels(23);
    store.refresh();
    expect(store.status().ticks).toBe(448 * 320 + 59);
    store.stepFrame();
    expect(store.status().ticks).toBe(448 * 320 + 36 + 448 * 312);
    store.coldBoot();
    expect(store.status().ticks).toBe(0);
  } finally {
    store.dispose();
  }
});

it("throttles running meters while retaining every tick and updating presentation, then flushes on pause", async () => {
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  const store = await createAppStore({
    backend: new MemoryBackend({
      initial: { name: "test.rom", bytes: new Uint8Array(16384) },
    }),
    machineFactory: createMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  try {
    const machine = store.machine();
    if (!machine) throw new Error("Expected initialized machine");
    store.stepFrame();
    const initial = store.status();
    const version = store.frameVersion();
    store.run();
    now = 100;
    machine.advanceFrame();
    store.refresh();
    expect(store.status()).toBe(initial);
    expect(store.frameVersion()).toBeGreaterThan(version);
    now = MACHINE_METER_REFRESH_MS;
    store.refresh();
    expect(store.status().frames).toBe(2);
    expect(store.status().ticks).toBe(2 * machine.timing.pixelsPerFrame);
    const sampled = store.status();
    now++;
    machine.advancePixels(123);
    store.refresh();
    expect(store.status()).toBe(sampled);
    store.pause();
    expect(store.status().ticks).toBe(sampled.ticks + 123);
    expect(store.status().framePosition).toBe(machine.framePosition);
    expect(store.status().pc).toBe(machine.cpu.regs?.pc);
    store.refresh();
    expect(store.status().ticks).toBe(sampled.ticks + 123);
  } finally {
    store.dispose();
    clock.mockRestore();
  }
});
