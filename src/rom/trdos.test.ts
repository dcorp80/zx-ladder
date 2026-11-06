import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMachine } from "../machine/machine";
import { diskFixture } from "../test/trd";

for (const expanded of [false, true])
  for (const cpu7 of [false, true]) {
    it(`boots ROM-free BASIC disk (128K=${expanded}, turbo=${cpu7})`, () => {
      const m = createMachine({
        rom: new Uint8Array(
          readFileSync(expanded ? "public/roms/128.rom" : "public/roms/48.rom"),
        ),
        cpu7,
      });
      m.mountDisk(diskFixture(), "a", "a.trd");
      for (let i = 0; i < 420 && m.memory.read(0x8000) !== 42; i++)
        m.advanceFrame();
      expect(m.memory.read(0x8000), m.tape.status).toBe(42);
      expect(m.memory.read(0x5c53) | (m.memory.read(0x5c54) << 8)).toBe(0x5d3b);
    });
  }
it.each([false, true])(
  "services sector API with CPU instructions and real stack (turbo=%s)",
  (cpu7) => {
    const rom = new Uint8Array(16384);
    rom.set([
      0x31, 0, 0xff, 0x01, 5, 1, 0x11, 0, 0, 0x21, 0, 0x80, 0xcd, 0x13, 0x3d,
      0x76,
    ]);
    const m = createMachine({ rom, cpu7 });
    const image = diskFixture();
    m.mountDisk(image, "a", "a.trd", false);
    m.advancePixels(2000);
    expect(m.cpu.bus.nHALT).toBe(0);
    expect(m.cpu.snapshot().sp).toBe(0xff00);
    expect(m.memory.read(0x8000)).toBe(image[0]);
    expect(m.memory.read(0x8001)).toBe(image[1]);
    expect(m.cpu.snapshot().main.h).toBe(0x81);
    expect(m.cpu.snapshot().main.b).toBe(0);
    expect(m.dosEnabled).toBe(false);
    expect(m.disk.romRequired).toBe(false);
  },
);
it("switches before the same fetch, gates helpers, and retries unsupported fetch after ROM selection", () => {
  const rom = new Uint8Array(16384);
  rom.set([0xc3, 0, 0x3d]);
  const m = createMachine({ rom });
  expect(() => m.advancePixels(100)).toThrow("You need to provide TR-DOS ROM");
  expect(m.dosEnabled).toBe(true);
  const dos = new Uint8Array(16384);
  dos.set([0x3e, 42, 0x32, 0, 0x80, 0x76], 0x3d00);
  m.setDosRom(dos);
  m.advancePixels(1000);
  expect(m.memory.read(0x8000)).toBe(42);
  expect(m.disk.romRequired).toBe(false);
});
it.each([false, true])(
  "BASIC 15619 loads CODE through ROM-free 3D03 (turbo=%s)",
  (cpu7) => {
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
    image[4352] = 99;
    const m = createMachine({
      rom: new Uint8Array(readFileSync("public/roms/48.rom")),
      cpu7,
    });
    m.mountDisk(image, "a", "a.trd");
    for (let i = 0; i < 350 && m.memory.read(0x8000) !== 99; i++)
      m.advanceFrame();
    expect(
      m.memory.read(0x8000),
      `pc=${m.cpu.snapshot().pc.toString(16)}`,
    ).toBe(99);
    expect(m.disk.romRequired).toBe(false);
  },
);
it("128K ROM selection gates entry, and 7FFD changes under DOS preserve overlay", () => {
  const pair = new Uint8Array(32768);
  pair.set([0xc3, 0, 0x3d]);
  pair[0x3d00] = 0x76;
  const m = createMachine({ rom: pair });
  m.advancePixels(200);
  expect(m.dosEnabled).toBe(false);
  m.setReset(true);
  m.setReset(false);
  m.advancePixels(6);
  m.mcu.write(16);
  m.memory.romPages[1].splice(0, 3, 0xc3, 0, 0x3d);
  const dos = new Uint8Array(16384);
  dos[0x3d00] = 0x76;
  m.setDosRom(dos);
  m.advancePixels(300);
  expect(m.dosEnabled).toBe(true);
  m.mcu.write(0);
  expect(m.memory.read(0)).toBe(0);
  expect(m.dosEnabled).toBe(true);
});

