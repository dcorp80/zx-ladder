import { expect, it } from "vitest";
import { type AyBatch, AyDevice } from "../devices/ay";
import { createMachine } from "../machine/machine";
import { AY_LEVELS, type AyPcmBlock, AySynth } from "./aySynth";

function rig(sampleRate = 48_000) {
  let now = 0;
  const synth = new AySynth(sampleRate);
  const ay = new AyDevice(
    () => now,
    (batch) => synth.process(batch),
  );
  const samples: number[][] = [[], [], []];
  const collect = (block: AyPcmBlock) => {
    for (let i = 0; i < block.count; i++) {
      samples[0].push(block.a[i]);
      samples[1].push(block.b[i]);
      samples[2].push(block.c[i]);
    }
  };
  synth.setSink(collect);
  return {
    ay,
    synth,
    samples,
    collect,
    write(reg: number, value: number) {
      ay.select(reg);
      ay.write(value);
    },
    run(ticks: number) {
      now += ticks;
      ay.flush();
    },
    at(tick: number) {
      now = tick;
    },
  };
}

it.each([0, 1, 2, 17, 0x123])(
  "generates exact tone periods including zero (%i)",
  (period) => {
    const r = rig(7_000_000);
    r.write(0, period & 255);
    r.write(1, period >> 8);
    r.write(7, 0x3e);
    r.write(8, 15);
    const half = Math.max(1, period) * 32;
    r.run(half * 4);
    const pcm = r.samples[0];
    for (let i = 0; i < pcm.length; i++)
      expect(pcm[i]).toBe(Math.floor(i / half) & 1);
    expect(r.samples[1].every((v) => v === 0)).toBe(true);
  },
);

it("retains counter phase on period writes and counts upward to the new period", () => {
  const r = rig();
  r.write(0, 4);
  r.run(32);
  expect(r.synth.snapshot().toneCount[0]).toBe(1);
  r.write(0, 1);
  r.run(32);
  expect(r.synth.snapshot().toneHigh[0]).toBe(1);
  expect(r.synth.snapshot().toneCount[0]).toBe(0);
});

it.each([0, 1, 3])(
  "clocks the deterministic 17-bit noise sequence at period %i",
  (period) => {
    const r = rig();
    r.write(6, period);
    const sequence = [
      1, 65536, 32768, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16,
      8, 65540, 32770, 16385, 73728,
    ];
    for (const seed of sequence) {
      expect(r.synth.snapshot().noiseSeed).toBe(seed);
      r.run(Math.max(1, period) * 64);
    }
  },
);

const down = Array.from({ length: 16 }, (_, i) => 15 - i);
const up = Array.from({ length: 16 }, (_, i) => i);
const low = new Array(32).fill(0);
const high = new Array(32).fill(15);
const shapes = [
  [...down, ...low],
  [...down, ...low],
  [...down, ...low],
  [...down, ...low],
  [...up, ...low],
  [...up, ...low],
  [...up, ...low],
  [...up, ...low],
  [...down, ...down, ...down],
  [...down, ...low],
  [...down, ...up, ...down],
  [...down, ...high],
  [...up, ...up, ...up],
  [...up, ...high],
  [...up, ...down, ...up],
  [...up, ...low],
];
it.each(shapes.map((levels, shape) => ({ levels, shape })))(
  "produces all envelope ramps and holds for shape $shape",
  ({ levels, shape }) => {
    const r = rig();
    r.write(11, 1);
    r.write(13, shape);
    r.run(0);
    for (const level of levels) {
      expect(r.synth.snapshot().envelopeLevel).toBe(level);
      r.run(64);
    }
  },
);

it.each([0, 1, 2, 0x102])(
  "uses the envelope divider, including half-period-zero behavior (%i)",
  (period) => {
    const r = rig();
    r.write(11, period & 255);
    r.write(12, period >> 8);
    r.write(13, 8);
    const ticks = period ? period * 64 : 32;
    r.run(ticks - 1);
    expect(r.synth.snapshot().envelopeLevel).toBe(15);
    r.run(1);
    expect(r.synth.snapshot().envelopeLevel).toBe(14);
  },
);

