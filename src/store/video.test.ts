import { expect, it } from "vitest";
import { createMachine } from "../machine/machine";
import { loadConfig } from "../storage/config";
import { MemoryBackend } from "../storage/memory";
import { makeFakeLoop } from "../test/fakes";
import { createAppStore } from ".";

it("persists technical fields and restores the independent border preference", async () => {
  const rom = new Uint8Array(16384);
  rom[0] = 0x76;
  const backend = new MemoryBackend({
    initial: { name: "test.rom", bytes: rom },
  });
  const deps = {
    backend,
    machineFactory: createMachine,
    hostLoopFactory: () => makeFakeLoop(),
  };
  const store = await createAppStore(deps);
  try {
    const machine = store.machine();
    if (!machine) throw new Error("Expected initialized machine");
    expect(store.showTechnicalFields()).toBe(true);
    expect(machine.showTechnicalFields).toBe(true);
    store.setShowBorder(false);
    machine.advancePixels(13);
    store.setShowTechnicalFields(false);
    expect(machine.showTechnicalFields).toBe(false);
    expect(store.showTechnicalFields()).toBe(false);
    expect(store.showBorder()).toBe(true);
    expect(machine.framePosition).toBe(13);
    expect(loadConfig()).toMatchObject({
      showTechnicalFields: false,
      showBorder: false,
    });
    store.setShowTechnicalFields(true);
    expect(machine.showTechnicalFields).toBe(true);
    expect(store.showBorder()).toBe(false);
    store.setShowTechnicalFields(false);
    store.coldBoot();
    expect(store.machine()).not.toBe(machine);
    expect(store.machine()?.showTechnicalFields).toBe(false);
    store.setVideoPreset("lviv");
    expect(store.machine()?.showTechnicalFields).toBe(false);
  } finally {
    store.dispose();
  }
  const restored = await createAppStore(deps);
  try {
    expect(restored.showTechnicalFields()).toBe(false);
    expect(restored.machine()?.showTechnicalFields).toBe(false);
    expect(restored.showBorder()).toBe(true);
    restored.setShowTechnicalFields(true);
    expect(restored.showBorder()).toBe(false);
  } finally {
    restored.dispose();
  }
});
