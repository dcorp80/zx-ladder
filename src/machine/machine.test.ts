import { describe, expect, it, vi } from "vitest";
import { BorderDevice } from "../devices/border";
import { BankedMemory } from "../devices/memory";
import {
  attributeAddress,
  captureAttribute,
  pixelAddress,
  TimedVideo,
} from "../devices/video";
import {
  LVIV_VIDEO_PRESET,
  PENTAGON_VIDEO_PRESET,
} from "../devices/videoPresets";
import { Counter } from "./counters";
import { DeviceBus } from "./devices";
import { createMachine } from "./machine";

const rom = (...bytes: number[]) => {
  const r = new Uint8Array(16384);
  r.set(bytes);
  return r;
};

it("maps four independent plain banks and protects ROM", () => {
  const m = new BankedMemory(rom(0x76));
  expect(m.banks.every((b) => Array.isArray(b) && b.length === 16384)).toBe(
    true,
  );
  for (const a of [0x4000, 0x7fff, 0x8000, 0xbfff, 0xc000, 0xffff]) {
    expect(m.read(a)).toBe(255);
    m.write(a, a & 255);
    expect(m.read(a)).toBe(a & 255);
  }
  m.write(0, 123);
  expect(m.read(0)).toBe(0x76);
  expect(() => new BankedMemory(new Uint8Array(32768))).toThrow("16 KiB");
});

it("decodes low-byte aliases then optional upper address and rejects read conflicts", () => {
  const border = new BorderDevice();
  const write = vi.fn();
  const bus = new DeviceBus([
    border,
    {
      id: "test",
      io: [
        {
          lowMask: 255,
          lowValue: 0xff,
          highMask: 255,
          highValue: 0x12,
          read: () => 42,
          write,
        },
      ],
    },
  ]);
  bus.writeIo(0x12fc, 6);
  expect(border.color).toBe(6);
  bus.writeIo(0x13ff, 5);
  expect(write).not.toHaveBeenCalled();
  bus.writeIo(0x12ff, 5);
  expect(write).toHaveBeenCalledWith(0x12ff, 5);
  expect(bus.readIo(0x12ff)).toBe(42);
  expect(bus.readIo(0x13ff)).toBe(255);
  expect(
    () =>
      new DeviceBus([
        {
          id: "a",
          io: [
            { lowMask: 0, lowValue: 0, read: () => 1 },
            { lowMask: 1, lowValue: 0, read: () => 2 },
          ],
        },
      ]),
  ).toThrow("Overlapping");
});

it.each([false, true])(
  "executes real CPU RAM/IO instructions (turbo=%s)",
  (cpu7) => {
    const m = createMachine({
      cpu7,
      rom: rom(
        0x3e,
        42,
        0x32,
        0,
        0x80,
        0x3e,
        0,
        0x3a,
        0,
        0x80,
        0xd3,
        0xfe,
        0x76,
      ),
    });
    m.advancePixels(200);
    expect(m.memory.read(0x8000)).toBe(42);
    expect(m.cpu.snapshot().main.a).toBe(42);
    expect(m.border.color).toBe(2);
    expect(m.cpu.bus.nHALT).toBe(0);
    expect(m.counters[Counter.cpuEdges]).toBe(cpu7 ? 400 : 200);
  },
);

it("services a held MREQ only once, including across a frame boundary", () => {
  const m = createMachine({ rom: rom() });
  m.cpu.clockEdge = () => {};
  m.advancePixels(m.videoPreset.pixelsPerFrame - 1);
  const read = vi.spyOn(m.memory, "read");
  Object.assign(m.cpu.bus, { nMREQ: 0, nRD: 0, nRFSH: 1, addr: 0x8000 });
  m.advancePixels(1);
  m.advancePixels(10);
  expect(read.mock.calls.filter(([a]) => a === 0x8000)).toHaveLength(1);
  expect(m.frameCount).toBe(1);
  expect(m.framePosition).toBe(10);
});

