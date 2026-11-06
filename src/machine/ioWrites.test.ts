import { describe, expect, it, vi } from "vitest";
import { createMachine, type Machine } from "./machine";

function fixture(program: number[], cpu7 = false, expanded = false) {
  const rom = new Uint8Array(expanded ? 32768 : 16384);
  rom.set(program);
  const writes: { address: number; value: number; slot: number }[] = [];
  const machine: Machine = createMachine({
    rom,
    cpu7,
    devices: [
      {
        id: "io-recorder",
        io: [
          {
            lowMask: 0,
            lowValue: 0,
            write: (address, value) => {
              writes.push({ address, value, slot: machine.framePosition });
            },
          },
        ],
      },
    ],
  });
  return { machine, writes };
}

for (const cpu7 of [false, true]) {
  describe(`I/O write edges (turbo=${cpu7})`, () => {
    it("commits identical immediate OUTs once each, 11 CPU clocks apart", () => {
      const { machine, writes } = fixture(
        [0x3e, 0x17, 0xd3, 0xfe, 0xd3, 0xfe, 0xd3, 0xfe, 0x76],
        cpu7,
      );
      machine.advancePixels(200);
      expect(writes.map(({ address, value }) => [address, value])).toEqual([
        [0x17fe, 0x17],
        [0x17fe, 0x17],
        [0x17fe, 0x17],
      ]);
      expect(writes[1].slot - writes[0].slot).toBe(cpu7 ? 11 : 22);
      expect(writes[2].slot - writes[1].slot).toBe(cpu7 ? 11 : 22);
      expect(machine.border.value).toBe(0x17);
    });

    it("commits OUT (C),A to the MCU once per instruction", () => {
      const { machine, writes } = fixture(
        [0x01, 0xfd, 0x7f, 0x3e, 0x0b, 0xed, 0x79, 0xed, 0x79, 0x76],
        cpu7,
        true,
      );
      const paging = vi.spyOn(machine.mcu, "write");
      machine.advancePixels(250);
      expect(writes.map(({ address, value }) => [address, value])).toEqual([
        [0x7ffd, 0x0b],
        [0x7ffd, 0x0b],
      ]);
      expect(paging).toHaveBeenCalledTimes(2);
      expect(machine.mcu.latch).toBe(0x0b);
    });

    it.each([
      { name: "OUTI", op: 0xa3, decrement: false, repeat: false },
      { name: "OTIR", op: 0xb3, decrement: false, repeat: true },
      { name: "OUTD", op: 0xab, decrement: true, repeat: false },
      { name: "OTDR", op: 0xbb, decrement: true, repeat: true },
    ])("commits each $name transfer once", ({ op, decrement, repeat }) => {
      const { machine, writes } = fixture(
        [
          0x21,
          decrement ? 1 : 0,
          0x80, // HL
          0x01,
          0xfd,
          2, // BC
          0xed,
          op,
          ...(repeat ? [] : [0xed, op]),
          0x76,
        ],
        cpu7,
      );
      machine.memory.write(0x8000, 0x35);
      machine.memory.write(0x8001, 0x35);
      machine.advancePixels(400);
      expect(writes.map(({ address, value }) => [address, value])).toEqual([
        [0x01fd, 0x35],
        [0x00fd, 0x35],
      ]);
      expect(machine.cpu.bus.nHALT).toBe(0);
    });

    it("does not repeat a write through WAIT, then accepts the next strobe", () => {
      const { machine, writes } = fixture(
        [0x3e, 7, 0xd3, 0xfe, 0xd3, 0xfe, 0x76],
        cpu7,
      );
      for (let i = 0; writes.length === 0 && i < 200; i++)
        machine.advancePixels(1);
      expect(writes).toHaveLength(1);
      machine.cpu.bus.nWAIT = 0;
      machine.advancePixels(100);
      expect(machine.cpu.bus.nWR).toBe(0);
      expect(writes).toHaveLength(1);
      machine.cpu.bus.nWAIT = 1;
      machine.advancePixels(200);
      expect(writes).toHaveLength(2);
    });
  });
}

it("preserves writes across turbo changes and execution chunk boundaries", () => {
  const { machine, writes } = fixture([0x3e, 1, 0xd3, 0xfe, 0xc3, 2, 0]);
  const original = machine.cpu.clockEdge.bind(machine.cpu);
  let assertions = 0;
  machine.cpu.clockEdge = () => {
    const before = machine.cpu.bus.nWR;
    original();
    if (
      before === 1 &&
      machine.cpu.bus.nWR === 0 &&
      machine.cpu.bus.nIORQ === 0
    )
      assertions++;
  };
  for (const turbo of [true, false, true, false]) {
    machine.setTurbo(turbo);
    for (let i = 0; i < 180; i++) machine.advancePixels(1);
    expect(machine.cpu7).toBe(turbo);
  }
  expect(writes.length).toBeGreaterThan(10);
  expect(writes).toHaveLength(assertions);
  expect(new Set(writes.map((w) => w.slot)).size).toBe(writes.length);
});

