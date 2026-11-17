import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { SpectrumKey } from "../devices/keyboard";
import { createMachine, type Machine } from "../machine/machine";
import { asTzx, basicTapFixture } from "../test/tape";

const rom48 = new Uint8Array(readFileSync("public/roms/48.rom"));
const rom128 = new Uint8Array(readFileSync("public/roms/128.rom"));

function block(flag: number, payload: number[]): number[] {
  const bytes = [flag, ...payload];
  return [
    (bytes.length + 1) & 255,
    (bytes.length + 1) >>> 8,
    ...bytes,
    bytes.reduce((a, b) => a ^ b, 0),
  ];
}

function numeric(value: number): number[] {
  return [
    ...Array.from(String(value), (c) => c.charCodeAt(0)),
    14,
    0,
    0,
    value & 255,
    value >>> 8,
    0,
  ];
}

function line(number: number, body: number[]): number[] {
  const bytes = [...body, 13];
  return [
    number >>> 8,
    number & 255,
    bytes.length & 255,
    bytes.length >>> 8,
    ...bytes,
  ];
}

function poke(number: number, address: number, value: number): number[] {
  return line(number, [0xf4, ...numeric(address), 44, ...numeric(value)]);
}

function basic(
  program: number[],
  startLine: number,
  name = "SELECTED",
): number[] {
  return [
    ...block(0, [
      0,
      ...Array.from(name.padEnd(10).slice(0, 10), (c) => c.charCodeAt(0)),
      program.length & 255,
      program.length >>> 8,
      startLine & 255,
      startLine >>> 8,
      program.length & 255,
      program.length >>> 8,
    ]),
    ...block(255, program),
  ];
}

function advanceUntil(m: Machine, predicate: () => boolean, frames = 400) {
  for (let i = 0; i < frames && !predicate(); i++) m.advanceFrame();
}

function enterLoad(m: Machine) {
  const keys: SpectrumKey[][] = [
    ["J"],
    ["SYMBOL_SHIFT", "P"],
    ["SYMBOL_SHIFT", "P"],
    ["ENTER"],
  ];
  for (const chord of keys) {
    m.keyboard.press("test-user", chord);
    for (let i = 0; i < 4; i++) m.advanceFrame();
    m.keyboard.release("test-user");
    for (let i = 0; i < 4; i++) m.advanceFrame();
  }
}

for (const expanded of [false, true]) {
  for (const cpu7 of [false, true]) {
    it(`runs the selected BASIC program, including saved autostart and no LINE (128K=${expanded}, turbo=${cpu7})`, () => {
      const m = createMachine({ rom: expanded ? rom128 : rom48, cpu7 });
      for (const autostart of [true, false]) {
        const image = new Uint8Array([
          ...basic(poke(10, 0x8000, 99), 10, "FIRST"),
          ...basic(
            [...poke(10, 0x8001, 17), ...poke(20, 0x8000, 42)],
            autostart ? 20 : 0x8000,
          ),
          ...basic(poke(10, 0x8000, 97), 10, "LAST"),
        ]);
        const original = image.slice();
        // Exercise the same expanded playback sequence through TZX too.
        m.mountTape(
          expanded ? asTzx(image) : image,
          expanded ? "multi.tzx" : "multi.tap",
        );
        const catalog = m.tapeState.catalog;
        expect(catalog.map((entry) => entry.runnable)).toEqual([
          true,
          false,
          true,
          false,
          true,
          false,
        ]);
        m.memory.write(0x8000, 0);
        m.memory.write(0x8001, 0);
        m.runTape(2);
        advanceUntil(m, () => m.memory.read(0x8000) === 42);
        expect(m.memory.read(0x8000), m.tape.status).toBe(42);
        if (autostart) expect(m.memory.read(0x8001)).not.toBe(17);
        else expect(m.memory.read(0x8001)).toBe(17);
        expect(m.tapeState.cursor).toBe(4);
        expect(m.tapeState.catalog).toBe(catalog);
        expect(m.tapeState.catalog[4].name).toBe("LAST");
        expect(image).toEqual(original);
        if (expanded) expect(m.mcu.latch & 0x20).toBe(0);
      }
    }, 30000);
  }
}

it.each([false, true])(
  "retains following CODE blocks for a running BASIC loader (128K=%s)",
  (expanded) => {
    const program = [
      ...line(10, [0xef, 34, 34, 0xaf, ...numeric(40000)]),
      ...poke(20, 0x8000, 42),
    ];
    const image = new Uint8Array([
      ...basic(poke(10, 0x8000, 99), 10, "FIRST"),
      ...basic(program, 10),
      ...block(0, [
        3,
        ...Array.from("CONTINUE  ", (c) => c.charCodeAt(0)),
        3,
        0,
        0x40,
        0x9c,
        0,
        0x80,
      ]),
      ...block(255, [1, 2, 3]),
    ]);
    const m = createMachine({ rom: expanded ? rom128 : rom48 });
    m.mountTape(image, "continuation.tap");
    m.runTape(2);
    advanceUntil(m, () => m.memory.read(0x8000) === 42);
    expect(m.memory.read(0x8000), m.tape.status).toBe(42);
    expect([0, 1, 2].map((offset) => m.memory.read(40000 + offset))).toEqual([
      1, 2, 3,
    ]);
    expect(m.tapeState.cursor).toBe(6);
  },
  30000,
);

