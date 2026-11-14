import { expect, it } from "vitest";
import { createMachine } from "../machine/machine";
import { TimedVideo } from "./video";
import { LVIV_VIDEO_PRESET, PENTAGON_VIDEO_PRESET } from "./videoPresets";

it.each([PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET])(
  "wires extended addresses from $id border signals",
  (preset) => {
    const video = new TimedVideo(preset);
    video.extendedMode = true;
    for (let s = 0; s < video.pixelAddresses.length; s++) {
      const h = video.hPositions[(s * 8) % preset.width];
      const v = video.vPositions[s];
      const [start, end] = preset.hBorder;
      const hb = start < end ? h >= start && h < end : h >= start || h < end;
      const vb = v >= preset.vPaperEnd;
      const high = (hb ? 0 : 0x2000) | (vb ? 0x4000 : 0);
      const reads: number[] = [];
      video.cpuAccess();
      const bus = {
        readMemory: (a: number) => {
          reads.push(a);
          return 0;
        },
      };
      video.fetch(bus, s);
      video.fetch(bus, s);
      expect(reads).toEqual([
        (video.pixelAddresses[s] & 0x1fff) | high,
        (video.attributeAddresses[s] & (vb ? 0x17ff : 0x1fff)) | high,
      ]);
    }
  },
);

it.each([16384, 32768])(
  "decodes EFF7 with RTC disabled and resets in %i-byte ROM machines",
  (size) => {
    const m = createMachine({ rom: new Uint8Array(size), rtcEnabled: false });
    m.bus.writeIo(0xeff7, 0xc0);
    expect(m.extendedMode).toBe(true);
    m.memory.ramPages[4][0] = 0x34;
    m.memory.ramPages[5][0] = 0x56;
    expect(m.memory.readExtendedScreen(0x4000)).toBe(0x34);
    expect(m.memory.readExtendedScreen(0)).toBe(0x56);
    m.setVideoPreset(LVIV_VIDEO_PRESET);
    expect(m.extendedMode).toBe(true);
    m.setReset(true);
    expect(m.extendedMode).toBe(false);
  },
);

it("retains captured border suppression after a later mode change", () => {
  const video = new TimedVideo(PENTAGON_VIDEO_PRESET);
  const c = video.masks.indexOf(1);
  expect(c).toBeGreaterThanOrEqual(0);
  video.extendedMode = true;
  video.pixelFetch = 255;
  video.attributeFetch = 2;
  video.captureSymbol(c >>> 3, 0);
  video.captureBorder(c, 1);
  video.finishFrame();
  video.extendedMode = false;
  expect(Array.from(video.render(true).slice(c * 4, c * 4 + 4))).toEqual([
    215, 0, 0, 255,
  ]);
});

it.each([PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET])(
  "delays combined border across line/frame boundaries in $id",
  (preset) => {
    const video = new TimedVideo(preset);
    const raw = (position: number) => {
      const x = position % preset.width;
      const y = Math.floor(position / preset.width);
      const h = video.hPositions[x];
      const v =
        (preset.vOrigin +
          y +
          (video.advanceX > 0 && x >= video.advanceX ? 1 : 0)) %
        preset.height;
      const [a, b] = preset.hBorder;
      return (
        (a < b ? h >= a && h < b : h >= a || h < b) || v >= preset.vPaperEnd
      );
    };
    let shiftedVerticalTransitions = 0;
    for (let c = 0; c < preset.pixelsPerFrame; c++) {
      const source =
        (c - preset.borderShift * 2 + preset.pixelsPerFrame) %
        preset.pixelsPerFrame;
      expect(!!(video.masks[c] & 1)).toBe(raw(source));
      if (raw(c) !== raw(source)) shiftedVerticalTransitions++;
    }
    expect(shiftedVerticalTransitions).toBeGreaterThan(0);
    const undelayed = new TimedVideo({ ...preset, borderShift: 0 });
    for (let c = 0; c < preset.pixelsPerFrame; c++)
      expect(video.masks[c] & 6).toBe(undelayed.masks[c] & 6);
  },
);