it("uses a 448-pixel INT pulse at the mapped V=240 edge, clearing early on acknowledge", () => {
  const m = createMachine({ rom: rom() });
  m.cpu.clockEdge = () => {};
  const start = 314 * 448 - 8;
  m.advancePixels(start);
  expect(m.cpu.bus.nINT).toBe(1);
  m.advancePixels(1);
  expect(m.cpu.bus.nINT).toBe(0);
  expect(m.counters[Counter.flash]).toBe(1);
  Object.assign(m.cpu.bus, { nIORQ: 0, nM1: 0 });
  m.advancePixels(1);
  expect(m.cpu.bus.nINT).toBe(1);
  expect(m.cpu.bus.data).toBe(255);
  Object.assign(m.cpu.bus, { nIORQ: 1, nM1: 1 });
  m.advancePixels(100);
  expect(m.cpu.bus.nINT).toBe(1);
  const full = createMachine({ rom: rom() });
  full.cpu.clockEdge = () => {};
  full.advancePixels(start + 448);
  full.advancePixels(1);
  expect(full.cpu.bus.nINT).toBe(1);
});

it("keeps chunked folded loops identical to uninterrupted frames", () => {
  const image = rom(0x21, 0, 0x80, 0x34, 0xc3, 3, 0);
  const a = createMachine({ rom: image, cpu7: true });
  const b = createMachine({ rom: image, cpu7: true });
  const count = a.videoPreset.pixelsPerFrame * 2 + 11;
  a.advancePixels(count);
  let remaining = count;
  for (const chunk of [1, 7, 1, 439, 1024, 20, 491]) {
    b.advancePixels(chunk);
    remaining -= chunk;
  }
  while (remaining) {
    const n = Math.min(997, remaining);
    b.advancePixels(n);
    remaining -= n;
  }
  expect(b.cpu.snapshot()).toEqual(a.cpu.snapshot());
  expect(b.memory.banks).toEqual(a.memory.banks);
  expect(b.counters).toEqual(a.counters);
  expect(b.video.completed).toEqual(a.video.completed);
});

describe("video sampling", () => {
  it("uses the last fetches from slots 0–7 for the next group, including outside paper", () => {
    const memory = new BankedMemory(rom());
    const bus = new DeviceBus([memory]);
    const v = new TimedVideo(PENTAGON_VIDEO_PRESET);
    memory.write(v.pixelAddresses[0], 0x81);
    memory.write(v.attributeAddresses[0], 0xc7);
    v.captureSymbol(0, 0);
    for (let i = 0; i < 8; i++) v.fetch(bus, 0);
    // Later memory edits do not change fetched values.
    memory.write(v.pixelAddresses[0], 0);
    memory.write(v.attributeAddresses[0], 0);
    v.captureSymbol(1, 16);
    v.finishFrame();
    expect(v.completed.pixels[0]).toBe(0);
    expect(v.completed.pixels[1]).toBe(0x81);
    expect(v.completed.attributes[1]).toBe(0xc7);
    expect(captureAttribute(0xc7, 0)).toBe(0x47);
    expect(captureAttribute(0xc7, 16)).toBe(0xc7);
  });
  it("restarts pixel fetch after CPU ownership and retains an unfetched attribute", () => {
    const memory = new BankedMemory(rom());
    const bus = new DeviceBus([memory]);
    const v = new TimedVideo(PENTAGON_VIDEO_PRESET);
    memory.write(v.pixelAddresses[0], 0xaa);
    v.attributeFetch = 0x47;
    v.fetch(bus, 0); // next would be attr
    v.cpuAccess();
    memory.write(v.pixelAddresses[0], 0x55);
    v.fetch(bus, 0);
    expect(v.pixelFetch).toBe(0x55);
    expect(v.attributeFetch).toBe(0x47);
  });
  it("maps physical counters and screen addresses without clamping off-screen reads", () => {
    const v = new TimedVideo(PENTAGON_VIDEO_PRESET);
    expect(v.hPositions[0]).toBe(68);
    expect(v.hPositions[376]).toBe(32);
    expect(v.hPositions[440]).toBe(64);
    expect(v.vPositions[55]).toBe(247);
    expect(pixelAddress(0, 0)).toBe(0x4000);
    expect(pixelAddress(1, 0)).toBe(0x4100);
    expect(pixelAddress(8, 0)).toBe(0x4020);
    expect(pixelAddress(64, 31)).toBe(0x481f);
    expect(attributeAddress(191, 31)).toBe(0x5aff);
    // H=128 captures column 0 before H=132 starts paper.
    expect(v.pixelAddresses[(74 * 448 + 120) >>> 3]).toBe(0x4000);
  });
  it("retains per-pixel border changes independently of the live latch", () => {
    const v = new TimedVideo(PENTAGON_VIDEO_PRESET);
    const pos = 20 * 448 + 80; // visible top border, outside blank/sync
    v.captureBorder(pos, 2);
    v.captureBorder(pos + 1, 4);
    v.finishFrame();
    const rgba = v.render();
    expect(Array.from(rgba.slice(pos * 4, pos * 4 + 8))).toEqual([
      215, 0, 0, 255, 0, 215, 0, 255,
    ]);
  });
});

