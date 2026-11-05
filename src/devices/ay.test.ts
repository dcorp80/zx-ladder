import { expect, it } from "vitest";
import { DeviceBus } from "../machine/devices";
import { createMachine } from "../machine/machine";
import {
  AY_CLOCK_HZ,
  AY_EVENT_CAPACITY,
  AY_MAX_BATCH_TICKS,
  type AyBatch,
  AyDevice,
} from "./ay";
import { LVIV_VIDEO_PRESET, PENTAGON_VIDEO_PRESET } from "./videoPresets";

function fixture() {
  let tick = 0;
  const ay = new AyDevice(() => tick);
  const bus = new DeviceBus([ay]);
  return {
    ay,
    bus,
    at: (t: number) => {
      tick = t;
    },
  };
}
function copy(batch: AyBatch) {
  return {
    origin: batch.origin,
    duration: batch.duration,
    time: batch.time.slice(0, batch.count),
    reg: batch.reg.slice(0, batch.count),
    value: batch.value.slice(0, batch.count),
    resets: batch.resetIntervals.map((pair) => [...pair]),
    startsInReset: batch.startsInReset,
    endsInReset: batch.endsInReset,
  };
}
function machine(cpu7 = false) {
  const rom = new Uint8Array(32768);
  rom[0] = 0x76;
  return createMachine({ rom, cpu7 });
}

it("decodes exact FFFD/BFFD, reads immediately and retains repeated envelope writes", () => {
  const { ay, bus, at } = fixture();
  bus.writeIo(0xfffd, 13);
  at(10);
  bus.writeIo(0xbffd, 0xf9);
  expect(bus.readIo(0xfffd)).toBe(9);
  at(20);
  bus.writeIo(0xbffd, 9);
  bus.writeIo(0x00fd, 3);
  bus.writeIo(0x7ffd, 4);
  expect(bus.readIo(0xbffd)).toBe(255);
  expect(bus.readIo(0x00fd)).toBe(255);
  expect(ay.batch.count).toBe(2);
  expect(ay.batch.time.slice(0, 2)).toEqual([10, 20]);
  expect(ay.batch.reg.slice(0, 2)).toEqual([13, 13]);
  expect(ay.batch.value.slice(0, 2)).toEqual([9, 9]);
});

it("applies every register mask to both readback and captured writes", () => {
  const { ay } = fixture();
  const masks = [255, 15, 255, 15, 255, 15, 31, 255, 31, 31, 31, 255, 255, 15];
  for (let r = 0; r < masks.length; r++) {
    ay.select(r);
    ay.write(255);
    expect(ay.read()).toBe(masks[r]);
    expect(ay.batch.reg[r]).toBe(r);
    expect(ay.batch.value[r]).toBe(masks[r]);
  }
});

it("retains the address latch on invalid selection and models unconnected port A", () => {
  const { ay } = fixture();
  ay.select(8);
  ay.select(0x18);
  ay.write(10);
  expect(ay.selectedRegister).toBe(8);
  expect(ay.read()).toBe(10);
  ay.select(14);
  ay.write(0x35);
  expect(ay.read()).toBe(255); // R7 bit 6 clear: input, pulled high.
  ay.select(7);
  ay.write(0x40);
  ay.select(14);
  expect(ay.read()).toBe(0x35);
  ay.select(15);
  const count = ay.batch.count;
  ay.write(123);
  expect(ay.read()).toBe(255);
  expect(ay.batch.count).toBe(count);
});

