import { expect, it } from "vitest";
import { createMachine } from "../machine/machine";
import { TAPE_ROM_SIGNATURE } from "./spectrum48Tape";

function fixture(loading = true, length = 3) {
  const rom = new Uint8Array(16384);
  rom.set(TAPE_ROM_SIGNATURE, 0x53f);
  rom.set([0xfd, 0xcb, 0x02, 0x5e], 0x10a8);
  // Initialize through CPU instructions, call ROM, store flags, stop.
  rom.set([
    0x31,
    0x00,
    0xff,
    0xdd,
    0x21,
    0x00,
    0x80,
    0x11,
    length,
    0,
    0x3e,
    255,
    loading ? 0x37 : 0xb7,
    0xcd,
    0x56,
    0x05,
    0xf5,
    0xe1,
    0x22,
    0x00,
    0x90,
    0x76,
  ]);
  return rom;
}
const bytes = new Uint8Array([5, 0, 255, 1, 2, 3, 255]);
it.each([false, true])(
  "flashes through real bus cycles and CPU return, turbo=%s",
  (cpu7) => {
    const machine = createMachine({ rom: fixture(), cpu7 });
    machine.loadTape(bytes, "test.tap");
    machine.advancePixels(10000);
    expect([0, 1, 2].map((i) => machine.memory.read(0x8000 + i))).toEqual([
      1, 2, 3,
    ]);
    const state = machine.cpu.snapshot();
    expect(state.ix).toBe(0x8003);
    expect(state.main.d * 256 + state.main.e).toBe(0);
    expect(state.sp).toBe(0xff00);
    expect(machine.memory.read(0x9000) & 1).toBe(1);
    expect(state.iff1).toBe(true);
    expect(machine.memory.read(0x56c)).toBe(0xcd);
  },
);
it("VERIFY compares RAM without changing it and returns failure", () => {
  const m = createMachine({ rom: fixture(false) });
  m.memory.write(0x8000, 1);
  m.memory.write(0x8001, 9);
  m.loadTape(bytes, "verify.tap");
  m.advancePixels(10000);
  expect(m.memory.read(0x8001)).toBe(9);
  expect(m.memory.read(0x9000) & 1).toBe(0);
  expect(m.cpu.snapshot().ix).toBe(0x8001);
  expect(m.tape.status).toContain("VERIFY mismatch");
});
it("short blocks fail with remainder and preserve warm RAM", () => {
  const m = createMachine({ rom: fixture(true, 4) });
  m.memory.write(0xa000, 42);
  m.loadTape(bytes, "short.tap");
  m.advancePixels(10000);
  expect(m.memory.read(0x9000) & 1).toBe(0);
  expect(m.cpu.snapshot().main.e).toBe(1);
  expect(m.memory.read(0xa000)).toBe(42);
});
it("rejects an unknown ROM before resetting", () => {
  const m = createMachine({ rom: new Uint8Array(16384) });
  expect(() => m.loadTape(bytes, "test.tap")).toThrow("not supported");
  expect(m.cpu.bus.nRESET).toBe(1);
});

