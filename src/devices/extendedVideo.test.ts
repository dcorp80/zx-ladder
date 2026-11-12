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
