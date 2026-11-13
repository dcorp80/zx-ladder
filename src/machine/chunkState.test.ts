import { expect, it, vi } from "vitest";
import { TimedVideo } from "../devices/video";
import type { VideoPreset } from "../devices/videoPresets";
import { CPU_LOAD_SAMPLE_FRAMES } from "./config";
import { Counter } from "./counters";
import type { ClockHook } from "./devices";
import { createMachine, type Machine } from "./machine";

const preset: VideoPreset = {
  id: "chunk-state",
  label: "Chunk state fixture",
  width: 8,
  height: 2,
  pixelsPerFrame: 16,
  hReload: 0,
  hLimit: 4,
  hOrigin: 0,
  vOrigin: 0,
  vAdvance: 0,
  borderShift: 0,
  hBorder: [0, 2],
  hBlank: [2, 3],
  hSync: [3, 4],
  vPaperEnd: 1,
  vBlank: [1, 2],
  vSync: [1, 2],
  interruptLine: 0,
  lateInterruptLine: 0,
  lateInterruptH: 0,
  defaultLateInt: false,
  flashLine: 0,
  flashBit: 0,
};

function state(machine: Machine) {
  return {
    position: machine.framePosition,
    counters: Array.from(machine.counters),
  };
}

function expectedState(tick: number, completed = false) {
  const position = tick % 16;
  const sampled = completed ? (position + 15) % 16 : position;
  return {
    position,
    counters: [
      tick * 2,
      Math.floor((tick - Number(completed)) / 16),
      Math.floor((tick - Number(completed)) / 16) + 1,
      (sampled % 8) >>> 1,
      sampled >>> 3,
    ],
  };
}

it("publishes live counters to injected clocks across chunks and frame rollover", () => {
  const observed: ReturnType<typeof state>[] = [];
  const machine = createMachine({
    rom: new Uint8Array(16384),
    cpu7: true,
    videoPreset: preset,
    devices: [
      {
        id: "clock-observer",
        clock: [
          {
            divider: 3,
            phase: 1,
            tick: () => observed.push(state(machine)),
          },
        ],
      },
    ],
  });
  machine.cpu.clockEdge = () => {};
  for (const count of [1, 7, 9, 2, 16]) machine.advancePixels(count);
  expect(observed).toEqual(
    Array.from({ length: 12 }, (_, index) => expectedState(1 + index * 3)),
  );
  expect(machine.takeElapsedTicks()).toBe(35);
  expect(machine.frameCount).toBe(2);
  expect(machine.framePosition).toBe(3);
  expect(machine.counters[Counter.h]).toBe(1);
  expect(machine.counters[Counter.v]).toBe(0);
});

it("keeps public audio sinks at the completed slot before returning a chunk", () => {
  const machine = createMachine({
    rom: new Uint8Array(32768),
    cpu7: true,
    videoPreset: preset,
  });
  machine.cpu.clockEdge = () => {};
  const fe: ReturnType<typeof state>[] = [];
  const ay: ReturnType<typeof state>[] = [];
  const pcm: ReturnType<typeof state>[] = [];
  machine.border.setSink((batch) => {
    expect(batch.origin + batch.duration).toBe((fe.length + 1) * 16);
    fe.push(state(machine));
  });
  machine.ay?.setSink((batch) => {
    expect(batch.origin + batch.duration).toBe((ay.length + 1) * 16);
    ay.push(state(machine));
  });
  machine.setPcmSink(() => pcm.push(state(machine)));
  machine.advancePixels(16 * 12 + 3);
  const expected = Array.from({ length: 12 }, (_, index) =>
    expectedState((index + 1) * 16, true),
  );
  expect(fe).toEqual(expected);
  expect(ay).toEqual(expected);
  expect(pcm).toEqual([expectedState(160, true)]);
  expect(machine.framePosition).toBe(3);
  expect(machine.counters[Counter.cpuEdges]).toBe(390);
});