it("fetches the intended Pentagon bytes at both horizontal joins", () => {
  const video = new TimedVideo(PENTAGON_VIDEO_PRESET);
  video.extendedMode = true;
  for (const [h, offset] of [
    [124, 0x001f],
    [128, 0x2000],
    [132, 0x2001],
    [252, 0x201f],
    [32, 0x0008],
    [36, 0x0009],
  ]) {
    const s = video.vPositions.findIndex(
      (v, i) => v === 0 && video.hPositions[(i * 8) % 448] === h,
    );
    expect(s).toBeGreaterThanOrEqual(0);
    video.cpuAccess();
    let address = -1;
    video.fetch(
      {
        readMemory: (a) => {
          address = a;
          return 0;
        },
      },
      s,
    );
    expect(address).toBe(offset);
  }
});

it("uses the latest checkbox or EFF7 bit change", () => {
  const m = createMachine({ rom: new Uint8Array(16384) });
  m.setExtendedMode(true);
  expect(m.extendedMode).toBe(true);
  m.bus.writeIo(0xeff7, 0);
  expect(m.extendedMode).toBe(false);
  m.bus.writeIo(0xeff7, 64);
  expect(m.extendedMode).toBe(true);
  m.setExtendedMode(false);
  expect(m.extendedMode).toBe(false);
  m.setExtendedMode(true);
  m.setVideoPreset(LVIV_VIDEO_PRESET);
  expect(m.extendedMode).toBe(true);
  m.setReset(true);
  expect(m.extendedMode).toBe(false);
});

for (const preset of [PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET]) {
  it.each(["guest EFF7", "host control", "direct assignment"])(
    `applies %s between pixel and attribute fetches in ${preset.id}`,
    (source) => {
      const machine = createMachine({
        rom: new Uint8Array(16384),
        videoPreset: preset,
      });
      const video = machine.video as TimedVideo;
      const symbol = video.vPositions.findIndex(
        (v, index) =>
          v === 0 && video.hPositions[(index * 8) % preset.width] === 128,
      );
      expect(symbol).toBeGreaterThanOrEqual(0);
      const extendedPixel = preset.id === "pentagon" ? 0x2000 : 0;
      const reads: number[] = [];
      const bus = {
        readMemory: (address: number) => {
          reads.push(address);
          return reads.length;
        },
      };
      const changeMode = (enabled: boolean) => {
        if (source === "guest EFF7")
          machine.bus.writeIo(0xeff7, enabled ? 64 : 0);
        else if (source === "host control") machine.setExtendedMode(enabled);
        else video.extendedMode = enabled;
      };

      video.fetch(bus, symbol);
      changeMode(true);
      video.fetch(bus, symbol);
      video.fetch(bus, symbol);
      changeMode(false);
      video.fetch(bus, symbol);
      expect(reads).toEqual([
        0x4000,
        extendedPixel | 0x1800,
        extendedPixel,
        0x5800,
      ]);
      expect(video.pixelFetch).toBe(3);
      expect(video.attributeFetch).toBe(4);
    },
  );
}

it.each([PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET])(
  "switches from a 48K bus interceptor to physical extended reads within one chunk in $id",
  (preset) => {
    const reads: number[] = [];
    const machine = createMachine({
      rom: new Uint8Array(16384),
      cpu7: true,
      videoPreset: preset,
      devices: [
        {
          id: "mode-switching-screen-read",
          memoryInterceptors: [
            {
              start: 0x4000,
              end: 0x7fff,
              read: (address) => {
                reads.push(address);
                if (reads.length === 1) {
                  machine.bus.writeIo(0xeff7, 64);
                  return 0xa1;
                }
                return 0xc3;
              },
            },
          ],
        },
      ],
    });
    const video = machine.video as TimedVideo;
    machine.cpu.clockEdge = () => {};
    machine.memory.ramPages[4].fill(0xb2);
    machine.memory.ramPages[5].fill(0xd4);

    machine.advancePixels(2);
    expect(machine.extendedMode).toBe(true);
    expect(reads).toEqual([video.pixelAddresses[0]]);
    expect(video.pixelFetch).toBe(0xa1);
    expect(video.attributeFetch).toBe(0xb2);
    machine.advancePixels(1);
    expect(video.pixelFetch).toBe(0xb2);

    machine.setExtendedMode(false);
    machine.advancePixels(1);
    expect(reads).toEqual([
      video.pixelAddresses[0],
      video.attributeAddresses[0],
    ]);
    expect(video.attributeFetch).toBe(0xc3);
  },
);
