import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostLoop,
  type HostFrameCallback,
  type HostLoopMachine,
} from "./hostLoop";

interface Scheduler {
  callbacks: Array<{ id: number; callback: HostFrameCallback }>;
  canceled: number[];
  schedule: (callback: HostFrameCallback) => number;
  cancel: (handle: unknown) => void;
  fireNext: () => void;
}

function makeScheduler(): Scheduler {
  const callbacks: Array<{ id: number; callback: HostFrameCallback }> = [];
  const canceled: number[] = [];
  let nextId = 0;
  return {
    callbacks,
    canceled,
    schedule(callback) {
      const id = ++nextId;
      callbacks.push({ id, callback });
      return id;
    },
    cancel(handle) {
      if (typeof handle === "number") {
        canceled.push(handle);
        const index = callbacks.findIndex((item) => item.id === handle);
        if (index >= 0) callbacks.splice(index, 1);
      }
    },
    fireNext() {
      const item = callbacks.shift();
      if (!item) throw new Error("no scheduled callback");
      item.callback();
    },
  };
}

function makeMachine(overrides: Partial<HostLoopMachine> = {}) {
  const chunks: number[] = [];
  const machine: HostLoopMachine = {
    timing: {
      pixelHz: 7_000_000,
      pixelsPerFrame: 143_360,
    },
    advancePixels(pixelCount) {
      chunks.push(pixelCount);
      return 0;
    },
    ...overrides,
  };
  return { machine, chunks };
}

