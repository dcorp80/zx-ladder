import { expect, it } from "vitest";
import {
  LVIV_VIDEO_PRESET,
  PENTAGON_VIDEO_PRESET,
} from "../devices/videoPresets";
import { createMachine } from "../machine/machine";
import { PcmQueue } from "./pcmQueue";
import { BeeperResampler } from "./resampler";

it("integrates short pulses and ignores unrelated FE bits", () => {
  const resampler = new BeeperResampler(2);
  expect([
    ...resampler.convert(new Uint8Array([0x17, 0xef, 0xff, 0x10]), 4),
  ]).toEqual([0, 0.5]);
});
it("preserves fractional samples across frames of either geometry", () => {
  for (const preset of [PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET]) {
    const r = new BeeperResampler(44100);
    let total = 0;
    for (let frame = 0; frame < 100; frame++)
      total += r.convert(
        new Uint8Array(preset.pixelsPerFrame).fill(16),
        7000000,
      ).length;
    expect(total).toBe(
      Math.floor((preset.pixelsPerFrame * 100 * 44100) / 7000000),
    );
  }
});
it("produces identical PCM regardless of capture boundaries", () => {
  const input = Uint8Array.from({ length: 10003 }, (_, i) =>
    i % 19 < 7 ? 16 : 0,
  );
  const whole = new BeeperResampler(48000).convert(input, 7000000);
  const r = new BeeperResampler(48000);
  const chunks = [
    r.convert(input.subarray(0, 178), 7000000),
    r.convert(input.subarray(178, 6733), 7000000),
    r.convert(input.subarray(6733), 7000000),
  ];
  expect(chunks.flatMap((c) => [...c])).toEqual([...whole]);
});
it("bounds the playback backlog and fades to silence on underrun/reset", () => {
  const q = new PcmQueue(1000);
  q.push(new Float32Array(100).fill(0.5));
  q.push(new Float32Array(100).fill(-0.5));
  expect(q.queued).toBe(100);
  const output = new Float32Array(300);
  q.render(output);
  expect(output[0]).toBe(-0.5);
  expect(output[299]).toBe(0);
  q.push(new Float32Array(100).fill(0.5));
  q.render(new Float32Array(1));
  q.reset();
  q.render(output);
  expect(q.queued).toBe(0);
  expect(output[299]).toBe(0);
});
it("captures CPU FE writes across the full raster and delivers every frame", () => {
  const rom = new Uint8Array(16384);
  rom.set([0x3e, 0x17, 0xd3, 0xfe, 0x76]); // LD A,17; OUT (FE),A; HALT
  const m = createMachine({ rom });
  const captures: Uint8Array[] = [];
  m.setAudioSink((latch, hz) => {
    expect(hz).toBe(7000000);
    captures.push(latch.slice());
  });
  m.advanceFrame();
  m.advanceFrame();
  expect(captures).toHaveLength(2);
  expect(captures[1].length).toBe(m.width * m.height);
  expect(captures[1].every((value) => value === 0x17)).toBe(true);
  const colored = m.renderFrame(true).slice();
  m.border.value = 7;
  m.advanceFrame();
  expect(m.renderFrame(true)).toEqual(colored);
});
