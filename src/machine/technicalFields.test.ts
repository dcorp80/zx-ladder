import { expect, it, vi } from "vitest";
import { renderCapturedFrame } from "../devices/frameRenderer";
import { TimedVideo } from "../devices/video";
import {
  LVIV_VIDEO_PRESET,
  PENTAGON_VIDEO_PRESET,
} from "../devices/videoPresets";
import { createMachine, type Machine } from "./machine";

function fixture(
  preset: typeof PENTAGON_VIDEO_PRESET,
  cpu7: boolean,
  size: number,
  compact: boolean,
) {
  const rom = new Uint8Array(size);
  for (let base = 0; base < size; base += 16384) rom.set([0xc3, 0, 0x80], base);
  const machine = createMachine({
    rom,
    cpu7,
    videoPreset: preset,
    showTechnicalFields: !compact,
  });
  for (const [page, bank] of machine.memory.ramPages.entries())
    for (let address = 0; address < bank.length; address++)
      bank[address] = ((address * 73) ^ (address >>> 3) ^ (page * 43)) & 255;
  // Change bitmap bytes, border, and the 128K screen selection while running.
  const program = [
    0x21, 0, 0x40, 0x34, 0x7e, 0xd3, 0xfe, 0xe6, 0x08, 0x01, 0xfd, 0x7f, 0xed,
    0x79, 0x23, 0x7c, 0xe6, 0x1f, 0xf6, 0x40, 0x67, 0xc3, 3, 0x80,
  ];
  program.forEach((value, index) => {
    machine.memory.write(0x8000 + index, value);
  });
  return machine;
}

function advance(machines: Machine[], count: number) {
  const chunks = [1, 7, 9, 127, 8192, 31, 509];
  let i = 0;
  while (count > 0) {
    const n = Math.min(count, chunks[i++ % chunks.length]);
    for (const machine of machines) machine.advancePixels(n);
    count -= n;
  }
}

function expectEquivalent(full: Machine, compact: Machine) {
  expect(compact.cpu.snapshot()).toEqual(full.cpu.snapshot());
  expect(compact.counters).toEqual(full.counters);
  expect(compact.memory.ramPages).toEqual(full.memory.ramPages);
  const reference = full.video as TimedVideo;
  const expected = renderCapturedFrame(
    reference.rawCompleted,
    reference.masks,
    new Uint8ClampedArray(full.videoPreset.pixelsPerFrame * 4),
    true,
    false,
  );
  // Compact mode forces the real border even if a direct caller asks otherwise.
  expect(compact.renderFrame(false)).toEqual(expected);
}

for (const preset of [PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET]) {
  for (const cpu7 of [false, true]) {
    it.each([16384, 32768])(
      `preserves visible output across mode changes in ${preset.id}, turbo=${cpu7}, ROM=%i`,
      (size) => {
        const full = fixture(preset, cpu7, size, false);
        const compact = fixture(preset, cpu7, size, true);
        const machines = [full, compact];
        const readFull = vi.spyOn(full.bus, "readMemory");
        const readCompact = vi.spyOn(compact.bus, "readMemory");
        advance(machines, preset.pixelsPerFrame * 2);
        expectEquivalent(full, compact);
        if (size === 16384)
          expect(readCompact.mock.calls.length).toBeLessThan(
            readFull.mock.calls.length * 0.6,
          );
        for (const enabled of [true, false]) {
          advance(machines, 37);
          for (const machine of machines)
            machine.bus.writeIo(0xeff7, enabled ? 64 : 0);
          advance(machines, preset.pixelsPerFrame * 2 - 37);
          expectEquivalent(full, compact);
        }
        compact.setVideoPreset(preset);
        expect(compact.showTechnicalFields).toBe(false);
        expect(compact.video.showTechnicalFields).toBe(false);
      },
    );
  }
}