it.each(["checksum", "flag", "long"])(
  "returns failure for %s errors",
  (kind) => {
    const m = createMachine({ rom: fixture() });
    const data = bytes.slice();
    if (kind === "checksum") data[data.length - 1] ^= 1;
    if (kind === "flag") {
      data[2] = 0;
      data[data.length - 1] = 0;
    }
    const image =
      kind === "long" ? new Uint8Array([6, 0, 255, 1, 2, 3, 4, 251]) : data;
    m.loadTape(image, "bad.tap");
    m.advancePixels(10000);
    expect(m.memory.read(0x9000) & 1).toBe(0);
    expect(m.cpu.snapshot().sp).toBe(0xff00);
    if (kind === "flag") expect(m.memory.read(0x8000)).toBe(255);
  },
);
it("returns failure at tape exhaustion", () => {
  const rom = fixture();
  rom.set(
    [0x3e, 255, 0x37, 0xcd, 0x56, 0x05, 0xf5, 0xe1, 0x22, 0, 0x90, 0x76],
    16,
  );
  const m = createMachine({ rom });
  m.loadTape(bytes, "one.tap");
  m.advancePixels(15000);
  expect(m.tape.status).toContain("End of tape");
  expect(m.memory.read(0x9000) & 1).toBe(0);
});
it("handles a zero-length request", () => {
  const m = createMachine({ rom: fixture(true, 0) });
  m.loadTape(new Uint8Array([2, 0, 255, 255]), "empty-block.tap");
  m.advancePixels(10000);
  expect(m.cpu.snapshot().ix).toBe(0x8000);
  expect(m.memory.read(0x9000) & 1).toBe(1);
});
it("cancels typing immediately without releasing user keys", () => {
  const m = createMachine({ rom: fixture() });
  m.loadTape(bytes, "keys.tap");
  m.tape.read(0x10a8, true, m.cpu);
  for (let i = 0; i < 8; i++) m.tape.frame();
  expect(m.keyboard.isPressed("J")).toBe(true);
  m.keyboard.press("host:test", "X");
  expect(m.keyboard.isPressed("J")).toBe(false);
  expect(m.keyboard.isPressed("X")).toBe(true);
  expect(m.tape.status).toContain("cancelled");
});

it.each([false, true])(
  "loads consecutive blocks through a custom RAM caller without ROM cleanup (turbo=%s)",
  (cpu7) => {
    const rom = fixture();
    rom.set([0x31, 0x00, 0xff, 0xc3, 0x00, 0x90]);
    const m = createMachine({ rom, cpu7 });
    // Custom loader supplies AF' and calls the inner ROM entry directly.
    // Its return address belongs to RAM, and interrupts must stay disabled.
    const caller = [
      0xf3, 0xdd, 0x21, 0x00, 0x80, 0x11, 3, 0, 0x3e, 255, 0x37, 0x08, 0xcd,
      0x6c, 0x05, 0xdd, 0x21, 0x03, 0x80, 0x11, 2, 0, 0x3e, 255, 0x37, 0x08,
      0xcd, 0x6c, 0x05, 0xf5, 0xe1, 0x22, 0x00, 0xa0, 0x76,
    ];
    caller.forEach((value, i) => {
      m.memory.write(0x9000 + i, value);
    });
    m.loadTape(new Uint8Array([...bytes, 4, 0, 255, 9, 8, 254]), "multi.tap");
    m.advancePixels(10000);
    expect(
      Array.from({ length: 5 }, (_, i) => m.memory.read(0x8000 + i)),
    ).toEqual([1, 2, 3, 9, 8]);
    expect(m.tape.status).toBe("Block 2/2 loaded; end of tape.");
    expect(m.cpu.snapshot().sp).toBe(0xff00);
    expect(m.cpu.snapshot().ix).toBe(0x8005);
    expect(m.cpu.snapshot().iff1).toBe(false);
    expect(m.memory.read(0xa000) & 1).toBe(1);
    expect(m.cpu.bus.nHALT).toBe(0);
  },
);

it.each([false, true])(
  "flash loads TZX data through the real CPU (turbo=%s)",
  (cpu7) => {
    const m = createMachine({ rom: fixture(), cpu7 });
    m.loadTape(
      new Uint8Array([
        90,
        88,
        84,
        97,
        112,
        101,
        33,
        26,
        1,
        20,
        0x10,
        0xe8,
        3,
        ...bytes,
      ]),
      "test.tzx",
    );
    m.advancePixels(10000);
    expect([0, 1, 2].map((i) => m.memory.read(0x8000 + i))).toEqual([1, 2, 3]);
    expect(m.cpu.snapshot().ix).toBe(0x8003);
    expect(m.cpu.snapshot().sp).toBe(0xff00);
    expect(m.memory.read(0x9000) & 1).toBe(1);
  },
);
it("rejects unsupported TZX before resetting the machine", () => {
  const m = createMachine({ rom: fixture() });
  expect(() =>
    m.loadTape(
      new Uint8Array([90, 88, 84, 97, 112, 101, 33, 26, 1, 20, 0x19]),
      "waveform.tzx",
    ),
  ).toThrow("pulse playback");
  expect(m.cpu.bus.nRESET).toBe(1);
});
