import { expect, it } from "vitest";
import { createMachine } from "./machine";

it.each([false, true])(
  "latches each IN/INIR once on IORQ; holds data through WAIT (turbo=%s)",
  (cpu7) => {
    const rom = new Uint8Array(16384);
    // IN A,(DF); LD (9000),A; LD BC,02DF; LD HL,9001; INIR; HALT
    rom.set([
      0xdb, 0xdf, 0x32, 0, 0x90, 0x01, 0xdf, 2, 0x21, 1, 0x90, 0xed, 0xb2, 0x76,
    ]);
    let reads = 0;
    const m = createMachine({
      rom,
      cpu7,
      devices: [
        {
          id: "fifo",
          io: [{ lowMask: 255, lowValue: 0xdf, read: () => ++reads }],
        },
      ],
    });
    while (!reads) m.advancePixels(1);
    m.cpu.bus.nWAIT = 0;
    m.advancePixels(90);
    expect(reads).toBe(1);
    expect(m.cpu.bus.data).toBe(1);
    m.cpu.bus.nWAIT = 1;
    m.advancePixels(500);
    expect(reads).toBe(3);
    expect([0, 1, 2].map((i) => m.memory.read(0x9000 + i))).toEqual([1, 2, 3]);
  },
);
it("does not dispatch when RD/WR falls within an already held IORQ", () => {
  const m = createMachine({ rom: new Uint8Array(16384) });
  Object.assign(m.cpu.bus, { nIORQ: 0, nRD: 1, nWR: 1, addr: 0xfe, data: 7 });
  m.cpu.clockEdge = () => {
    m.cpu.bus.nWR = 0;
  };
  m.advancePixels(10);
  expect(m.border.value).toBe(0);
});
