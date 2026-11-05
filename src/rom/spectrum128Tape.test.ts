import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { TZX_SIGNATURE } from "../files/tzx";
import { createMachine } from "../machine/machine";
import { TAPE_ROM_SIGNATURE } from "./spectrum48Tape";

const firmware = new Uint8Array(readFileSync("public/roms/128.rom"));
function block(flag: number, payload: number[]): number[] {
  const data = [flag, ...payload];
  return [
    (data.length + 1) & 255,
    (data.length + 1) >>> 8,
    ...data,
    data.reduce((a, b) => a ^ b, 0),
  ];
}
function basicTape(): Uint8Array {
  // 10 POKE 32768,42. Integer literals carry the ROM's five-byte number form.
  const line = [
    0xf4,
    ...Array.from("32768", (c) => c.charCodeAt(0)),
    0x0e,
    0,
    0,
    0,
    128,
    0,
    44,
    52,
    50,
    0x0e,
    0,
    0,
    42,
    0,
    0,
    13,
  ];
  const program = [0, 10, line.length, 0, ...line];
  const header = [
    0,
    ...Array.from("FLASH128  ", (c) => c.charCodeAt(0)),
    program.length,
    0,
    10,
    0,
    program.length,
    0,
  ];
  return new Uint8Array([...block(0, header), ...block(255, program)]);
}

it.each([false, true])(
  "loads and executes BASIC from the real 128K menu (turbo=%s)",
  (cpu7) => {
    const m = createMachine({ rom: firmware, cpu7 });
    expect(m.tape.supports128Menu).toBe(true);
    m.loadTape(basicTape(), "basic128.tap");
    for (let i = 0; i < 400 && m.memory.read(0x8000) !== 42; i++)
      m.advanceFrame();
    expect(m.tape.status).toBe("Block 2/2 loaded; end of tape.");
    expect(m.memory.read(0x8000)).toBe(42);
    expect(m.mcu.latch & 0x20).toBe(0); // Still 128K, not a forced 48K boot.
    expect(m.memory.romPages.flat()).toEqual(Array.from(firmware));
  },
  30000,
);

it("loads successive blocks into all eight banks through real CPU paging and ROM calls", () => {
  const pair = new Uint8Array(32768);
  for (const base of [0, 16384]) {
    pair.set(TAPE_ROM_SIGNATURE, base + 0x53f);
    pair.set([0xfd, 0xcb, 2, 0x5e], base + 0x10a8);
    pair.set([0x31, 0, 0xb0, 0xc3, 0, 0x90], base);
  }
  const m = createMachine({ rom: pair });
  const program: number[] = [0xf3];
  const tape: number[] = [];
  for (let page = 0; page < 8; page++) {
    // Alternate ROMs too, to prove that paging does not reset the tape cursor.
    program.push(
      0x01,
      0xfd,
      0x7f,
      0x3e,
      page | (page & 1 ? 16 : 0),
      0xed,
      0x79,
      0xdd,
      0x21,
      0,
      0xc0,
      0x11,
      3,
      0,
      0x3e,
      255,
      0x37,
      0x08,
      0xcd,
      0x6c,
      5,
    );
    tape.push(...block(255, [page + 1, page + 11, page + 21]));
  }
  program.push(0x76);
  program.forEach((value, i) => {
    m.memory.write(0x9000 + i, value);
  });
  m.loadTape(new Uint8Array(tape), "banks.tap");
  m.advancePixels(50000);
  expect(m.cpu.bus.nHALT).toBe(0);
  expect(m.tape.status).toBe("Block 8/8 loaded; end of tape.");
  for (let page = 0; page < 8; page++)
    expect(m.memory.ramPages[page].slice(0, 3)).toEqual([
      page + 1,
      page + 11,
      page + 21,
    ]);
  expect(m.cpu.snapshot().sp).toBe(0xb000);
});

it("rejects invalid tape and incompatible paging before resetting an active 128K machine", () => {
  const m = createMachine({ rom: firmware });
  m.mcu.write(7);
  expect(() => m.loadTape(new Uint8Array([1]), "bad.tap")).toThrow();
  expect(m.mcu.latch).toBe(7);
  expect(m.cpu.bus.nRESET).toBe(1);
  m.setDecodeFd(true);
  expect(() => m.loadTape(basicTape(), "basic.tap")).toThrow("standard 128K");
  expect(m.mcu.latch).toBe(7);
});

it("loads TZX past a 48K-only stop marker in 128K mode", () => {
  const tap = basicTape();
  const tzx = [...TZX_SIGNATURE, 1, 20, 0x2a, 0, 0, 0, 0];
  for (let at = 0; at < tap.length; ) {
    const length = tap[at] | (tap[at + 1] << 8);
    tzx.push(0x10, 0xe8, 3, ...tap.subarray(at, at + length + 2));
    at += length + 2;
  }
  const m = createMachine({ rom: firmware });
  m.loadTape(new Uint8Array(tzx), "basic128.tzx");
  for (let i = 0; i < 400 && m.memory.read(0x8000) !== 42; i++)
    m.advanceFrame();
  expect(m.memory.read(0x8000)).toBe(42);
  expect(m.tape.status).toBe("Block 2/2 loaded; end of tape.");
}, 30000);

it("restarts loading from a running 128K ROM context and rewinds the mounted tape", () => {
  const m = createMachine({ rom: firmware });
  for (let load = 0; load < 2; load++) {
    m.loadTape(basicTape(), "again.tap");
    expect(m.mcu.latch).toBe(0);
    // Let the reset run even though the previous load left the marker in RAM.
    for (let i = 0; i < 180; i++) m.advanceFrame();
    expect(m.tape.status).toBe("Block 2/2 loaded; end of tape.");
    expect(m.memory.read(0x8000)).toBe(42);
  }
}, 30000);

it("cancels pending menu selection on user input or reset without releasing user keys", () => {
  const m = createMachine({ rom: firmware });
  m.loadTape(basicTape(), "cancel.tap");
  // Simulate the verified ROM0 menu polling event and its emulated frame delay.
  m.tape.read(0x3683, true, m.cpu);
  for (let i = 0; i < 8; i++) m.tape.frame();
  expect(m.keyboard.isPressed("ENTER")).toBe(true);
  m.keyboard.press("host:test", "X");
  expect(m.keyboard.isPressed("ENTER")).toBe(false);
  expect(m.keyboard.isPressed("X")).toBe(true);
  expect(m.tape.status).toContain("cancelled");
  m.setReset(true);
  m.setReset(false);
  expect(m.keyboard.isPressed("X")).toBe(true);
  expect(m.keyboard.isPressed("ENTER")).toBe(false);
});

it("requires the recognized 128K menu and a supported ROM1 before auto-loading", () => {
  const unknown = firmware.slice();
  unknown[0x2744] ^= 1;
  const m = createMachine({ rom: unknown });
  expect(m.tape.canMount).toBe(false);
  expect(() => m.loadTape(basicTape(), "unsupported.tap")).toThrow(
    "not supported",
  );
  expect(m.cpu.bus.nRESET).toBe(1);
});
