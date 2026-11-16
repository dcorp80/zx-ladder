import { waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { createMachine, type Machine } from "../machine/machine";
import { CONFIG_KEY, loadConfig } from "../storage/config";
import { MemoryBackend } from "../storage/memory";
import { makeFakeLoop } from "../test/fakes";
import { diskFixture } from "../test/trd";
import { createAppStore } from ".";

const pair = () => {
  const bytes = new Uint8Array(32768).fill(0x76);
  bytes[16384] = 0x42;
  return {
    name: "pair.rom",
    bytes,
    pageNames: ["first.rom", "second.rom"] as const,
  };
};
const runtime = {
  machineFactory: createMachine,
  hostLoopFactory: () => makeFakeLoop(),
};

it.each([false, true])(
  "restores an old 16K ROM into ROM1 without changing 48K mode (%s)",
  async (mode48k) => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ version: 1, mode48k }));
    const backend = new MemoryBackend({
      persistent: true,
      initial: { name: "legacy.rom", bytes: new Uint8Array(16384).fill(0x76) },
    });
    const loadBundledRom = vi.fn(async () => null);
    const store = await createAppStore({ ...runtime, backend, loadBundledRom });
    try {
      expect(store.rom()?.pageNames).toEqual([null, "legacy.rom"]);
      expect(store.rom()?.bytes).toHaveLength(32768);
      expect(store.rom()?.bytes[0]).toBe(0xff);
      expect(store.rom()?.bytes[16384]).toBe(0x76);
      expect(store.mode48k()).toBe(mode48k);
      expect(loadConfig().mode48k).toBe(mode48k);
      expect(store.machine()?.memoryMapping?.romPage).toBe(mode48k ? 1 : 0);
      expect((await backend.loadRom())?.pageNames).toEqual([
        null,
        "legacy.rom",
      ]);
      expect(loadBundledRom).not.toHaveBeenCalled();
      store.coldBoot();
      expect(store.rom()?.pageNames).toEqual([null, "legacy.rom"]);
    } finally {
      store.dispose();
    }
  },
);

it("keeps both slots and the running machine intact when reading or validating fails", async () => {
  const store = await createAppStore({
    ...runtime,
    backend: new MemoryBackend({ initial: pair() }),
  });
  try {
    const machine = store.machine() as Machine;
    machine.memory.write(0x4000, 91);
    store.run();
    const original = store.rom();
    await store.importRom(new File([new Uint8Array(10)], "short.rom"), 1);
    expect(store.error()).toContain("exactly 16384 or 32768");
    const unreadable = new File([new Uint8Array(16384)], "unreadable.rom");
    vi.spyOn(unreadable, "arrayBuffer").mockRejectedValue(
      new Error("Read failed"),
    );
    await store.importRom(unreadable, 0);
    expect(store.error()).toBe("Read failed");
    expect(store.rom()).toBe(original);
    expect(store.machine()).toBe(machine);
    expect(machine.memory.read(0x4000)).toBe(91);
    expect(store.isRunning()).toBe(true);
    expect(store.filesBusy()).toBe(false);
  } finally {
    store.dispose();
  }
});

it("retains the original running machine and ROM pages if disk export fails", async () => {
  const store = await createAppStore({
    ...runtime,
    backend: new MemoryBackend({ initial: pair() }),
  });
  try {
    const machine = store.machine() as Machine;
    machine.mountDisk(diskFixture(), "disk", "disk.trd", false);
    const exportDisk = vi
      .spyOn(machine, "exportDisk")
      .mockImplementation(() => {
        throw new Error("Export failed");
      });
    const original = store.rom();
    store.run();
    await store.importRom(
      new File([new Uint8Array(16384)], "replacement.rom"),
      1,
    );
    expect(exportDisk).toHaveBeenCalled();
    expect(store.error()).toBe("Export failed");
    expect(store.rom()).toBe(original);
    expect(store.machine()).toBe(machine);
    expect(store.isRunning()).toBe(true);
    expect(store.filesBusy()).toBe(false);
  } finally {
    store.dispose();
  }
});

it("saves a mixed pair and both labels together, serializing changes until persistence finishes", async () => {
  const backend = new MemoryBackend({ persistent: true, initial: pair() });
  const store = await createAppStore({ ...runtime, backend });
  let finishSave!: () => void;
  const pendingSave = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  const save = backend.saveRom.bind(backend);
  vi.spyOn(backend, "saveRom").mockImplementationOnce(async (record) => {
    await pendingSave;
    await save(record);
  });
  try {
    store.run();
    const first = store.machine() as Machine;
    first.memory.write(0x4000, 91);
    const replacement = store.importRom(
      new File([new Uint8Array(16384).fill(7)], "custom.rom"),
      1,
    );
    await waitFor(() => expect(store.rom()?.pageNames?.[1]).toBe("custom.rom"));
    expect(store.filesBusy()).toBe(true);
    expect(store.machine()).not.toBe(first);
    expect((store.machine() as Machine).memory.read(0x4000)).toBe(0xff);
    expect(store.isRunning()).toBe(true);
    const other = new File([new Uint8Array(16384)], "other.rom");
    const readOther = vi.spyOn(other, "arrayBuffer");
    await store.importRom(other, 0);
    expect(readOther).not.toHaveBeenCalled();
    finishSave();
    await replacement;
    expect(store.filesBusy()).toBe(false);
    store.coldBoot();
    expect(store.rom()?.pageNames).toEqual(["first.rom", "custom.rom"]);
    const saved = await backend.loadRom();
    expect(saved?.pageNames).toEqual(["first.rom", "custom.rom"]);
    expect(saved?.bytes[0]).toBe(0x76);
    expect(saved?.bytes[16384]).toBe(7);
  } finally {
    finishSave();
    store.dispose();
  }
  const restored = await createAppStore({ ...runtime, backend });
  try {
    expect(restored.rom()?.pageNames).toEqual(["first.rom", "custom.rom"]);
    expect(restored.rom()?.bytes[0]).toBe(0x76);
    expect(restored.rom()?.bytes[16384]).toBe(7);
    expect(restored.isRunning()).toBe(false);
  } finally {
    restored.dispose();
  }
});