it("restarts the envelope on every R13 write, including an identical value", () => {
  const r = rig();
  r.write(11, 1);
  r.write(13, 8);
  r.run(64 * 3);
  expect(r.synth.snapshot().envelopeLevel).toBe(12);
  r.write(13, 8);
  r.run(0);
  expect(r.synth.snapshot().envelopeLevel).toBe(15);
  r.run(63);
  expect(r.synth.snapshot().envelopeLevel).toBe(15);
  r.run(1);
  expect(r.synth.snapshot().envelopeLevel).toBe(14);
});

it("combines tone and noise gates and permits volume-only DAC output", () => {
  const r = rig(7_000_000);
  r.write(8, 15);
  r.write(9, 15);
  r.write(10, 15);
  r.write(7, 0x00);
  r.run(1);
  expect(r.synth.snapshot().levels).toEqual([0, 0, 0]);
  r.write(7, 0x07);
  r.run(1); // tone disabled, initial noise bit high
  expect(r.synth.snapshot().levels).toEqual([1, 1, 1]);
  r.run(62); // first noise shift makes output low
  expect(r.synth.snapshot().levels).toEqual([0, 0, 0]);
  r.write(7, 0x3f);
  r.run(1);
  expect(r.synth.snapshot().levels).toEqual([1, 1, 1]);
  r.write(7, 0x38);
  r.run(0); // tone and noise disabled have independent masks
  expect(r.synth.snapshot().levels).toEqual([0, 0, 0]);
});

it("uses logarithmic levels and selects the envelope per channel", () => {
  const r = rig();
  r.write(7, 0x3f);
  r.write(11, 1);
  r.write(13, 12);
  r.write(8, 16);
  r.write(9, 15);
  r.write(10, 0);
  r.run(0);
  expect(r.synth.snapshot().levels).toEqual([0, 1, 0]);
  r.run(64);
  expect(r.synth.snapshot().levels).toEqual([AY_LEVELS[1], 1, 0]);
  for (let i = 2; i < 16; i++)
    expect(AY_LEVELS[i] / AY_LEVELS[i - 1]).toBeCloseTo(10 ** (3 / 20), 12);
});

it("integrates sub-sample writes instead of sampling the final latch", () => {
  const r = rig(1_000_000); // seven raster slots per audio sample
  r.write(7, 0x3f);
  r.write(8, 15);
  r.at(3);
  r.write(8, 0);
  r.at(7);
  r.ay.flush();
  expect(r.samples[0]).toHaveLength(1);
  expect(r.samples[0][0]).toBeCloseTo(3 / 7, 14);
});

it("replays multiple and zero-length resets and holds generators silent", () => {
  const r = rig(7_000_000);
  r.write(7, 0x3f);
  r.write(8, 15);
  r.at(3);
  r.ay.setReset(true);
  r.at(7);
  r.ay.setReset(false);
  r.write(7, 0x3f);
  r.write(8, 15);
  r.at(9);
  r.ay.setReset(true);
  r.ay.setReset(false);
  r.at(12);
  r.ay.flush();
  expect(r.samples[0]).toEqual([1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0]);
  expect(r.synth.snapshot().dividerRemaining).toBe(29);
});

it("carries held reset across batches without advancing generators", () => {
  const r = rig();
  r.run(17);
  r.ay.setReset(true);
  r.run(33);
  const before = r.synth.snapshot();
  r.run(1000);
  const after = r.synth.snapshot();
  expect({ ...after, position: before.position }).toEqual(before);
  r.ay.setReset(false);
  r.run(1);
  expect(r.synth.snapshot().dividerRemaining).toBe(31);
});

