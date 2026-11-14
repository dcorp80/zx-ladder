import { expect, it } from "vitest";
import { StereoQueue } from "./stereoQueue";

function block(frames: number, left: number, right = left): Float32Array {
  const pcm = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    pcm[i * 2] = left;
    pcm[i * 2 + 1] = right;
  }
  return pcm;
}

function render(queue: StereoQueue, frames: number) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  queue.render(left, right);
  return { left, right };
}

function expectSmooth(samples: Float32Array, previous: number, step: number) {
  for (const sample of samples) {
    expect(Math.abs(sample - previous)).toBeLessThanOrEqual(step);
    previous = sample;
  }
}

it("keeps zero PCM silent through underrun, reset and immediate refill", () => {
  const queue = new StereoQueue(48000);
  for (let cycle = 0; cycle < 3; cycle++) {
    queue.push(block(2048, 0), 2048);
    const out = render(queue, 2437);
    expect([...out.left, ...out.right].every((value) => value === 0)).toBe(
      true,
    );
    queue.reset();
  }
});

it("fades in opposite stereo channels together and keeps consuming once primed", () => {
  const queue = new StereoQueue(48000);
  queue.push(block(1919, 0.25, -0.5), 1919);
  expect(render(queue, 193).left.every((value) => value === 0)).toBe(true);
  expect(queue.queued).toBe(1919);
  queue.push(block(1, 0.25, -0.5), 1);
  const opening = render(queue, 173);
  expect(opening.left[0]).toBe(0.25 / 128);
  expect(opening.left[127]).toBe(0.25);
  expect(opening.left[172]).toBe(0.25);
  for (let i = 0; i < opening.left.length; i++)
    expect(opening.right[i]).toBe(-2 * opening.left[i]);
  expectSmooth(opening.left, 0, 0.25 / 128);
  expect(queue.queued).toBe(1920 - 173);
  // Priming is only for restarting: a running queue can consume below 40 ms.
  expect(render(queue, 271).left.every((value) => value === 0.25)).toBe(true);
  expect(queue.queued).toBe(1920 - 173 - 271);
});

it("fades constant output down and back up after a complete underrun", () => {
  const queue = new StereoQueue(48000);
  queue.push(block(2048, -0.5), 2048);
  render(queue, 2048);
  const ending = render(queue, 257).left;
  expectSmooth(ending, -0.5, 0.5 / 128);
  expect(ending[127]).toBeCloseTo(0, 12);
  expect(ending[256]).toBeCloseTo(0, 12);
  queue.push(block(2048, -0.5), 2048);
  const resumed = render(queue, 193).left;
  expectSmooth(resumed, 0, 0.5 / 128);
  expect(resumed[0]).toBe(-0.5 / 128);
  expect(resumed[127]).toBe(-0.5);
  expect(queue.queued).toBe(2048 - 193);
});

it("finishes fading before consuming a refill that arrives during an underrun", () => {
  const queue = new StereoQueue(48000);
  queue.push(block(2048, 0.5, -0.25), 2048);
  render(queue, 2048);
  const fading = render(queue, 37);
  const refill = block(2048, -0.5, 0.25);
  for (let i = 128; i < 2048; i++) {
    refill[i * 2] = -0.5 + (i - 127) / 8192;
    refill[i * 2 + 1] = -0.5 * refill[i * 2];
  }
  queue.push(refill, 2048);
  const remainder = render(queue, 91);
  expect(queue.queued).toBe(2048);
  expectSmooth(remainder.left, fading.left[36], 0.5 / 128);
  expect(remainder.left[90]).toBe(0);
  expect(remainder.right[90]).toBeCloseTo(0, 12);
  const resumed = render(queue, 169);
  expectSmooth(resumed.left, 0, 0.5 / 128);
  expect(resumed.left[0]).toBe(-0.5 / 128);
  expect(resumed.left[127]).toBe(-0.5);
  for (let i = 0; i < resumed.left.length; i++)
    expect(resumed.right[i]).toBe(-0.5 * resumed.left[i]);
  for (let i = 128; i < resumed.left.length; i++)
    expect(resumed.left[i]).toBe(refill[i * 2]);
  expect(queue.queued).toBe(2048 - 169);
});

it.each(["reset", "overflow"] as const)(
  "retains an immediate refill while fading old output after %s",
  (action) => {
    const queue = new StereoQueue(48000);
    queue.push(block(3000, 0.5, -0.25), 3000);
    render(queue, 256);
    if (action === "reset") queue.reset();
    // 2744 + 4000 exceeds the 5760-frame cap and replaces the old backlog.
    queue.push(block(4000, -0.5, 0.25), 4000);
    const ending = render(queue, 128);
    expectSmooth(ending.left, 0.5, 0.5 / 128);
    expect(ending.left[127]).toBe(0);
    expect(queue.queued).toBe(4000);
    const opening = render(queue, 128);
    expectSmooth(opening.left, 0, 0.5 / 128);
    expect(opening.left[127]).toBe(-0.5);
    expect(opening.right[127]).toBe(0.25);
    expect(queue.queued).toBe(4000 - 128);
  },
);

it("continues a reset during a fade from the last rendered level", () => {
  const queue = new StereoQueue(48000);
  queue.push(block(2048, 0.5), 2048);
  render(queue, 2048);
  const fading = render(queue, 64).left;
  queue.reset();
  queue.push(block(2048, -0.5), 2048);
  const continued = render(queue, 128).left;
  expectSmooth(continued, fading[63], 0.5 / 128);
  expect(continued[127]).toBe(0);
  expect(queue.queued).toBe(2048);
  const resumed = render(queue, 128).left;
  expectSmooth(resumed, 0, 0.5 / 128);
  expect(resumed[127]).toBe(-0.5);
});

it("preserves valid partial blocks and ignores stale tails across ring wrapping", () => {
  const queue = new StereoQueue(1000);
  const seed = Float32Array.from({ length: 200 }, (_, i) =>
    i % 2 ? -0.5 : 0.5,
  );
  queue.push(seed, 100);
  render(queue, 83);
  const expected: number[] = [];
  for (const frames of [7, 13, 19, 1]) {
    const pcm = new Float32Array(512).fill(99);
    for (let i = 0; i < frames; i++) {
      const value = (expected.length + 1) / 100;
      pcm[i * 2] = value;
      pcm[i * 2 + 1] = -value;
      expected.push(pcm[i * 2]);
    }
    queue.push(pcm, frames);
  }
  expect(queue.queued).toBe(57);
  // Finish the old samples and fade-in before reading the final 12 new frames.
  render(queue, 45);
  const out = render(queue, 12);
  expect([...out.left]).toEqual(expected.slice(28));
  for (let i = 0; i < out.left.length; i++)
    expect(out.right[i]).toBe(-out.left[i]);
  expect(queue.queued).toBe(0);
});

it("keeps fade timing and samples independent of output quantum boundaries", () => {
  const whole = new StereoQueue(48000);
  const split = new StereoQueue(48000);
  const samples = block(2048, 0.5, -0.25);
  whole.push(samples, 2048);
  split.push(samples, 2048);
  const expected = render(whole, 2301);
  const left: number[] = [];
  const right: number[] = [];
  for (const frames of [0, 1, 37, 89, 509, 1600, 65]) {
    const out = render(split, frames);
    left.push(...out.left);
    right.push(...out.right);
  }
  expect(left).toEqual([...expected.left]);
  expect(right).toEqual([...expected.right]);
  expect(split.queued).toBe(whole.queued);
});
