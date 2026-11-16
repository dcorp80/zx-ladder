import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMachine } from "../machine/machine";
import { diskFixture } from "../test/trd";

const rom48 = new Uint8Array(readFileSync("public/roms/48.rom"));
const rom128 = new Uint8Array(readFileSync("public/roms/128.rom"));

function continuationDisk(marker: number): Uint8Array {
  const body = [
    0xf9,
    0xc0,
    ...Array.from("15619", (c) => c.charCodeAt(0)),
    14,
    0,
    0,
    3,
    0x3d,
    0,
    58,
    0xea,
    58,
    0xef,
    34,
    ...Array.from("data", (c) => c.charCodeAt(0)),
    34,
    0xaf,
    13,
  ];
  const image = diskFixture(body);
  image.set(
    Array.from("data    C", (c) => c.charCodeAt(0)),
    16,
  );
  image.set([0, 0x80, 1, 0, 1, 1, 1], 25);
  image[4352] = marker;
  image[0x8e4] = 2;
  return image;
}

for (const expanded of [false, true]) {
  for (const cpu7 of [false, true]) {
    it(`runs BASIC from B and keeps subsequent unprefixed loads on B (128K=${expanded}, turbo=${cpu7})`, () => {
      const m = createMachine({ rom: expanded ? rom128 : rom48, cpu7 });
      m.mountDisk(continuationDisk(73), "a", "a.trd", false);
      m.mountDisk(continuationDisk(99), "b", "b.trd", false, false, 1);
      m.runDisk(0, 1);
      for (let i = 0; i < 400 && m.memory.read(0x8000) !== 99; i++)
        m.advanceFrame();
      expect(m.memory.read(0x8000)).toBe(99);
      expect(m.disk.drive).toBe(1);
      expect(m.memory.read(0x5cf6)).toBe(1);
      expect(m.memory.read(0x5d19)).toBe(1);
      expect(m.diskState.id).toBe("a");
      expect(m.diskStates.map((d) => d.id)).toEqual(["a", "b"]);
      expect(m.exportDisk(false, 0)[4352]).toBe(73);
      expect(m.exportDisk(false, 1)[4352]).toBe(99);
    }, 30000);
  }
}

it("selects B through 3D13 when A is empty, then reads and writes only B through real CPU calls", () => {
  const rom = new Uint8Array(16384);
  rom.set([
    0x31,
    0,
    0xff,
    0x3e,
    1,
    0x0e,
    1,
    0xcd,
    0x13,
    0x3d, // A=1,C=1 select B.
    0x01,
    5,
    1,
    0x11,
    0,
    0,
    0x21,
    0,
    0x80,
    0xcd,
    0x13,
    0x3d,
    0x01,
    6,
    1,
    0x11,
    1,
    0,
    0x21,
    0,
    0x80,
    0xcd,
    0x13,
    0x3d,
    0x76,
  ]);
  const m = createMachine({ rom });
  const image = diskFixture();
  m.mountDisk(image, "b", "b.trd", false, false, 1);
  m.advancePixels(10000);
  expect(m.cpu.bus.nHALT).toBe(0);
  expect(m.cpu.snapshot().sp).toBe(0xff00);
  expect(m.memory.read(0x8000)).toBe(image[0]);
  expect(m.disk.drive).toBe(1);
  expect(m.diskStates[0].id).toBe("");
  expect(m.diskStates[1].dirty).toBe(true);
  expect(m.exportDisk(false, 1).slice(256, 512)).toEqual(image.slice(0, 256));
});

it("mounts and exports either drive without moving the selected drive or resetting execution", () => {
  const m = createMachine({ rom: rom48 });
  m.advancePixels(10000);
  m.mountDisk(diskFixture(), "a", "a.trd", false);
  m.disk.dosEnabled = true;
  m.disk.selectDrive(1);
  const pc = m.cpu.regs.pc,
    system = m.disk.system,
    position = m.framePosition;
  m.mountDisk(diskFixture(), "b", "b.trd", false, true, 1);
  expect(m.disk.drive).toBe(1);
  expect(m.cpu.regs.pc).toBe(pc);
  expect(m.framePosition).toBe(position);
  expect(m.disk.dosEnabled).toBe(true);
  m.mountDisk(diskFixture(), "a2", "a2.trd", false);
  expect(m.disk.system).toBe(system);
  m.exportDisk(true, 0);
  expect(m.diskStates[1].dirty).toBe(true);
  m.exportDisk(true, 1);
  expect(m.diskStates[1].dirty).toBe(false);
  m.ejectDisk(0);
  expect(m.disk.system).toBe(system);
  expect(m.diskStates[1].id).toBe("b");
  m.setReset(true);
  m.setReset(false);
  expect(m.diskStates[1].id).toBe("b");
});

it.each(['*"b"', 'LOAD "b:data" CODE'])(
  "selects B through ROM-free BASIC with A empty: %s",
  (command) => {
    const rom = new Uint8Array(16384);
    rom.set([
      0x31, 0, 0xff, 0x21, 0, 0x90, 0x22, 0x5d, 0x5c, 0xcd, 3, 0x3d, 0x76,
    ]);
    const m = createMachine({ rom });
    m.mountDisk(continuationDisk(99), "b", "b.trd", false, false, 1);
    m.memory.write(0x5d19, 0);
    Array.from(`${command}\r`, (c, i) =>
      m.memory.write(0x9000 + i, c.charCodeAt(0)),
    );
    m.advancePixels(10000);
    expect(m.cpu.bus.nHALT).toBe(0);
    expect(m.cpu.snapshot().sp).toBe(0xff00);
    expect(m.disk.drive).toBe(1);
    expect(m.memory.read(0x5cf6)).toBe(1);
    expect(m.memory.read(0x5d19)).toBe(command.startsWith("*") ? 1 : 0);
    if (!command.startsWith("*")) expect(m.memory.read(0x8000)).toBe(99);
  },
);

const localDos = process.env.TRDOS_ROM;
it.skipIf(!localDos).each([false, true])(
  "runs B with a supplied real TR-DOS ROM and retains default B for continuation loads (128K=%s)",
  (expanded) => {
    const m = createMachine({ rom: expanded ? rom128 : rom48 });
    m.setDosRom(new Uint8Array(readFileSync(localDos ?? "")));
    m.mountDisk(continuationDisk(73), "a", "a.trd", false);
    m.mountDisk(continuationDisk(99), "b", "b.trd", false, false, 1);
    m.runDisk(0, 1);
    for (let i = 0; i < 500 && m.memory.read(0x8000) !== 99; i++)
      m.advanceFrame();
    expect(m.memory.read(0x8000)).toBe(99);
    expect(m.disk.drive).toBe(1);
    expect(m.memory.read(0x5cf6)).toBe(1);
    expect(m.memory.read(0x5d19)).toBe(1);
  },
  30000,
);
