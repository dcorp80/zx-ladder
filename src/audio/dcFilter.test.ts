import { expect, it } from "vitest";
import { StereoDcFilter } from "./dcFilter";

function stereo(
  frames: number,
  sample: (frame: number, channel: number) => number,
): Float32Array {
  return Float32Array.from({ length: frames * 2 }, (_, index) =>
    sample(index >>> 1, index & 1),
  );
}

function peak(samples: Float32Array, channel: number): number {
  let result = 0;
  for (let i = channel; i < samples.length; i += 2)
    result = Math.max(result, Math.abs(samples[i]));
  return result;
}

function rms(samples: Float32Array, channel: number, skip: number): number {
  let sum = 0;
  let count = 0;
  for (let i = skip * 2 + channel; i < samples.length; i += 2) {
    sum += samples[i] ** 2;
    count++;
  }
  return Math.sqrt(sum / count);
}

it.each([44_100, 48_000, 96_000])(
  "keeps either idle polarity silent from the first sample at %i Hz",
  (rate) => {
    for (const polarity of [-1, 1]) {
      const filter = new StereoDcFilter(rate);
      const samples = stereo(4096, (_, channel) =>
        channel === 0 ? polarity * 0.1 : -polarity * 0.3,
      );
      filter.process(samples, samples.length / 2);
      expect(peak(samples, 0)).toBeLessThan(1e-9);
      expect(peak(samples, 1)).toBeLessThan(1e-9);
    }
  },
);

it("keeps the stereo histories independent", () => {
  const rate = 48_000;
  const filter = new StereoDcFilter(rate);
  const samples = stereo(rate / 4, (frame, channel) =>
    channel === 0
      ? 0.4 + 0.2 * Math.sin((2 * Math.PI * 1000 * frame) / rate)
      : -0.3,
  );
  filter.process(samples, samples.length / 2);
  expect(rms(samples, 0, rate / 10)).toBeGreaterThan(0.13);
  expect(peak(samples, 1)).toBeLessThan(1e-9);
});

it.each([44_100, 48_000, 96_000])(
  "retains identical history across partial and empty calls at %i Hz",
  (rate) => {
    const frames = 3307;
    const input = stereo(frames, (frame, channel) =>
      channel === 0
        ? 0.2 + ((frame * 17) % 137) / 200
        : -0.3 + Math.sin(frame / 19) * 0.2,
    );
    const whole = new Float32Array(input);
    const fragmented = new Float32Array(input);
    new StereoDcFilter(rate).process(whole, frames);
    const filter = new StereoDcFilter(rate);
    // An empty call must not initialize the stream from unrelated storage.
    filter.process(Float32Array.of(-0.9, 0.8), 0);
    let offset = 0;
    for (const count of [1, 0, 17, 128, 29, 0, 256, 2, 1024, 1850]) {
      filter.process(fragmented.subarray(offset * 2), count);
      offset += count;
    }
    expect(offset).toBe(frames);
    expect(fragmented).toEqual(whole);
  },
);

it("processes only active frames in the supplied buffer and subview", () => {
  const storage = Float32Array.of(9, 8, 0.1, -0.2, 0.4, 0.3, 7, 6, 5, 4);
  const original = new Float32Array(storage);
  const active = storage.subarray(2, 8);
  const backing = active.buffer;
  const filter = new StereoDcFilter(48_000);
  filter.process(active, 2);
  expect(active.buffer).toBe(backing);
  expect(storage.subarray(0, 2)).toEqual(original.subarray(0, 2));
  expect(storage.subarray(6)).toEqual(original.subarray(6));
  expect(Math.abs(storage[2])).toBeLessThan(1e-9);
  expect(Math.abs(storage[3])).toBeLessThan(1e-9);
  expect(storage[4]).toBeGreaterThan(0.29);
  expect(storage[5]).toBeGreaterThan(0.49);
});

it("starts silently at a different DC level after an explicit reset", () => {
  const filter = new StereoDcFilter(48_000);
  const playing = stereo(1024, (frame, channel) =>
    channel === 0 ? Math.sin(frame / 11) : Math.cos(frame / 7),
  );
  filter.process(playing, playing.length / 2);
  expect(peak(playing, 0)).toBeGreaterThan(0.5);
  filter.reset();
  const idle = stereo(4096, (_, channel) => (channel === 0 ? -0.7 : 0.25));
  filter.process(idle, idle.length / 2);
  expect(peak(idle, 0)).toBeLessThan(1e-9);
  expect(peak(idle, 1)).toBeLessThan(1e-9);
});

it("passes audible tones while rejecting slow baseline changes", () => {
  const rate = 48_000;
  const input = stereo(
    rate,
    (frame, channel) =>
      0.3 +
      0.2 * Math.sin((2 * Math.PI * (channel === 0 ? 1000 : 5) * frame) / rate),
  );
  const output = new Float32Array(input);
  new StereoDcFilter(rate).process(output, rate);
  const skip = rate / 4;
  const expectedToneRms = 0.2 / Math.sqrt(2);
  expect(rms(output, 0, skip)).toBeCloseTo(expectedToneRms, 3);
  expect(rms(output, 1, skip)).toBeLessThan(expectedToneRms * 0.08);
});