it("retains nonzero FE and AY timestamps across execution chunks", () => {
  const machine = createMachine({
    rom: new Uint8Array(32768),
    cpu7: true,
    videoPreset: preset,
  });
  machine.cpu.clockEdge = () => {};
  machine.advancePixels(5);
  Object.assign(machine.cpu.bus, { nIORQ: 1, nWR: 1, nRD: 1, nM1: 1 });
  let edge = 0;
  machine.cpu.clockEdge = () => {
    const current = edge++;
    Object.assign(machine.cpu.bus, { nIORQ: 1, nWR: 1 });
    if (current === 0 || current === 2 || current === 5)
      Object.assign(machine.cpu.bus, {
        nIORQ: 0,
        nWR: 0,
        addr: current === 2 ? 0xbffd : 0xfe,
        data: 7,
      });
  };
  machine.advancePixels(3);
  expect(
    machine.border.batch.time.slice(0, machine.border.batch.count),
  ).toEqual([5, 8]);
  expect(machine.ay?.batch.time.slice(0, machine.ay.batch.count)).toEqual([6]);
  expect(machine.takeElapsedTicks()).toBe(8);
});

it("preserves partial-slot state when the late CPU edge throws", () => {
  const machine = createMachine({
    rom: new Uint8Array(16384),
    cpu7: true,
    videoPreset: preset,
  });
  Object.assign(machine.cpu.bus, {
    nMREQ: 1,
    nRD: 1,
    nRFSH: 1,
    nHALT: 1,
    addr: 0x8000,
    data: 42,
  });
  const writes = vi.spyOn(machine.bus, "writeMemory");
  const interrupts = vi.spyOn(machine.video, "captureInterrupt");
  const failure = new Error("late edge");
  let edge = 0;
  machine.cpu.clockEdge = () => {
    edge++;
    if (edge === 4) machine.cpu.bus.nMREQ = 0;
    if (edge === 5) machine.cpu.bus.nHALT = 0;
    if (edge === 6) throw failure;
  };
  expect(() => machine.advancePixels(10)).toThrow(failure);
  expect(machine.takeElapsedTicks()).toBe(2);
  expect(machine.framePosition).toBe(2);
  expect(machine.counters[Counter.cpuEdges]).toBe(5);
  expect(writes).toHaveBeenCalledExactlyOnceWith(0x8000, 42);
  expect(interrupts).toHaveBeenCalledExactlyOnceWith(0, true);

  machine.cpu.clockEdge = () => {};
  machine.cpu.bus.nHALT = 1;
  machine.advancePixels(1);
  expect(writes).toHaveBeenCalledTimes(1);
  expect(interrupts).toHaveBeenCalledTimes(1);
  const window = preset.pixelsPerFrame * CPU_LOAD_SAMPLE_FRAMES;
  machine.advancePixels(window - 3);
  expect(machine.takeElapsedTicks()).toBe(window - 2);
  // The pre-edge HALT sample already happened in the interrupted slot.
  expect(machine.cpuLoad).toBe(100 * (1 - 1 / window));
});

it("retries INT capture when its callback throws before committing the sample", () => {
  const machine = createMachine({
    rom: new Uint8Array(16384),
    cpu7: true,
    videoPreset: preset,
  });
  machine.cpu.clockEdge = () => {};
  const failure = new Error("INT capture");
  const capture = vi
    .spyOn(machine.video, "captureInterrupt")
    .mockImplementationOnce(() => {
      throw failure;
    });
  expect(() => machine.advancePixels(3)).toThrow(failure);
  expect(machine.framePosition).toBe(0);
  expect(machine.takeElapsedTicks()).toBe(0);
  machine.advancePixels(1);
  expect(capture.mock.calls).toEqual([
    [0, true],
    [0, true],
  ]);
  expect(machine.takeElapsedTicks()).toBe(1);
});

it("honors a custom TimedVideo clock phase instead of the default symbol clock", () => {
  const observed: ReturnType<typeof state>[] = [];
  class CustomClockVideo extends TimedVideo {
    override readonly clock: readonly ClockHook[] = [
      {
        divider: 4,
        phase: 2,
        tick: () => observed.push(state(machine)),
      },
    ];
  }
  const machine = createMachine({
    rom: new Uint8Array(16384),
    cpu7: true,
    videoPreset: preset,
    videoFactory: (videoPreset) => new CustomClockVideo(videoPreset),
  });
  machine.cpu.clockEdge = () => {};
  for (const count of [1, 5, 3, 7]) machine.advancePixels(count);
  expect(observed).toEqual([2, 6, 10, 14].map((tick) => expectedState(tick)));
});