it("repeats Run without changing a program saved without autostart", () => {
  const m = createMachine({ rom: rom48 });
  m.mountTape(
    new Uint8Array(basic(poke(10, 0x8000, 42), 0x8000)),
    "no-line.tap",
  );
  const catalog = m.tapeState.catalog;
  for (let i = 0; i < 2; i++) {
    m.memory.write(0x8000, 0);
    m.runTape(0);
    advanceUntil(m, () => m.memory.read(0x8000) === 42);
    expect(m.memory.read(0x8000), m.tape.status).toBe(42);
    expect(m.tapeState.cursor).toBe(2);
    expect(m.tapeState.catalog).toBe(catalog);
  }
  m.setReset(true);
  m.setReset(false);
  m.seekTape(0);
  for (let i = 0; i < 100; i++) m.advanceFrame();
  m.memory.write(0x8000, 0);
  enterLoad(m);
  for (let i = 0; i < 30; i++) m.advanceFrame();
  expect(m.tapeState.cursor).toBe(2);
  expect(m.memory.read(0x8000)).toBe(0);
}, 30000);

it("rewinds and cancels a pending selected Run without ejecting tape or releasing user keys", () => {
  const m = createMachine({ rom: rom48 });
  const image = basicTapFixture();
  m.mountTape(new Uint8Array([...image, ...image]), "pending.tap");
  const catalog = m.tapeState.catalog;
  m.runTape(2);
  expect(m.tapeState.cursor).toBe(2);
  m.keyboard.press("user", "X");
  m.setReset(true);
  m.setReset(false);
  expect(m.tapeState.cursor).toBe(0);
  expect(m.tapeState.name).toBe("pending.tap");
  expect(m.tapeState.catalog).toBe(catalog);
  expect(m.keyboard.isPressed("X")).toBe(true);
  for (let frame = 0; frame < 12; frame++) m.tape.frame();
  expect(m.tape.status).toBe("Tape rewound; automatic loading cancelled.");
  expect(m.keyboard.hasOtherSources("user")).toBe(false);
});

it.each(["reset", "seek", "eject"])(
  "clears the temporary autostart header on %s before loading",
  (action) => {
    const m = createMachine({ rom: rom48 });
    const image = new Uint8Array(basic(poke(10, 0x8000, 42), 0x8000));
    m.mountTape(image, "cancel.tap");
    m.runTape(0);
    if (action === "reset") {
      m.setReset(true);
      m.setReset(false);
    } else if (action === "seek") m.seekTape(0);
    else {
      m.ejectTape();
      m.mountTape(image, "cancel.tap");
    }
    for (let i = 0; i < 100; i++) m.advanceFrame();
    m.memory.write(0x8000, 0);
    enterLoad(m);
    for (let i = 0; i < 30; i++) m.advanceFrame();
    expect(m.tapeState.cursor).toBe(2);
    expect(m.memory.read(0x8000)).toBe(0);
  },
  30000,
);

it("rejects invalid selections and non-program blocks before asserting reset", () => {
  const m = createMachine({ rom: rom48 });
  m.advancePixels(10000);
  const unchanged = () => ({
    pc: m.cpu.regs.pc,
    reset: m.cpu.bus.nRESET,
    cursor: m.tapeState.cursor,
  });
  let before = unchanged();
  expect(() => m.runTape(0)).toThrow(/BASIC/);
  expect(unchanged()).toEqual(before);
  const valid = basicTapFixture();
  m.mountTape(valid, "valid.tap");
  for (const index of [-1, 1, 2, 0.5, Number.NaN]) {
    before = unchanged();
    expect(() => m.runTape(index)).toThrow(/BASIC/);
    expect(unchanged()).toEqual(before);
  }
  for (const kind of [
    "header checksum",
    "data checksum",
    "CODE",
    "missing data",
    "length",
  ]) {
    let image = valid.slice();
    if (kind === "header checksum") image[20] ^= 1;
    else if (kind === "data checksum") image[image.length - 1] ^= 1;
    else if (kind === "missing data") image = image.slice(0, 21);
    else {
      if (kind === "CODE") image[3] = 3;
      else image[14] ^= 1;
      image[20] = 0;
      for (let i = 2; i < 20; i++) image[20] ^= image[i];
    }
    m.mountTape(image, "invalid.tap");
    expect(m.tapeState.catalog[0].runnable, kind).toBe(false);
    before = unchanged();
    expect(() => m.runTape(0), kind).toThrow(/BASIC/);
    expect(unchanged()).toEqual(before);
  }
});
