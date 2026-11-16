import { readFileSync } from "node:fs";
import { waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { DiskDrive } from "../devices/betaDisk";
import { createMachine, type Machine } from "../machine/machine";
import { MemoryBackend } from "../storage/memory";
import { makeFakeLoop } from "../test/fakes";
import { sclFixture } from "../test/scl";
import { diskFixture } from "../test/trd";
import { createAppStore } from ".";

const rom = new Uint8Array(readFileSync("public/roms/48.rom"));
const file = (name: string, bytes: Uint8Array) =>
  ({
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer,
  }) as File;
async function setup() {
  const backend = new MemoryBackend({
    initial: { name: "48.rom", bytes: rom },
  });
  const store = await createAppStore({
    backend,
    machineFactory: createMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  return { store, backend };
}
function change(machine: Machine, drive: DiskDrive, value: number) {
  machine.disk.selectDrive(drive);
  machine.disk.image[5000] = value;
  machine.disk.changed();
}

it("preserves both modified disks across cold boot and Spectrum ROM replacement, including B alone", async () => {
  const { store } = await setup();
  try {
    await store.importFiles([
      file("a.trd", diskFixture()),
      file("b.scl", sclFixture()),
    ]);
    const a = store.files().find((f) => f.name === "a.trd")?.id;
    const b = store.files().find((f) => f.name === "b.scl")?.id;
    if (!a || !b) throw new Error("Missing fixtures");
    await store.mountDiskFile(a, 0);
    await store.mountDiskFile(b, 1);
    const machine = store.machine() as Machine;
    change(machine, 0, 77);
    change(machine, 1, 93);
    store.refresh();
    store.run();
    store.coldBoot();
    await waitFor(() => expect(store.filesBusy()).toBe(false));
    expect(store.machine()).not.toBe(machine);
    expect(store.isRunning()).toBe(true);
    expect(store.disks()?.map((d) => [d.name, d.dirty])).toEqual([
      ["a.trd", true],
      ["b.scl", true],
    ]);
    let active = store.machine() as Machine;
    expect(active.exportDisk(false, 0)[5000]).toBe(77);
    expect(active.exportDisk(false, 1)[5000]).toBe(93);
    await store.importRom(file("replacement.rom", rom));
    active = store.machine() as Machine;
    expect(active.exportDisk(false, 0)[5000]).toBe(77);
    expect(active.exportDisk(false, 1)[5000]).toBe(93);
    const eject = store.ejectDisk(0);
    await waitFor(() => expect(store.diskChangePendingDrive()).toBe(0));
    store.resolveDiskChange("discard");
    await eject;
    store.pause();
    store.coldBoot();
    await waitFor(() => expect(store.filesBusy()).toBe(false));
    expect(store.isRunning()).toBe(false);
    expect(store.disks()?.[0].id).toBe("");
    expect(store.disks()?.[1].id).toBe(b);
    expect((store.machine() as Machine).exportDisk(false, 1)[5000]).toBe(93);
  } finally {
    store.dispose();
  }
});

it("confirms both mounted copies before deleting a shared library file and resumes after cancellation", async () => {
  const { store, backend } = await setup();
  try {
    await store.importFiles([file("shared.trd", diskFixture())]);
    const id = store.files()[0].id;
    await store.mountDiskFile(id, 0);
    await store.mountDiskFile(id, 1);
    const machine = store.machine() as Machine;
    change(machine, 0, 33);
    change(machine, 1, 66);
    store.refresh();
    store.run();
    const deleting = store.deleteFile(id);
    await waitFor(() => expect(store.diskChangePendingDrive()).toBe(0));
    store.resolveDiskChange("discard");
    await waitFor(() => expect(store.diskChangePendingDrive()).toBe(1));
    store.resolveDiskChange("cancel");
    await deleting;
    expect(store.disks()?.map((d) => d.id)).toEqual([id, id]);
    expect(await backend.getFile(id)).toBeTruthy();
    expect(store.isRunning()).toBe(true);
    expect(machine.exportDisk(false, 0)[5000]).toBe(33);
    expect(machine.exportDisk(false, 1)[5000]).toBe(66);
    const removing = store.deleteFile(id);
    for (const drive of [0, 1] as const) {
      await waitFor(() => expect(store.diskChangePendingDrive()).toBe(drive));
      store.resolveDiskChange("discard");
    }
    await removing;
    expect(store.disks()?.map((d) => d.id)).toEqual(["", ""]);
    expect(await backend.getFile(id)).toBeNull();
    expect(store.isRunning()).toBe(true);
  } finally {
    store.dispose();
  }
});

it("only asks about the target drive when replacing a modified disk", async () => {
  const { store } = await setup();
  try {
    await store.importFiles([
      file("first.trd", diskFixture()),
      file("second.trd", diskFixture()),
    ]);
    const [first, second] = store.files();
    await store.mountDiskFile(first.id, 0);
    await store.mountDiskFile(first.id, 1);
    const machine = store.machine() as Machine;
    change(machine, 0, 33);
    change(machine, 1, 66);
    store.refresh();
    const mounting = store.mountDiskFile(second.id, 1);
    await waitFor(() => expect(store.diskChangePendingDrive()).toBe(1));
    store.resolveDiskChange("discard");
    await mounting;
    expect(store.disks()?.map((d) => [d.id, d.dirty])).toEqual([
      [first.id, true],
      [second.id, false],
    ]);
    expect(machine.exportDisk(false, 0)[5000]).toBe(33);
  } finally {
    store.dispose();
  }
});