function render(split: boolean, sampleRate: number) {
  const r = rig(sampleRate);
  r.write(0, 9);
  r.write(2, 7);
  r.write(4, 13);
  r.write(6, 3);
  r.write(7, 0x10);
  r.write(8, 15);
  r.write(9, 16);
  r.write(10, 8);
  r.write(11, 2);
  r.write(13, 10);
  for (let tick = 1; tick <= 30_000; tick++) {
    r.at(tick);
    if (tick === 833) r.write(13, 10);
    if (tick === 1147) r.write(0, 3);
    if (tick === 2003) r.ay.setReset(true);
    if (tick === 2507) {
      r.ay.setReset(false);
      r.write(7, 0x3e);
      r.write(8, 15);
    }
    if (split && tick % 127 === 0) r.ay.flush();
  }
  r.ay.flush();
  return r;
}
it.each([44_100, 48_000, 96_000])(
  "preserves PCM, clock phase and sample counts across arbitrary batches (%i Hz)",
  (rate) => {
    const whole = render(false, rate);
    const split = render(true, rate);
    expect(split.synth.snapshot()).toEqual(whole.synth.snapshot());
    expect(split.samples[0]).toHaveLength(
      Math.floor((30_000 * rate) / 7_000_000),
    );
    for (let ch = 0; ch < 3; ch++) {
      expect(split.samples[ch]).toHaveLength(whole.samples[ch].length);
      for (let i = 0; i < split.samples[ch].length; i++)
        expect(split.samples[ch][i]).toBeCloseTo(whole.samples[ch][i], 12);
    }
  },
);

it("reuses PCM storage and advances identically when output is discarded", () => {
  const a = rig();
  const b = rig();
  let first: AyPcmBlock | undefined;
  let callbacks = 0;
  a.synth.setSink((block) => {
    if (!first) first = block;
    expect(block).toBe(first);
    expect(Array.isArray(block.a)).toBe(true);
    expect(block.count).toBeLessThanOrEqual(block.a.length);
    callbacks++;
  });
  b.synth.setSink();
  for (const r of [a, b]) {
    r.write(7, 0x3e);
    r.write(8, 15);
    r.write(0, 11);
    r.run(143_360);
  }
  expect(callbacks).toBeGreaterThan(3);
  expect(b.synth.snapshot()).toEqual(a.synth.snapshot());
  b.synth.setSink(b.collect);
  a.synth.setSink(a.collect);
  a.run(997);
  b.run(997);
  expect(a.samples).toEqual(b.samples);
});

it("sample-rate changes preserve chip state and reset only sample integration", () => {
  const r = rig();
  r.write(0, 7);
  r.run(123);
  const state = r.synth.snapshot();
  r.synth.setSampleRate(96_000);
  expect(r.synth.snapshot()).toEqual(state);
  r.run(700);
  expect(r.samples[0]).toHaveLength(Math.floor((700 * 96000) / 7000000));
  expect(() => r.synth.setSampleRate(0)).toThrow("sample rate");
});

it("rejects missing batches instead of silently losing chip history", () => {
  const r = rig();
  r.run(10);
  const b: AyBatch = {
    origin: 11,
    duration: 1,
    time: [],
    reg: [],
    value: [],
    count: 0,
    resetIntervals: [],
    startsInReset: false,
    endsInReset: false,
  };
  expect(() => r.synth.process(b)).toThrow("Noncontiguous");
});

it.each([false, true])(
  "runs the machine synthesizer at fixed speed even without playback (turbo=%s)",
  (cpu7) => {
    const rom = new Uint8Array(32768);
    rom[0] = 0x76;
    const m = createMachine({ rom, cpu7 });
    m.bus.writeIo(0xfffd, 0);
    m.bus.writeIo(0xbffd, 7);
    m.advanceFrame();
    expect(m.aySynth?.snapshot().position).toBe(143_360);
    expect(m.aySynth?.snapshot().toneCount[0]).toBe(4480 % 7);
    expect(m.aySynth?.snapshot().toneHigh[0]).toBe(Math.floor(4480 / 7) & 1);
  },
);