afterEach(() => {
  // Tests that exercise document visibility restore the property themselves,
  // but this makes a failed assertion less likely to poison another test.
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("createHostLoop", () => {
  it.each([
    [60, 1000 / 60],
    [120, 1000 / 120],
    [144, 1000 / 144],
  ])(
    "turns %s Hz host cadence into one second of pixel time",
    (hz, frameMs) => {
      let now = 0;
      const scheduler = makeScheduler();
      const { machine, chunks } = makeMachine();
      const loop = createHostLoop(machine, {
        now: () => now,
        schedule: scheduler.schedule,
        cancel: scheduler.cancel,
      });

      loop.start();
      for (let i = 1; i <= hz; i += 1) {
        now = i * frameMs;
        scheduler.fireNext();
      }

      const advanced = chunks.reduce((sum, chunk) => sum + chunk, 0);
      expect(advanced).toBe(Math.floor((hz * frameMs * 7_000_000) / 1000));
    },
  );

  it("retains fractional pixel debt instead of drifting", () => {
    let now = 0;
    const scheduler = makeScheduler();
    const { machine, chunks } = makeMachine();
    const loop = createHostLoop(machine, {
      now: () => now,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      workBudgetMs: 1000,
    });

    loop.start();
    // 1/7,000,000 seconds is one pixel.  Splitting the same elapsed time into
    // seven uneven host intervals should still produce exactly seven pixels.
    for (let i = 1; i <= 7; i += 1) {
      now = i / 7_000;
      scheduler.fireNext();
    }

    expect(chunks.reduce((sum, chunk) => sum + chunk, 0)).toBe(7);
  });

  it("bounds work to chunks and carries unfinished ticks forward", () => {
    let now = 0;
    const scheduler = makeScheduler();
    const { machine, chunks } = makeMachine();
    machine.advancePixels = (pixelCount) => {
      chunks.push(pixelCount);
      now += 0.001;
      return 0;
    };
    const loop = createHostLoop(machine, {
      now: () => now,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      // This makes the deterministic frozen clock hit the one-chunk fallback.
      workBudgetMs: 0.0001,
    });

    loop.start();
    now = 100;
    scheduler.fireNext();
    const firstCallbackChunks = chunks.slice();
    expect(firstCallbackChunks.length).toBe(1);
    expect(firstCallbackChunks[0]).toBe(1024);

    now = 100.1;
    scheduler.fireNext();
    expect(chunks.length).toBe(2);
    expect(chunks[1]).toBe(1024);
  });

  it("resets host baseline on pause and resume", () => {
    let now = 0;
    const scheduler = makeScheduler();
    const { machine, chunks } = makeMachine();
    const loop = createHostLoop(machine, {
      now: () => now,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      workBudgetMs: 1000,
    });

    loop.start();
    now = 100;
    scheduler.fireNext();
    const beforePause = chunks.reduce((sum, chunk) => sum + chunk, 0);

    loop.pause();
    expect(loop.isRunning()).toBe(false);
    now = 10_000;
    loop.start();
    expect(loop.isRunning()).toBe(true);
    now = 10_001;
    scheduler.fireNext();

    const afterResume = chunks.reduce((sum, chunk) => sum + chunk, 0);
    expect(afterResume - beforePause).toBe(7_000);
  });

  it("notifies once for lifecycle changes and once per RAF callback", () => {
    const now = 0;
    const scheduler = makeScheduler();
    const update = vi.fn();
    const { machine } = makeMachine();
    const loop = createHostLoop(machine, {
      now: () => now,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      onUpdate: update,
      workBudgetMs: 1000,
    });

    loop.start();
    expect(update).toHaveBeenCalledTimes(1);
    scheduler.fireNext();
    expect(update).toHaveBeenCalledTimes(2);
    loop.pause();
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("ignores canceled callbacks after dispose", () => {
    const now = 0;
    const scheduler = makeScheduler();
    const update = vi.fn();
    const { machine, chunks } = makeMachine();
    const loop = createHostLoop(machine, {
      now: () => now,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      onUpdate: update,
      workBudgetMs: 1000,
    });

    loop.start();
    const stale = scheduler.callbacks[0]?.callback;
    if (!stale) throw new Error("missing scheduled callback");
    loop.dispose();
    stale(100);

    expect(loop.isRunning()).toBe(false);
    expect(chunks).toEqual([]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(scheduler.canceled).toEqual([1]);
  });

  it("reports machine errors and stops scheduling", () => {
    let now = 0;
    const scheduler = makeScheduler();
    const error = new Error("machine failed");
    const onError = vi.fn();
    const { machine } = makeMachine({
      advancePixels() {
        throw error;
      },
    });
    const loop = createHostLoop(machine, {
      now: () => now,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      onError,
      workBudgetMs: 1000,
    });

    loop.start();
    now = 1;
    scheduler.fireNext();

    expect(onError).toHaveBeenCalledWith(error);
    expect(loop.isRunning()).toBe(false);
    expect(scheduler.callbacks).toHaveLength(0);
  });

  it("stops RAF while hidden and resumes the user's run intent", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    let now = 0;
    const scheduler = makeScheduler();
    const { machine, chunks } = makeMachine();
    const loop = createHostLoop(machine, {
      now: () => now,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      workBudgetMs: 1000,
    });

    loop.start();
    expect(scheduler.callbacks).toHaveLength(1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(scheduler.canceled).toEqual([1]);
    expect(loop.isRunning()).toBe(true);

    now = 10_000;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(scheduler.callbacks).toHaveLength(1);
    scheduler.fireNext();
    expect(chunks).toEqual([]);

    loop.dispose();
  });
});

it("samples completed emulator frames every 16 frames and excludes paused/hidden time", () => {
  let now = 0;
  let position = 0;
  const scheduler = makeScheduler();
  const onFps = vi.fn();
  const machine: HostLoopMachine = {
    timing: { pixelHz: 1000, pixelsPerFrame: 20 },
    advancePixels(count) {
      position += count;
      const completed = Math.floor(position / 20);
      position %= 20;
      return completed;
    },
  };
  const loop = createHostLoop(machine, {
    now: () => now,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    onFps,
  });
  const advance = (callbacks: number) => {
    for (let n = 0; n < callbacks; n++) {
      now += 10;
      scheduler.fireNext();
    }
  };
  try {
    loop.start();
    onFps.mockClear();
    advance(31); // 100 Hz host, 15 complete emulated frames.
    expect(onFps).not.toHaveBeenCalled();
    advance(1);
    expect(onFps).toHaveBeenCalledExactlyOnceWith(50);
    loop.pause();
    expect(onFps).toHaveBeenLastCalledWith(null);
    now += 10_000;
    loop.start();
    onFps.mockClear();
    advance(32);
    expect(onFps).toHaveBeenCalledExactlyOnceWith(50);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onFps).toHaveBeenLastCalledWith(null);
    now += 10_000;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    onFps.mockClear();
    advance(32);
    expect(onFps).toHaveBeenCalledExactlyOnceWith(50);
  } finally {
    loop.dispose();
  }
});

it("free-runs beyond the realtime debt cap within 16ms and switches back without catch-up", () => {
  let now = 0;
  let freeRun = true;
  const chunks: number[] = [];
  const scheduler = makeScheduler();
  const onFps = vi.fn();
  const onUpdate = vi.fn();
  const loop = createHostLoop(
    {
      timing: { pixelHz: 1024, pixelsPerFrame: 1024 },
      advancePixels(count) {
        chunks.push(count);
        now += 1; // Each chunk costs one host millisecond.
        return Math.floor(count / 1024);
      },
    },
    {
      now: () => now,
      freeRun: () => freeRun,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      onFps,
      onUpdate,
    },
  );
  try {
    loop.start();
    onUpdate.mockClear();
    scheduler.fireNext(); // No elapsed wall-clock debt is required.
    expect(chunks).toHaveLength(16);
    expect(chunks.every((n) => n === 1024)).toBe(true);
    expect(now).toBe(16);
    expect(onFps).toHaveBeenLastCalledWith(1000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    freeRun = false;
    now = 10_000;
    scheduler.fireNext();
    expect(chunks).toHaveLength(16); // Switching discards accumulated debt.
    expect(onFps).toHaveBeenLastCalledWith(null);
    now += 1000;
    scheduler.fireNext();
    expect(chunks).toHaveLength(17);
    expect(chunks[16]).toBe(1024);
    freeRun = true;
    scheduler.fireNext();
    expect(chunks).toHaveLength(33);
    loop.pause();
    expect(scheduler.callbacks).toHaveLength(0);
  } finally {
    loop.dispose();
  }
});
