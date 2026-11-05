import { expect, it, vi } from "vitest";
import { SoundMixer } from "../audio/mixer";
import { BeeperResampler } from "../audio/resampler";
import { DeviceBus } from "../machine/devices";
import { IO_EVENT_CAPACITY } from "../machine/ioCapture";
import { createMachine } from "../machine/machine";
import { BorderDevice, type FeBatch } from "./border";
import { LVIV_VIDEO_PRESET } from "./videoPresets";

function expand(batch: FeBatch): number[] {
  let value = batch.initialValue,
    event = 0;
  const result: number[] = [];
  for (let tick = 0; tick < batch.duration; tick++) {
    while (event < batch.count && batch.time[event] === tick)
      value = batch.value[event++];
    result.push(value);
  }
  return result;
}

it("captures the full FE latch, identical writes and aliases in ordinary reusable arrays", () => {
  let tick = 100;
  const fe = new BorderDevice(1, 0, () => tick);
  const bus = new DeviceBus([fe]);
  const times = fe.batch.time,
    values = fe.batch.value,
    batch = fe.batch;
  expect(Array.isArray(times) && Array.isArray(values)).toBe(true);
  tick = 102;
  bus.writeIo(0x12fe, 0x1f);
  tick = 107;
  bus.writeIo(0x00fc, 0x1f);
  bus.writeIo(0x00ff, 5);
  expect(fe.batch.count).toBe(2);
  fe.flush(110, (b) => {
    expect(b.time.slice(0, b.count)).toEqual([2, 7]);
    expect(b.value.slice(0, b.count)).toEqual([31, 31]);
    expect(expand(b)).toEqual([0, 0, 31, 31, 31, 31, 31, 31, 31, 31]);
  });
  expect(fe.batch).toBe(batch);
  expect(fe.batch.time).toBe(times);
  expect(fe.batch.value).toBe(values);
  expect(fe.batch.count).toBe(0);
  expect(fe.batch.initialValue).toBe(31);
  expect(times.length).toBe(IO_EVENT_CAPACITY);
  tick = 112;
  fe.color = 2;
  expect(fe.value).toBe(26);
  expect(fe.batch.time[0]).toBe(2);
});

it("carries a boundary write and empty batches without resetting the latch", () => {
  let tick = 0;
  const fe = new BorderDevice(1, 0, () => tick);
  tick = 10;
  fe.value = 16;
  fe.flush(10, (b) => expect(expand(b)).toEqual(new Array(10).fill(0)));
  fe.flush(10, (b) => {
    expect(b.duration).toBe(0);
    expect(b.initialValue).toBe(16);
  });
  fe.flush(15, (b) => expect(expand(b)).toEqual(new Array(5).fill(16)));
});

it("rejects overflow without growing storage or mutating the latch", () => {
  const fe = new BorderDevice();
  for (let i = 0; i < IO_EVENT_CAPACITY; i++) fe.value = 7;
  expect(() => {
    fe.value = 16;
  }).toThrow("FE event buffer overflow");
  expect(fe.value).toBe(7);
  expect(fe.batch.time).toHaveLength(IO_EVENT_CAPACITY);
  expect(fe.batch.value).toHaveLength(IO_EVENT_CAPACITY);
});

it.each([false, true])(
  "reconstructs border colours byte-for-byte through CPU writes and turbo changes (initial turbo=%s)",
  (cpu7) => {
    const rom = new Uint8Array(16384);
    rom.set([0x3e, 0x10, 0xd3, 0xfe, 0xd3, 0xfe, 0xee, 0x1f, 0xc3, 2, 0]);
    const m = createMachine({ rom, cpu7 });
    let reconstructed: number[] = [];
    const original = m.border.flush.bind(m.border);
    vi.spyOn(m.border, "flush").mockImplementation((end, sink) =>
      original(end, (batch) => {
        reconstructed = reconstructed.concat(expand(batch));
        sink(batch);
      }),
    );
    let frames = 0;
    const verifyFrame = () => {
      expect(reconstructed.map((value) => value & 7)).toEqual(
        Array.from(m.video.completed.border),
      );
      reconstructed = [];
      frames++;
    };
    m.advancePixels(57);
    m.flushSound();
    m.setTurbo(!cpu7);
    m.advanceFrame();
    verifyFrame();
    m.setReset(true);
    m.advanceFrame();
    verifyFrame();
    m.setReset(false);
    m.setVideoPreset(LVIV_VIDEO_PRESET);
    m.setTurbo(cpu7);
    m.advanceFrame();
    verifyFrame();
    expect(frames).toBe(3);
  },
);