it("advances skipped fetch phase and resumes generic reads immediately", () => {
  const video = new TimedVideo(PENTAGON_VIDEO_PRESET);
  const readMemory = vi.fn(() => 42);
  video.showTechnicalFields = false;
  video.captureSymbol(0, 0); // The frame opens in vertical sync/blanking.
  video.fetch({ readMemory }, 0);
  expect(readMemory).not.toHaveBeenCalled();
  expect(video.nextFetchIsPixel).toBe(false);
  video.cpuAccess();
  expect(video.nextFetchIsPixel).toBe(true);
  video.fetch({ readMemory }, 0);
  video.showTechnicalFields = true;
  video.fetch({ readMemory }, 0);
  expect(readMemory).toHaveBeenCalledExactlyOnceWith(
    video.attributeAddresses[0],
  );
  expect(video.nextFetchIsPixel).toBe(true);
});

it.each(["interceptor", "clock", "video factory"])(
  "keeps generic reads for an injected %s",
  (kind) => {
    const machine = createMachine({
      rom: new Uint8Array(16384),
      showTechnicalFields: false,
      ...(kind === "video factory"
        ? {
            videoFactory: (preset: typeof PENTAGON_VIDEO_PRESET) =>
              new TimedVideo(preset),
          }
        : {
            devices: [
              {
                id: "custom",
                ...(kind === "interceptor"
                  ? {
                      memoryInterceptors: [
                        { start: 0x4000, end: 0x5fff, read: () => undefined },
                      ],
                    }
                  : { clock: [{ divider: 3, phase: 0, tick: () => {} }] }),
              },
            ],
          }),
    });
    machine.cpu.clockEdge = () => {};
    const reads = vi.spyOn(machine.bus, "readMemory");
    machine.advancePixels(32);
    expect(reads).toHaveBeenCalledTimes(32);
    machine.setVideoPreset(LVIV_VIDEO_PRESET);
    machine.advancePixels(32);
    expect(reads).toHaveBeenCalledTimes(32); // Preset replacement rebuilds the bus.
    const newReads = vi.spyOn(machine.bus, "readMemory");
    machine.advancePixels(32);
    expect(newReads).toHaveBeenCalledTimes(32);
  },
);

it("restores full reads after a partial-slot failure until video rephasing", () => {
  const machine = createMachine({
    rom: new Uint8Array(16384),
    cpu7: true,
    showTechnicalFields: false,
  });
  machine.cpu.clockEdge = () => {};
  const reads = vi.spyOn(machine.bus, "readMemory");
  machine.advancePixels(8);
  expect(reads).not.toHaveBeenCalled();
  machine.cpu.clockEdge = () => {
    throw new Error("partial slot");
  };
  expect(() => machine.advancePixels(8)).toThrow("partial slot");
  machine.cpu.clockEdge = () => {};
  machine.advancePixels(32);
  expect(reads).toHaveBeenCalledTimes(32);
  // UI toggles cannot re-enable elision under a shifted capture phase.
  machine.setShowTechnicalFields(true);
  machine.setShowTechnicalFields(false);
  machine.advancePixels(8);
  expect(reads).toHaveBeenCalledTimes(40);
  machine.setVideoPreset(PENTAGON_VIDEO_PRESET);
  const rephasedReads = vi.spyOn(machine.bus, "readMemory");
  machine.advancePixels(32);
  expect(rephasedReads).not.toHaveBeenCalled();
});

it("preserves custom fetch overrides when changing collection settings", () => {
  class CustomVideo extends TimedVideo {
    override fetch(
      bus: { readMemory(address: number): number },
      symbol: number,
    ) {
      bus.readMemory(0x1234);
      super.fetch(bus, symbol);
    }
  }
  const video = new CustomVideo(PENTAGON_VIDEO_PRESET);
  const fetch = video.fetch;
  const readMemory = vi.fn((_address: number) => 42);
  for (const technical of [false, true, false]) {
    video.showTechnicalFields = technical;
    video.extendedMode = !technical;
    video.setReadSuppressionAllowed(technical);
    expect(video.fetch).toBe(fetch);
    video.captureSymbol(0, 0);
    video.fetch({ readMemory }, 0);
  }
  expect(readMemory).toHaveBeenCalledTimes(6);
  expect(
    readMemory.mock.calls.filter(([address]) => address === 0x1234),
  ).toHaveLength(3);
});