it.each([false, true])(
  "holds a reset tap for six CPU half-cycles (turbo=%s)",
  (cpu7) => {
    const m = createMachine({ rom: rom(), cpu7 });
    const levels: (number | undefined)[] = [];
    m.cpu.clockEdge = () => {
      levels.push(m.cpu.bus.nRESET);
    };
    m.setReset(true);
    m.setReset(false);
    expect(m.cpu.bus.nRESET).toBe(0);
    m.advancePixels(cpu7 ? 3 : 6);
    expect(levels).toEqual([0, 0, 0, 0, 0, 0]);
    expect(m.cpu.bus.nRESET).toBe(1);
    m.advancePixels(1);
    expect(levels.slice(6).every((level) => level === 1)).toBe(true);
  },
);

it("keeps video and RAM alive during held reset and resumes CPU execution", () => {
  const m = createMachine({ rom: rom(0x76) });
  m.advancePixels(100);
  m.memory.write(0x8000, 42);
  m.setReset(true);
  m.advanceFrame();
  expect(m.cpu.bus.nRESET).toBe(0);
  expect(m.frameCount).toBe(1);
  expect(m.hasFrame).toBe(true);
  expect(m.memory.read(0x8000)).toBe(42);
  m.setReset(false);
  expect(m.cpu.bus.nRESET).toBe(1);
  m.advancePixels(100);
  expect(m.cpu.bus.nHALT).toBe(0);
});