it("commits at the last frame slot and never replays a held strobe next frame", () => {
  const { machine, writes } = fixture([]);
  machine.cpu.clockEdge = () => {};
  machine.advancePixels(machine.videoPreset.pixelsPerFrame - 1);
  Object.assign(machine.cpu.bus, { nWR: 1, nIORQ: 1, nM1: 1 });
  machine.cpu.clockEdge = () => {
    Object.assign(machine.cpu.bus, {
      nWR: 0,
      nIORQ: 0,
      addr: 0x17fe,
      data: 0x17,
    });
  };
  machine.advancePixels(1);
  expect(writes).toEqual([
    {
      address: 0x17fe,
      value: 0x17,
      slot: machine.videoPreset.pixelsPerFrame - 1,
    },
  ]);
  // The final CPU edge is after border sampling; the new latch starts next slot.
  expect(machine.video.completed.border.at(-1)).toBe(0);
  machine.advanceFrame();
  expect(writes).toHaveLength(1);
  expect(machine.video.completed.border[0]).toBe(7);
});

it.each([0, 1])(
  "keeps turbo border sampling between its two edges (write edge=%s)",
  (writeEdge) => {
    const { machine, writes } = fixture([], true);
    Object.assign(machine.cpu.bus, { nWR: 1, nIORQ: 1, nM1: 1 });
    let edge = 0;
    machine.cpu.clockEdge = () => {
      if (edge++ === writeEdge)
        Object.assign(machine.cpu.bus, {
          nWR: 0,
          nIORQ: 0,
          addr: 0xfe,
          data: 7,
        });
    };
    machine.advanceFrame();
    expect(writes).toEqual([{ address: 0xfe, value: 7, slot: 0 }]);
    expect(machine.video.completed.border[0]).toBe(writeEdge === 0 ? 7 : 0);
    expect(machine.video.completed.border[1]).toBe(7);
  },
);

it.each([
  { name: "memory write", pins: { nIORQ: 1, nMREQ: 0 } },
  { name: "interrupt acknowledge", pins: { nM1: 0 } },
  { name: "bus grant", pins: { nBUSACK: 0 } },
  { name: "undefined address", pins: { addr: undefined } },
  { name: "undefined data", pins: { data: undefined } },
  { name: "undefined IORQ", pins: { nIORQ: undefined } },
] as const)("ignores $name on a falling write strobe", ({ pins }) => {
  const { machine, writes } = fixture([]);
  Object.assign(machine.cpu.bus, { nWR: 1, nIORQ: 1, nM1: 1 });
  machine.cpu.clockEdge = () => {
    Object.assign(machine.cpu.bus, {
      nWR: 0,
      nIORQ: 0,
      addr: 0xfe,
      data: 7,
      ...pins,
    });
  };
  machine.advancePixels(5);
  expect(writes).toHaveLength(0);
});

it("does not treat undefined-to-low or an already-low strobe as a falling edge", () => {
  for (const nWR of [undefined, 0] as const) {
    const { machine, writes } = fixture([]);
    Object.assign(machine.cpu.bus, {
      nWR,
      nIORQ: 0,
      nM1: 1,
      addr: 0xfe,
      data: 7,
    });
    machine.cpu.clockEdge = () => {
      machine.cpu.bus.nWR = 0;
    };
    machine.advancePixels(10);
    expect(writes).toHaveLength(0);
  }
});

it("suppresses strobes through a held reset and the final stretched reset edge", () => {
  const { machine, writes } = fixture([]);
  let edge = 0;
  machine.cpu.clockEdge = () => {
    Object.assign(machine.cpu.bus, {
      nWR: edge++ % 2 === 0 ? 1 : 0,
      nIORQ: edge % 2 === 1 ? 1 : 0,
      nM1: 1,
      addr: 0xfe,
      data: 7,
    });
  };
  machine.setReset(true);
  machine.advancePixels(20);
  expect(writes).toHaveLength(0);
  machine.setReset(false);
  machine.setReset(true);
  machine.setReset(false);
  machine.advancePixels(6);
  expect(writes).toHaveLength(0);
  expect(machine.cpu.bus.nRESET).toBe(1);
  machine.advancePixels(2);
  expect(writes).toHaveLength(1);
});
