import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { fileId } from "../files/library";
import { crc32 } from "../files/zip";
import { createMachine, type Machine } from "../machine/machine";
import { MemoryBackend } from "../storage/memory";
import { makeFakeLoop } from "../test/fakes";
import { basicTapFixture } from "../test/tape";
import { diskFixture } from "../test/trd";
import { createAppStore } from ".";

const firmware = new Uint8Array(readFileSync("public/roms/48.rom"));
const file = (name: string, bytes: Uint8Array) =>
  new File([new Uint8Array(bytes)], name);

function zip(entries: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const local: Uint8Array[] = [],
    directory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const member = new Uint8Array(30 + name.length + entry.bytes.length);
    const header = new DataView(member.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint32(14, crc32(entry.bytes), true);
    header.setUint32(18, entry.bytes.length, true);
    header.setUint32(22, entry.bytes.length, true);
    header.setUint16(26, name.length, true);
    member.set(name, 30);
    member.set(entry.bytes, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true);
    record.setUint32(16, crc32(entry.bytes), true);
    record.setUint32(20, entry.bytes.length, true);
    record.setUint32(24, entry.bytes.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    central.set(name, 46);
    local.push(member);
    directory.push(central);
    offset += member.length;
  }
  const directorySize = directory.reduce(
    (size, member) => size + member.length,
    0,
  );
  const result = new Uint8Array(offset + directorySize + 22);
  let position = 0;
  for (const part of [...local, ...directory]) {
    result.set(part, position);
    position += part.length;
  }
  const end = new DataView(result.buffer, position, 22);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return result;
}

async function setup() {
  const backend = new MemoryBackend({
    initial: { name: "48.rom", bytes: firmware },
  });
  const store = await createAppStore({
    backend,
    machineFactory: createMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  store.set48kMode(true);
  store.setReset(true);
  store.setReset(false);
  return { store, backend, machine: store.machine() as Machine };
}

function executeBasic(machine: Machine) {
  for (
    let frame = 0;
    frame < 420 && machine.memory.read(0x8000) !== 42;
    frame++
  )
    machine.advanceFrame();
  expect(machine.memory.read(0x8000)).toBe(42);
}

it.each([false, true])(
  "saves a single tape before automatically loading and executing it (ZIP=%s)",
  async (archived) => {
    const { store, backend, machine } = await setup();
    const tape = basicTapFixture();
    const name = archived ? "folder/basic.tap" : "basic.tap";
    const id = fileId(archived ? "tape.zip" : null, name);
    const order: string[] = [];
    const putFiles = backend.putFiles.bind(backend);
    vi.spyOn(backend, "putFiles").mockImplementation(async (files) => {
      await putFiles(files);
      order.push("saved");
    });
    const loadTape = machine.loadTape.bind(machine);
    vi.spyOn(machine, "loadTape").mockImplementation((...args) => {
      order.push("loaded");
      expect(store.files().map((entry) => entry.id)).toContain(id);
      loadTape(...args);
    });
    try {
      await store.importFiles([
        archived
          ? file("tape.zip", zip([{ name, bytes: tape }]))
          : file(name, tape),
      ]);
      expect(order).toEqual(["saved", "loaded"]);
      expect((await backend.getFile(id))?.bytes).toEqual(tape);
      expect(store.tape()?.name).toBe(name);
      expect(store.isRunning()).toBe(true);
      expect(store.filesBusy()).toBe(false);
      executeBasic(machine);
      expect(store.error()).toBeNull();
    } finally {
      store.dispose();
    }
  },
  30_000,
);

it.each([
  { archived: false, basicName: "boot" },
  { archived: true, basicName: "demo" },
])(
  "automatically mounts drive A and executes its single BASIC program (ZIP=$archived, name=$basicName)",
  async ({ archived, basicName }) => {
    const { store, backend, machine } = await setup();
    const disk = diskFixture();
    disk.fill(32, 0, 8);
    disk.set(new TextEncoder().encode(basicName), 0);
    const name = archived ? "disk/demo.trd" : "boot.trd";
    const id = fileId(archived ? "disk.zip" : null, name);
    try {
      await store.importFiles([
        archived
          ? file("disk.zip", zip([{ name, bytes: disk }]))
          : file(name, disk),
      ]);
      expect((await backend.getFile(id))?.bytes).toEqual(disk);
      expect(store.disks()?.[0].id).toBe(id);
      expect(store.disks()?.[1].id).toBe("");
      expect(store.isRunning()).toBe(true);
      executeBasic(machine);
      expect(store.error()).toBeNull();
    } finally {
      store.dispose();
    }
  },
  30_000,
);

it.each([false, true])(
  "keeps multiple imported media in the library without loading (ZIP=%s)",
  async (archived) => {
    const { store, machine } = await setup();
    const tape = basicTapFixture();
    const load = vi.spyOn(machine, "loadTape");
    const mount = vi.spyOn(machine, "mountDisk");
    machine.memory.write(0x8000, 77);
    const pc = machine.cpu.regs.pc;
    try {
      const entries = [
        { name: "first.tap", bytes: tape },
        { name: "second.trd", bytes: diskFixture() },
      ];
      await store.importFiles(
        archived
          ? [file("multiple.zip", zip(entries))]
          : entries.map((f) => file(f.name, f.bytes)),
      );
      expect(store.files()).toHaveLength(2);
      expect(load).not.toHaveBeenCalled();
      expect(mount).not.toHaveBeenCalled();
      expect(store.isRunning()).toBe(false);
      expect(machine.cpu.regs.pc).toBe(pc);
      expect(machine.memory.read(0x8000)).toBe(77);
    } finally {
      store.dispose();
    }
  },
);

it("loads a confirmed single replacement, while skip and cancel preserve the stored tape", async () => {
  const { store, backend, machine } = await setup();
  const original = basicTapFixture();
  const changed = new Uint8Array([3, 0, 255, 99, 156]);
  const id = fileId(null, "demo.tap");
  try {
    await store.importFiles([file("demo.tap", original)]);
    store.pause();
    const load = vi.spyOn(machine, "loadTape");
    machine.memory.write(0x8000, 77);

    await store.importFiles([file("demo.tap", changed)]);
    expect(store.pendingImport()).not.toBeNull();
    store.cancelImport();
    expect(store.pendingImport()).toBeNull();
    expect((await backend.getFile(id))?.bytes).toEqual(original);
    expect(load).not.toHaveBeenCalled();

    await store.importFiles([file("demo.tap", changed)]);
    await store.confirmImport([]);
    expect((await backend.getFile(id))?.bytes).toEqual(original);
    expect(load).not.toHaveBeenCalled();
    expect(store.isRunning()).toBe(false);
    expect(machine.memory.read(0x8000)).toBe(77);

    await store.importFiles([file("demo.tap", changed)]);
    await store.confirmImport([id]);
    expect((await backend.getFile(id))?.bytes).toEqual(changed);
    expect(load).toHaveBeenCalledOnce();
    expect(store.isRunning()).toBe(true);
  } finally {
    store.dispose();
  }
});

it("does not autoload one accepted entry from an original multi-file batch", async () => {
  const { store, backend, machine } = await setup();
  const tape = basicTapFixture();
  try {
    await store.importFiles([
      file("first.tap", tape),
      file("second.tap", tape),
    ]);
    const load = vi.spyOn(machine, "loadTape");
    await store.importFiles([
      file("first.tap", new Uint8Array([3, 0, 255, 99, 156])),
      file("new.tap", tape),
    ]);
    expect(store.pendingImport()).not.toBeNull();
    await store.confirmImport([]);
    expect(store.files()).toHaveLength(3);
    expect((await backend.getFile(fileId(null, "first.tap")))?.bytes).toEqual(
      tape,
    );
    expect(load).not.toHaveBeenCalled();
    expect(store.isRunning()).toBe(false);
  } finally {
    store.dispose();
  }
});

it("preserves the library and running machine when saving fails or all files are invalid", async () => {
  const { store, backend, machine } = await setup();
  const tape = basicTapFixture();
  try {
    await store.importFiles([
      file("first.tap", tape),
      file("second.tap", tape),
    ]);
    const original = store.files();
    const load = vi.spyOn(machine, "loadTape");
    machine.memory.write(0x8000, 77);
    store.run();
    vi.spyOn(backend, "putFiles").mockRejectedValueOnce(
      new Error("Quota exceeded"),
    );
    await store.importFiles([file("unsaved.tap", tape)]);
    expect(store.error()).toBe("Quota exceeded");
    expect(store.files()).toEqual(original);
    expect(await backend.getFile(fileId(null, "unsaved.tap"))).toBeNull();

    await store.importFiles([file("broken.tap", new Uint8Array([1]))]);
    expect(store.files()).toEqual(original);
    expect(store.filesMessage()).toContain("broken.tap");
    expect(load).not.toHaveBeenCalled();
    expect(store.machine()).toBe(machine);
    expect(machine.memory.read(0x8000)).toBe(77);
    expect(store.isRunning()).toBe(true);
    expect(store.filesBusy()).toBe(false);
  } finally {
    store.dispose();
  }
});