it("matches continuous and fragmented clocks across frame and preset boundaries", () => {
  const options = {
    rom: new Uint8Array(16384),
    cpu7: true,
    videoPreset: preset,
  };
  const standard = createMachine(options);
  const fragmented = createMachine(options);
  const injected = createMachine({
    ...options,
    videoFactory: (videoPreset) => new TimedVideo(videoPreset),
  });
  const machines = [standard, fragmented, injected];
  for (const machine of machines) {
    machine.cpu.clockEdge = () => {};
    machine.memory.ramPages[5].fill(0x87);
  }
  const compare = () => {
    for (const machine of [fragmented, injected]) {
      expect(state(machine)).toEqual(state(standard));
      expect(machine.video.completed).toEqual(standard.video.completed);
      expect(machine.renderFrame()).toEqual(standard.renderFrame());
    }
  };
  standard.advancePixels(35);
  for (const count of [1, 7, 9, 2, 16]) {
    fragmented.advancePixels(count);
    injected.advancePixels(count);
  }
  compare();

  // Replace the video three slots into a symbol. The replacement clock starts
  // at phase zero rather than inheriting the old clock's five remaining ticks.
  const samples = machines.map((machine) => {
    expect(machine.framePosition).toBe(3);
    machine.setVideoPreset({ ...preset, id: "replacement", vOrigin: 1 });
    const video = machine.video as TimedVideo;
    const captureSymbol = video.captureSymbol.bind(video);
    const positions: number[] = [];
    vi.spyOn(video, "captureSymbol").mockImplementation((index, flash) => {
      positions.push(machine.framePosition);
      captureSymbol(index, flash);
    });
    return positions;
  });
  standard.advanceFrame();
  for (const count of [1, 2, 5, 7, 1]) {
    fragmented.advancePixels(count);
    injected.advancePixels(count);
  }
  expect(samples).toEqual([
    [0, 8],
    [0, 8],
    [0, 8],
  ]);
  compare();
});

it("retains the clock countdown after retrying a partially executed slot", () => {
  const run = (injected: boolean) => {
    const machine = createMachine({
      rom: new Uint8Array(16384),
      cpu7: true,
      videoPreset: preset,
      videoFactory: injected ? (p) => new TimedVideo(p) : undefined,
    });
    const video = machine.video as TimedVideo;
    const captureSymbol = video.captureSymbol.bind(video);
    const positions: number[] = [];
    vi.spyOn(video, "captureSymbol").mockImplementation((index, flash) => {
      positions.push(machine.framePosition);
      captureSymbol(index, flash);
    });
    const failure = new Error("late edge after clock tick");
    let edge = 0;
    machine.cpu.clockEdge = () => {
      if (++edge === 6) throw failure;
    };
    expect(() => machine.advancePixels(10)).toThrow(failure);
    expect(machine.framePosition).toBe(2);
    machine.cpu.clockEdge = () => {};
    machine.advancePixels(14);
    return { positions, frame: video.completed, state: state(machine) };
  };
  const standard = run(false);
  const injected = run(true);
  // The failed slot consumed a clock tick before its CPU edge threw. Retrying
  // that slot consumes another tick, so subsequent samples shift one slot.
  expect(standard.positions).toEqual([0, 7, 15]);
  expect(standard).toEqual(injected);
});

it("retries a throwing video clock before advancing its countdown", () => {
  const run = (injected: boolean) => {
    const machine = createMachine({
      rom: new Uint8Array(16384),
      cpu7: true,
      videoPreset: preset,
      videoFactory: injected ? (p) => new TimedVideo(p) : undefined,
    });
    machine.cpu.clockEdge = () => {};
    const video = machine.video as TimedVideo;
    const captureSymbol = video.captureSymbol.bind(video);
    const failure = new Error("video clock tick");
    const positions: number[] = [];
    vi.spyOn(video, "captureSymbol").mockImplementation((index, flash) => {
      positions.push(machine.framePosition);
      if (positions.length === 1) throw failure;
      captureSymbol(index, flash);
    });
    expect(() => machine.advancePixels(3)).toThrow(failure);
    expect(machine.framePosition).toBe(0);
    expect(machine.takeElapsedTicks()).toBe(0);
    machine.advanceFrame();
    return { positions, frame: video.completed, state: state(machine) };
  };
  const standard = run(false);
  const injected = run(true);
  expect(standard.positions).toEqual([0, 0, 8]);
  expect(standard).toEqual(injected);
});