it("reuses ordinary arrays and the batch object, including empty-time batches", () => {
  const { ay, at } = fixture();
  const batch = ay.batch;
  const arrays = [batch.time, batch.reg, batch.value];
  expect(arrays.every(Array.isArray)).toBe(true);
  expect(Array.isArray(ay.registers)).toBe(true);
  expect(arrays.map((a) => a.length)).toEqual([
    AY_EVENT_CAPACITY,
    AY_EVENT_CAPACITY,
    AY_EVENT_CAPACITY,
  ]);
  const received: ReturnType<typeof copy>[] = [];
  ay.setSink((b) => {
    expect(b).toBe(batch);
    received.push(copy(b));
  });
  at(2);
  ay.write(3);
  at(12);
  ay.flush();
  at(15);
  ay.flush();
  at(16);
  ay.write(4);
  at(20);
  ay.flush();
  expect(received.map((b) => [b.origin, b.duration, b.time, b.value])).toEqual([
    [0, 12, [2], [3]],
    [12, 3, [], []],
    [15, 5, [1], [4]],
  ]);
  expect(ay.batch).toBe(batch);
  expect(ay.batch.time).toBe(arrays[0]);
  expect(ay.batch.reg).toBe(arrays[1]);
  expect(ay.batch.value).toBe(arrays[2]);
  expect(ay.read()).toBe(4);
});

it("bounds capture without growing arrays or altering live state on overflow", () => {
  const { ay, at } = fixture();
  for (let i = 0; i < AY_EVENT_CAPACITY; i++) {
    at(i * 4);
    ay.write(1);
  }
  expect(() => ay.write(2)).toThrow("AY event buffer overflow");
  expect(ay.batch.count).toBe(AY_EVENT_CAPACITY);
  expect(ay.batch.time).toHaveLength(AY_EVENT_CAPACITY);
  expect(ay.read()).toBe(1);
});

it("preserves all reset intervals, clears readback immediately and ignores held-reset writes", () => {
  const { ay, at } = fixture();
  const batches: ReturnType<typeof copy>[] = [];
  ay.setSink((b) => batches.push(copy(b)));
  ay.select(13);
  ay.write(9);
  at(2);
  ay.setReset(true);
  expect(ay.selectedRegister).toBe(0);
  expect(ay.registers.every((v) => v === 0)).toBe(true);
  ay.select(13);
  ay.write(9);
  ay.setReset(true);
  at(4);
  ay.setReset(false);
  at(5);
  ay.setReset(true);
  ay.setReset(false);
  at(8);
  ay.setReset(true);
  at(10);
  ay.flush();
  at(20);
  ay.flush();
  at(23);
  ay.setReset(false);
  ay.write(7);
  at(25);
  ay.flush();
  expect(
    batches.map((b) => [b.resets, b.startsInReset, b.endsInReset]),
  ).toEqual([
    [
      [
        [2, 4],
        [5, 5],
        [8, 10],
      ],
      false,
      true,
    ],
    [[[0, 10]], true, true],
    [[[0, 3]], true, false],
  ]);
  expect(batches.map((b) => b.value)).toEqual([[9], [], [7]]);
  expect(batches[2].time).toEqual([3]);
});

it.each([false, true])(
  "captures real CPU AY writes and immediate IN readback (turbo=%s)",
  (cpu7) => {
    const rom = new Uint8Array(32768);
    rom.set([
      0x01,
      0xfd,
      0xff,
      0x3e,
      13,
      0xed,
      0x79, // Select R13.
      0x06,
      0xbf,
      0x3e,
      9,
      0xed,
      0x79,
      0xed,
      0x79, // Two identical data writes.
      0x06,
      0xff,
      0xed,
      0x78,
      0x32,
      0,
      0x80,
      0x76, // IN A,(C); save readback.
    ]);
    const m = createMachine({ rom, cpu7 });
    m.advancePixels(400);
    expect(m.memory.read(0x8000)).toBe(9);
    expect(m.ay?.batch.count).toBe(2);
    expect(m.ay?.batch.reg.slice(0, 2)).toEqual([13, 13]);
    expect(m.ay?.batch.value.slice(0, 2)).toEqual([9, 9]);
    expect(m.ay?.clockHz).toBe(AY_CLOCK_HZ);
  },
);