it.each([0, 1])(
  "timestamps turbo writes at the effective border sample (edge=%i)",
  (writeEdge) => {
    const m = createMachine({ rom: new Uint8Array(16384), cpu7: true });
    Object.assign(m.cpu.bus, { nWR: 1, nIORQ: 1, nM1: 1 });
    let edge = 0;
    m.cpu.clockEdge = () => {
      if (edge++ === writeEdge)
        Object.assign(m.cpu.bus, { nWR: 0, nIORQ: 0, addr: 0xfe, data: 0x17 });
    };
    m.advancePixels(2);
    expect(m.border.batch.count).toBe(1);
    expect(m.border.batch.time[0]).toBe(writeEdge);
  },
);

it.each([44100, 48000, 96000])(
  "matches dense beeper integration through duplicates, MIC/border-only writes and split batches (%i Hz)",
  (rate) => {
    const m = new SoundMixer(false);
    m.setSampleRate(rate);
    const reference = new BeeperResampler(rate);
    const result: number[] = [];
    m.setSink((pcm, frames) => {
      for (let i = 0; i < frames; i++) {
        expect(pcm[i * 2]).toBe(pcm[i * 2 + 1]);
        result.push(pcm[i * 2]);
      }
    });
    let now = 0;
    const fe = new BorderDevice(1, 0, () => now);
    let filtered = 0;
    const expected: number[] = [];
    const flush = () =>
      fe.flush(now, (batch) => {
        const dense = Uint8Array.from(expand(batch));
        for (const sample of reference.convert(dense, 7000000)) {
          filtered +=
            (1 - Math.exp((-2 * Math.PI * Math.min(8000, rate * 0.4)) / rate)) *
            (sample - filtered);
          expected.push(filtered * 0.2);
        }
        m.consume(batch);
      });
    for (now = 0; now < 10003; now++) {
      if (now % 19 === 0) fe.value = now & 255;
      if (now % 31 === 0) {
        const unchanged = fe.value;
        fe.value = unchanged; // Repeated write must remain captured.
      }
      if (now % 17 === 0) fe.color = now & 7;
      if (now % 127 === 0) flush();
    }
    flush();
    expect(result).toHaveLength(expected.length);
    for (let i = 0; i < result.length; i++)
      expect(result[i]).toBeCloseTo(expected[i], 7);
  },
);

it("fits a full turbo frame of shortest OUTs without growing or replacing capture arrays", () => {
  const rom = new Uint8Array(16384);
  rom.set([0x3e, 0x17, 0xc3, 0, 0x40]);
  const m = createMachine({ rom, cpu7: true });
  for (let address = 0x4000; address < 0x10000; address += 2) {
    m.memory.write(address, 0xd3);
    m.memory.write(address + 1, 0xfe);
  }
  const times = m.border.batch.time,
    values = m.border.batch.value;
  const original = m.border.flush.bind(m.border);
  let count = 0;
  vi.spyOn(m.border, "flush").mockImplementation((end, sink) =>
    original(end, (batch) => {
      count = batch.count;
      expect(batch.time).toBe(times);
      expect(batch.value).toBe(values);
      for (let i = 1; i < count; i++)
        expect(batch.time[i] - batch.time[i - 1]).toBe(11);
      sink(batch);
    }),
  );
  m.advanceFrame();
  expect(count).toBeGreaterThan(13000);
  expect(count).toBeLessThan(IO_EVENT_CAPACITY);
  expect(m.border.batch.count).toBe(0);
  expect(times).toHaveLength(IO_EVENT_CAPACITY);
});

it("fills one border span for beeper-only writes instead of sampling every pixel", () => {
  const rom = new Uint8Array(16384);
  rom.set([0x3e, 0x10, 0xd3, 0xfe, 0xee, 0x10, 0xc3, 2, 0]);
  const m = createMachine({ rom, cpu7: true });
  const perPixel = vi.spyOn(m.video, "captureBorder");
  const spans = vi.spyOn(m.video, "captureBorderSpan");
  let writes = 0;
  m.border.setSink((batch) => {
    writes += batch.count;
  });
  m.advanceFrame();
  expect(writes).toBeGreaterThan(5000);
  expect(perPixel).not.toHaveBeenCalled();
  expect(spans).toHaveBeenCalledExactlyOnceWith(
    0,
    m.videoPreset.pixelsPerFrame,
    0,
  );
  expect(m.video.completed.border.every((color) => color === 0)).toBe(true);
});