describe("Lviv video on the same machine", () => {
  it("maps sync origin, wrapped border, and one-symbol fetch delay", () => {
    const video = new TimedVideo(LVIV_VIDEO_PRESET);
    expect(video.advanceX).toBe(0);
    expect(video.hPositions[0]).toBe(160);
    expect(video.hPositions[128]).toBe(0);
    expect(video.hPositions[136]).toBe(4);
    expect(video.vPositions[0]).toBe(244);
    expect(video.vPositions[56]).toBe(245);
    const paper = 68 * 448 + 136;
    expect(video.vPositions[paper >>> 3]).toBe(0);
    expect(video.pixelAddresses[(paper - 8) >>> 3]).toBe(0x4000);
    expect(video.masks[paper - 1] & 1).toBe(1);
    expect(video.masks[paper] & 1).toBe(0);
    expect(video.masks[paper + 255] & 1).toBe(0);
    expect(video.masks[paper + 256] & 1).toBe(1);
    expect(video.masks[0] & 4).toBe(4);
    expect(video.masks[4 * 448 + 80] & 4).toBe(0);
    expect(video.masks[20 * 448 + 79] & 2).toBe(2);
    expect(video.masks[20 * 448 + 80] & 2).toBe(0);
  });

  it("generates early INT at 248 separately from FLASH at 240 with bit 4", () => {
    const m = createMachine({
      rom: rom(),
      videoPreset: LVIV_VIDEO_PRESET,
      lateInt: false,
    });
    m.cpu.clockEdge = () => {};
    m.advancePixels(4 * 448);
    expect(m.cpu.bus.nINT).toBe(1);
    m.advancePixels(1);
    expect(m.cpu.bus.nINT).toBe(0);
    expect(m.counters[Counter.flash]).toBe(0);
    m.advancePixels(448);
    expect(m.cpu.bus.nINT).toBe(1);
    m.advancePixels(308 * 448 - m.framePosition);
    expect(m.counters[Counter.flash]).toBe(0);
    m.advancePixels(1);
    expect(m.counters[Counter.flash]).toBe(1);
    expect(m.cpu.bus.nINT).toBe(1);
    const video = new TimedVideo(LVIV_VIDEO_PRESET);
    video.attributeFetch = 0xc7;
    video.captureSymbol(0, 16);
    video.captureSymbol(1, 32);
    video.finishFrame();
    expect(video.completed.attributes[0]).toBe(0xc7);
    expect(video.completed.attributes[1]).toBe(0x47);
    expect(m.timing.frameHz).toBeCloseTo(50.080128205);
  });

  it("switches raster without replacing CPU, RAM, border, turbo or accumulated clocks", () => {
    const m = createMachine({ rom: rom(0x76), cpu7: true });
    m.advancePixels(99);
    m.memory.write(0x8000, 42);
    m.border.color = 5;
    const cpu = m.cpu,
      memory = m.memory,
      snapshot = m.cpu.snapshot();
    const clocks = m.counters[Counter.cpuEdges];
    m.setVideoPreset(LVIV_VIDEO_PRESET);
    expect(m.cpu).toBe(cpu);
    expect(m.cpu.snapshot()).toEqual(snapshot);
    expect(m.memory).toBe(memory);
    expect(m.memory.read(0x8000)).toBe(42);
    expect(m.border.color).toBe(5);
    expect(m.cpu7).toBe(true);
    expect(m.timing.pixelHz).toBe(7_000_000);
    expect(m.framePosition).toBe(0);
    m.advanceFrame();
    expect(m.counters[Counter.cpuEdges] - clocks).toBe(2 * 448 * 312);
    expect(m.renderFrame().length).toBe(448 * 312 * 4);
    expect(m.cpu.bus.nHALT).toBe(0);
    m.setVideoPreset(PENTAGON_VIDEO_PRESET);
    m.advanceFrame();
    expect(m.renderFrame().length).toBe(448 * 320 * 4);
  });
});

it.each([false, true])(
  "latches live turbo only on nM1 deassertion (initial turbo=%s)",
  (initial) => {
    const m = createMachine({ rom: rom(), cpu7: initial });
    m.cpu.clockEdge = () => {};
    m.setTurbo(!initial);
    m.advancePixels(10); // M1 is high: its level alone must not switch speed.
    expect(m.cpu7).toBe(initial);
    m.cpu.bus.nM1 = 0;
    m.advancePixels(10);
    expect(m.cpu7).toBe(initial);
    const before = m.counters[Counter.cpuEdges];
    m.cpu.clockEdge = () => {
      m.cpu.bus.nM1 = 1;
    };
    m.advancePixels(1);
    expect(m.cpu7).toBe(!initial);
    expect(m.counters[Counter.cpuEdges] - before).toBe(initial ? 2 : 1);
    m.advancePixels(10);
    expect(m.counters[Counter.cpuEdges] - before).toBe(
      (initial ? 2 : 1) + (initial ? 10 : 20),
    );
    expect(m.counters[Counter.pixels]).toBe(31);
  },
);

it("honours the latest turbo request and keeps a real CPU running through both transitions", () => {
  const m = createMachine({ rom: rom(0x21, 0, 0x80, 0x34, 0xc3, 3, 0) });
  m.advancePixels(100);
  m.setTurbo(true);
  m.setTurbo(false);
  m.advancePixels(100);
  expect(m.cpu7).toBe(false);
  m.setTurbo(true);
  m.advancePixels(100);
  expect(m.cpu7).toBe(true);
  const first = m.memory.read(0x8000);
  m.setTurbo(false);
  m.advancePixels(100);
  expect(m.cpu7).toBe(false);
  expect(m.memory.read(0x8000)).not.toBe(first);
  expect(m.timing.pixelHz).toBe(7_000_000);
});

