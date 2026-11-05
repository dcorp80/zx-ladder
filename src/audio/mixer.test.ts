import { expect, it } from "vitest";
import {
  LVIV_VIDEO_PRESET,
  PENTAGON_VIDEO_PRESET,
} from "../devices/videoPresets";
import { createMachine } from "../machine/machine";
import { type AyStereo, DEFAULT_SOUND, SoundMixer } from "./mixer";
import { StereoQueue } from "./stereoQueue";

function routed(mode: AyStereo, channel: number, middle = 0.5) {
  const mixer = new SoundMixer(true);
  mixer.setSampleRate(8000);
  mixer.configure({
    ...DEFAULT_SOUND,
    beeperEnabled: false,
    ayVolume: 1,
    ayStereo: mode,
    ayMiddle: middle,
  });
  let left = 0,
    right = 0;
  mixer.setSink((samples, frames) => {
    left = samples[(frames - 1) * 2];
    right = samples[(frames - 1) * 2 + 1];
  });
  const on = new Array(128).fill(1),
    off = new Array(128).fill(0);
  const block = {
    a: channel === 0 ? on : off,
    b: channel === 1 ? on : off,
    c: channel === 2 ? on : off,
    count: 128,
    sampleRate: 8000,
  };
  const fe = new Uint8Array(112000);
  for (let i = 0; i < 15; i++) {
    mixer.captureAy(block);
    mixer.consume(fe, 0, fe.length);
  }
  return [left, right];
}
it.each([
  ["ABC", 0, 0.25, 0],
  ["ABC", 1, 0.125, 0.125],
  ["ABC", 2, 0, 0.25],
  ["ACB", 0, 0.25, 0],
  ["ACB", 1, 0, 0.25],
  ["ACB", 2, 0.125, 0.125],
  ["Mono", 0, 1 / 12, 1 / 12],
  ["Mono", 1, 1 / 12, 1 / 12],
  ["Mono", 2, 1 / 12, 1 / 12],
] as const)(
  "routes %s channel %i to both speakers",
  (mode, ch, left, right) => {
    const out = routed(mode, ch);
    expect(out[0]).toBeCloseTo(left, 6);
    expect(out[1]).toBeCloseTo(right, 6);
  },
);
it("changes middle contribution without changing outer channel gain", () => {
  expect(routed("ABC", 0, 0)[0]).toBeCloseTo(routed("ABC", 0, 1)[0], 6);
  expect(routed("ABC", 1, 0)[0]).toBeCloseTo(0, 6);
  expect(routed("ABC", 1, 1)[0]).toBeCloseTo(0.25, 6);
});
it("bounds peak output and reuses the same PCM buffer", () => {
  const m = new SoundMixer(true);
  m.setSampleRate(8000);
  m.configure({ ...DEFAULT_SOUND, beeperVolume: 1, ayVolume: 1, ayMiddle: 1 });
  const ones = new Array(128).fill(1);
  const fe = new Uint8Array(112000).fill(16);
  let reference: Float32Array | undefined;
  m.setSink((samples, count) => {
    reference ??= samples;
    expect(samples).toBe(reference);
    for (let i = 0; i < count * 2; i++)
      expect(Math.abs(samples[i])).toBeLessThanOrEqual(1);
  });
  for (let i = 0; i < 20; i++) {
    m.captureAy({ a: ones, b: ones, c: ones, count: 128, sampleRate: 8000 });
    m.consume(fe, 0, fe.length);
  }
});
it("keeps stereo channels synchronized through overflow, reset and underrun", () => {
  const q = new StereoQueue(1000);
  const samples = new Float32Array(200);
  for (let i = 0; i < 100; i++) {
    samples[i * 2] = 0.25;
    samples[i * 2 + 1] = -0.5;
  }
  q.push(samples, 100);
  q.push(samples, 100);
  expect(q.queued).toBe(100);
  const left = new Float32Array(300),
    right = new Float32Array(300);
  q.render(left, right);
  expect(left[0]).toBe(0.25);
  expect(right[0]).toBe(-0.5);
  for (let i = 0; i < 300; i++) expect(right[i]).toBe(-2 * left[i]);
  expect(left[299]).toBe(0);
  q.reset();
  expect(q.queued).toBe(0);
});
it.each([16384, 32768])(
  "keeps PCM sample counts coherent across partial frames and rate changes (ROM %i)",
  (size) => {
    const rom = new Uint8Array(size);
    rom[0] = 0x76;
    const m = createMachine({ rom });
    let samples = 0;
    m.setPcmSink((_pcm, frames) => {
      samples += frames;
    });
    m.advancePixels(1003);
    m.setVideoPreset(LVIV_VIDEO_PRESET);
    m.advanceFrame();
    expect(samples).toBe(
      Math.floor(((1003 + LVIV_VIDEO_PRESET.pixelsPerFrame) * 48000) / 7000000),
    );
    m.advancePixels(509);
    m.configureSound(DEFAULT_SOUND, 44100);
    samples = 0;
    m.advanceFrame();
    m.setVideoPreset(PENTAGON_VIDEO_PRESET);
    m.advanceFrame();
    expect(samples).toBe(
      Math.floor(
        ((LVIV_VIDEO_PRESET.pixelsPerFrame -
          509 +
          PENTAGON_VIDEO_PRESET.pixelsPerFrame) *
          44100) /
          7000000,
      ),
    );
  },
);
it("plays AY with beeper disabled, and resumes after discarded PCM without losing state", () => {
  const rom = new Uint8Array(32768);
  rom[0] = 0x76;
  const m = createMachine({ rom });
  m.configureSound({ ...DEFAULT_SOUND, beeperEnabled: false }, 48000);
  const write = (r: number, v: number) => {
    m.bus.writeIo(0xfffd, r);
    m.bus.writeIo(0xbffd, v);
  };
  write(0, 100);
  write(7, 0x3e);
  write(8, 15);
  for (let i = 0; i < 10; i++) m.advanceFrame();
  const left: number[] = [],
    right: number[] = [];
  m.setPcmSink((pcm, count) => {
    for (let i = 0; i < count; i++) {
      left.push(pcm[i * 2]);
      right.push(pcm[i * 2 + 1]);
    }
  });
  m.advanceFrame();
  expect(Math.max(...left) - Math.min(...left)).toBeGreaterThan(0.04);
  expect(Math.max(...right.map(Math.abs))).toBeLessThan(1e-8);
  expect(m.aySynth?.snapshot().position).toBe(11 * 143360);
});