it("fits a full turbo frame of shortest OUT instructions without allocating event arrays", () => {
  const rom = new Uint8Array(32768);
  rom.set([0x3e, 0xbf, 0xc3, 0, 0x40]);
  const m = createMachine({ rom, cpu7: true });
  for (let addr = 0x4000; addr < 0x10000; addr += 2) {
    m.memory.write(addr, 0xd3);
    m.memory.write(addr + 1, 0xfd);
  }
  const array = m.ay?.batch.time;
  let count = 0;
  m.ay?.setSink((b) => {
    count = b.count;
    expect(b.time).toBe(array);
    for (let i = 1; i < b.count; i++)
      expect(b.time[i] - b.time[i - 1]).toBe(11);
  });
  m.advanceFrame();
  expect(count).toBeGreaterThan(13000);
  expect(count).toBeLessThan(AY_EVENT_CAPACITY);
  expect(m.ay?.batch.count).toBe(0);
  expect(m.ay?.batch.time).toBe(array);
});

it("keeps AY and absolute time across raster changes, flushing partial batches", () => {
  const m = machine();
  const ay = m.ay;
  if (!ay) throw new Error("Expected AY on a 128K machine");
  const batches: ReturnType<typeof copy>[] = [];
  ay.setSink((b) => batches.push(copy(b)));
  m.advancePixels(10);
  m.bus.writeIo(0xbffd, 1);
  m.setVideoPreset(LVIV_VIDEO_PRESET);
  expect(m.ay).toBe(ay);
  m.advancePixels(5);
  m.takeElapsedTicks(); // Reporting must not rebase event time.
  m.bus.writeIo(0xbffd, 2);
  m.setVideoPreset(PENTAGON_VIDEO_PRESET);
  expect(batches.map((b) => [b.origin, b.duration, b.time, b.value])).toEqual([
    [0, 10, [10], [1]],
    [10, 5, [5], [2]],
  ]);
  expect(m.bus.readIo(0xfffd)).toBe(2);
});

it.each([false, true])(
  "tracks the stretched machine reset and cross-frame hold (turbo=%s)",
  (cpu7) => {
    const m = machine(cpu7);
    const batches: ReturnType<typeof copy>[] = [];
    m.ay?.setSink((b) => batches.push(copy(b)));
    m.advancePixels(10);
    m.setReset(true);
    m.setReset(false);
    m.advancePixels(cpu7 ? 3 : 6);
    expect(m.ay?.inReset).toBe(false);
    expect(m.ay?.batch.resetIntervals).toEqual([[10, cpu7 ? 12 : 15]]);
    m.setReset(true);
    m.advanceFrame();
    m.advancePixels(8);
    m.setReset(false);
    m.setVideoPreset(LVIV_VIDEO_PRESET);
    expect(batches[0].endsInReset).toBe(true);
    expect(batches[1].startsInReset).toBe(true);
    expect(batches[1].resets).toEqual([[0, 8]]);
    expect(batches[1].endsInReset).toBe(false);
  },
);

it("bounds batches for custom frames longer than the standard presets", () => {
  const preset = {
    ...PENTAGON_VIDEO_PRESET,
    height: 640,
    pixelsPerFrame: 448 * 640,
  };
  const m = createMachine({ rom: new Uint8Array(32768), videoPreset: preset });
  const durations: number[] = [];
  m.ay?.setSink((b) => durations.push(b.duration));
  m.advanceFrame();
  expect(durations).toEqual([AY_MAX_BATCH_TICKS, AY_MAX_BATCH_TICKS]);
});

it("keeps AY absent on 48K machines and preserves the explicit broad-FD collision", () => {
  const m48 = createMachine({ rom: new Uint8Array(16384) });
  expect(m48.ay).toBeUndefined();
  expect(m48.bus.readIo(0xfffd)).toBe(255);
  const m = machine();
  m.setDecodeFd(true);
  m.bus.writeIo(0xfffd, 13);
  expect(m.mcu.latch).toBe(13);
  expect(m.ay?.selectedRegister).toBe(13);
});