const localDosRom = process.env.TRDOS_ROM;
it.skipIf(!localDosRom).each([false, true])(
  "supplied TR-DOS ROM loads boot.B through controller (128K=%s)",
  (expanded) => {
    const m = createMachine({
      rom: new Uint8Array(
        readFileSync(expanded ? "public/roms/128.rom" : "public/roms/48.rom"),
      ),
    });
    if (!localDosRom) throw new Error("Set TRDOS_ROM to a local ROM path.");
    m.setDosRom(new Uint8Array(readFileSync(localDosRom)));
    m.mountDisk(diskFixture(), "a", "a.trd");
    for (let i = 0; i < 500 && m.memory.read(0x8000) !== 42; i++)
      m.advanceFrame();
    expect(m.memory.read(0x8000)).toBe(42);
  },
  15000,
);
it.each([false, true])(
  "restores saved BASIC variables independently of program length (128K=%s)",
  (expanded) => {
    const body = [
      0xf4,
      ...Array.from("32768", (c) => c.charCodeAt(0)),
      14,
      0,
      0,
      0,
      128,
      0,
      44,
      97,
      13,
    ];
    const image = diskFixture(body),
      programLength = body.length + 4;
    const variables = [0x61, 0, 0, 73, 0, 0];
    image.set(variables, 4096 + programLength);
    image.set([128, 170, 10, 0], 4096 + programLength + variables.length);
    image[9] = programLength + variables.length;
    const m = createMachine({
      rom: new Uint8Array(
        readFileSync(expanded ? "public/roms/128.rom" : "public/roms/48.rom"),
      ),
    });
    m.mountDisk(image, "a", "a.trd");
    for (let i = 0; i < 350 && m.memory.read(0x8000) !== 73; i++)
      m.advanceFrame();
    expect(m.memory.read(0x8000)).toBe(73);
  },
);
it("ROM-free sector loader follows all eight currently paged RAM banks", () => {
  const pair = new Uint8Array(32768);
  pair.set([0x31, 0, 0xb0, 0xc3, 0, 0x90]);
  const m = createMachine({ rom: pair });
  const image = diskFixture(),
    code: number[] = [0xf3];
  for (let page = 0; page < 8; page++) {
    image.fill(page + 10, (16 + page) * 256, (17 + page) * 256);
    code.push(
      0x01,
      0xfd,
      0x7f,
      0x3e,
      16 | page,
      0xed,
      0x79,
      0x01,
      5,
      1,
      0x11,
      page,
      1,
      0x21,
      0,
      0xc0,
      0xcd,
      0x13,
      0x3d,
    );
  }
  code.push(0x76);
  code.forEach((byte, i) => {
    m.memory.write(0x9000 + i, byte);
  });
  m.mountDisk(image, "a", "a.trd", false);
  m.advancePixels(20000);
  expect(m.cpu.bus.nHALT).toBe(0);
  expect(m.memory.ramPages.map((p) => p[0])).toEqual([
    10, 11, 12, 13, 14, 15, 16, 17,
  ]);
});
it.each([5, 6])(
  "ROM-free sector function %s handles omitted trailing sectors",
  (command) => {
    const rom = new Uint8Array(16384);
    rom.set([
      0x31,
      0,
      0xff,
      0x01,
      command,
      1,
      0x11,
      2,
      1,
      0x21,
      0,
      0x80,
      0xcd,
      0x13,
      0x3d,
      0x76,
    ]);
    const m = createMachine({ rom });
    const image = diskFixture().slice(0, 0x1100);
    m.mountDisk(image, "short", "short.trd", false);
    if (command === 6)
      for (let i = 0; i < 256; i++) m.memory.write(0x8000 + i, 91);
    m.advancePixels(2000);
    expect(m.cpu.bus.nHALT).toBe(0);
    if (command === 5) {
      expect(m.memory.read(0x8000)).toBe(0);
      expect(m.disk.image.length).toBe(image.length);
    } else {
      expect(m.disk.image.length).toBe(0x1300);
      expect(m.disk.image[0x1200]).toBe(91);
      expect(m.disk.image[0x1100]).toBe(0);
      expect(m.disk.dirty).toBe(true);
    }
  },
);
it("runs trailer-free packed BASIC allocations and tracks the next sector actually loaded", () => {
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
    ...Array.from('RUN"next"', (c) => c.charCodeAt(0)),
    13,
  ];
  const image = diskFixture(body),
    next = diskFixture();
  image.fill(0, 4096 + body.length + 4, 4096 + body.length + 8);
  image.set(
    Array.from("next    B", (c) => c.charCodeAt(0)),
    16,
  );
  image.set(next.subarray(9, 16), 25);
  image[29] = 40;
  image[30] = 1;
  const length = next[9] | (next[10] << 8);
  image.set(next.subarray(4096, 4096 + length), 4352);
  const m = createMachine({
    rom: new Uint8Array(readFileSync("public/roms/128.rom")),
  });
  m.mountDisk(image, "a", "packed.trd");
  for (let i = 0; i < 400 && m.memory.read(0x8000) !== 42; i++)
    m.advanceFrame();
  expect(m.memory.read(0x8000)).toBe(42);
  expect(m.memory.read(0x5cf4)).toBe(2);
  expect(m.memory.read(0x5cf5)).toBe(1);
});
it("initial ROM-free disk startup initializes the next-sector pointer from BASIC length", () => {
  const image = diskFixture();
  image[13] = 40;
  image.fill(0, 4096 + image[9], 4096 + image[9] + 4);
  const m = createMachine({
    rom: new Uint8Array(readFileSync("public/roms/48.rom")),
  });
  m.mountDisk(image, "a", "packed.trd");
  for (let i = 0; i < 400 && m.memory.read(0x8000) !== 42; i++)
    m.advanceFrame();
  expect(m.memory.read(0x8000)).toBe(42);
  expect(m.memory.read(0x5cf4)).toBe(1);
  expect(m.memory.read(0x5cf5)).toBe(1);
});
it("accepts literal VAL strings for BASIC DOS CODE address and length", () => {
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
    0xb0,
    34,
    ...Array.from("32768", (c) => c.charCodeAt(0)),
    34,
    44,
    0xb0,
    34,
    49,
    34,
    13,
  ];
  const image = diskFixture(body);
  image.set(
    Array.from("data    C", (c) => c.charCodeAt(0)),
    16,
  );
  image.set([0, 0x90, 2, 0, 1, 1, 1], 25);
  image[4352] = 99;
  image[4353] = 88;
  const m = createMachine({
    rom: new Uint8Array(readFileSync("public/roms/128.rom")),
  });
  m.mountDisk(image, "a", "val.trd");
  for (let i = 0; i < 400 && m.memory.read(0x8000) !== 99; i++)
    m.advanceFrame();
  expect(m.memory.read(0x8000)).toBe(99);
  expect(m.memory.read(0x8001)).not.toBe(88);
  expect(m.disk.romRequired).toBe(false);
});
it("matches the ROM next-sector pointer for an exact 256-byte CODE load", () => {
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
  image.set([0, 0x80, 0, 1, 1, 1, 1], 25);
  image.fill(77, 4352, 4608);
  const m = createMachine({
    rom: new Uint8Array(readFileSync("public/roms/128.rom")),
  });
  m.mountDisk(image, "a", "exact.trd");
  for (let i = 0; i < 400 && m.memory.read(0x8000) !== 77; i++)
    m.advanceFrame();
  expect(m.memory.read(0x8000)).toBe(77);
  expect(m.memory.read(0x5cf4)).toBe(3);
  expect(m.memory.read(0x5cf5)).toBe(1);
});