it.each([
  {
    preset: PENTAGON_VIDEO_PRESET,
    late: false,
    position: 313 * 448 + 440,
    h: 64,
    v: 240,
  },
  {
    preset: PENTAGON_VIDEO_PRESET,
    late: true,
    position: 316 * 448 + 88,
    h: 112,
    v: 242,
  },
  { preset: LVIV_VIDEO_PRESET, late: false, position: 4 * 448, h: 160, v: 248 },
  { preset: LVIV_VIDEO_PRESET, late: true, position: 68 * 448, h: 160, v: 0 },
])(
  "asserts INT on the selected edge: $preset.id late=$late",
  ({ preset, late, position, h, v }) => {
    const m = createMachine({ rom: rom(), videoPreset: preset, lateInt: late });
    m.cpu.clockEdge = () => {};
    m.advancePixels(position);
    expect(m.cpu.bus.nINT).toBe(1);
    m.advancePixels(1);
    expect(m.cpu.bus.nINT).toBe(0);
    expect(m.counters[Counter.h]).toBe(h);
    expect(m.counters[Counter.v]).toBe(v);
    m.advancePixels(447);
    expect(m.cpu.bus.nINT).toBe(0);
    m.advancePixels(1);
    expect(m.cpu.bus.nINT).toBe(1);
  },
);
it("acknowledges a late interrupt without reasserting on the second pixel", () => {
  const m = createMachine({ rom: rom(), lateInt: true });
  m.cpu.clockEdge = () => {};
  m.advancePixels(316 * 448 + 88);
  m.cpu.bus.nIORQ = 0;
  m.cpu.bus.nM1 = 0;
  m.advancePixels(1);
  expect(m.cpu.bus.nINT).toBe(1);
  m.cpu.bus.nIORQ = 1;
  m.cpu.bus.nM1 = 1;
  m.advancePixels(448);
  expect(m.cpu.bus.nINT).toBe(1);
});
it("changes INT timing live without resetting CPU or RAM", () => {
  const m = createMachine({ rom: rom() });
  m.cpu.clockEdge = () => {};
  m.advancePixels(100);
  m.memory.write(0x8000, 42);
  const cpu = m.cpu;
  m.setLateInt(true);
  expect(m.framePosition).toBe(100);
  expect(m.cpu).toBe(cpu);
  expect(m.memory.read(0x8000)).toBe(42);
  m.advancePixels(316 * 448 + 88 - 100);
  expect(m.cpu.bus.nINT).toBe(1);
  m.advancePixels(1);
  expect(m.cpu.bus.nINT).toBe(0);
});

it.each([
  { preset: PENTAGON_VIDEO_PRESET, start: 314 * 448 - 8 },
  { preset: LVIV_VIDEO_PRESET, start: 4 * 448 },
])(
  "draws actual INT duration across raster lines for $preset.id",
  ({ preset, start }) => {
    const m = createMachine({ rom: rom(), videoPreset: preset });
    m.cpu.clockEdge = () => {};
    m.advanceFrame();
    const capture = m.video.completed.interrupt;
    expect(capture.reduce((sum, v) => sum + v, 0)).toBe(448);
    expect(capture[start - 1]).toBe(0);
    expect(capture[start]).toBe(1);
    expect(capture[start + 447]).toBe(1);
    expect(capture[start + 448]).toBe(0);
    for (const showBorder of [true, false]) {
      const rgba = m.renderFrame(showBorder);
      expect([...rgba.slice(start * 4, start * 4 + 4)]).toEqual([
        255, 96, 0, 255,
      ]);
    }
    m.advancePixels(start + 12);
    Object.assign(m.cpu.bus, { nIORQ: 0, nM1: 0 });
    m.advancePixels(1);
    Object.assign(m.cpu.bus, { nIORQ: 1, nM1: 1 });
    m.advanceFrame();
    expect(m.video.completed.interrupt.reduce((sum, v) => sum + v, 0)).toBe(12);
    expect(m.video.completed.interrupt[start + 11]).toBe(1);
    expect(m.video.completed.interrupt[start + 12]).toBe(0);
    // Reused back buffers cannot retain the longer pulse from two frames ago.
    m.advancePixels(start);
    Object.assign(m.cpu.bus, { nIORQ: 0, nM1: 0 });
    m.advanceFrame();
    expect(m.video.completed.interrupt.some(Boolean)).toBe(false);
  },
);
