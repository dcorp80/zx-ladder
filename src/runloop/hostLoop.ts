/**
 * Drive a machine's pixel clock from host animation frames.
 *
 * The machine deliberately has no dependency on the browser scheduler.  A
 * host loop turns elapsed wall-clock time into pixel periods and hands those
 * periods to `advancePixels` in bounded chunks.  Keeping the accumulator in
 * pixel units is important: the video clock is independent of the CPU mode,
 * and a fractional remainder must survive both RAF cadence and chunking.
 */

export const HOST_LOOP_WORK_BUDGET_MS = 8;
export const FREE_RUN_WORK_BUDGET_MS = 16;
// Fail-safe for a frozen host clock; the deadline normally stops far earlier.
const FREE_RUN_MAX_CHUNKS = 65_536;
export const HOST_LOOP_MAX_CHUNK_PIXELS = 1024;
export const HOST_LOOP_MAX_DEBT_FRAMES = 4;
export const FPS_SAMPLE_FRAMES = 16;

export interface HostLoopTiming {
  readonly pixelHz: number;
  readonly pixelsPerFrame: number;
}

/**
 * The small part of the machine contract needed by the presentation loop.
 * `frameCount` and `framePosition` are intentionally not required here: the
 * loop does not own them, but machines may expose them to consumers of the
 * loop.
 */
export interface HostLoopMachine {
  readonly timing: HostLoopTiming;
  readonly frameCount?: number;
  readonly framePosition?: number;
  advancePixels(pixelCount: number): number;
}

export type HostFrameHandle = unknown;
export type HostFrameCallback = (timestamp?: number) => void;
export type HostSchedule = (callback: HostFrameCallback) => HostFrameHandle;
export type HostCancel = (handle: HostFrameHandle) => void;

export interface HostLoopOptions {
  onUpdate?: () => void;
  /** Completed emulator frames per wall-clock second; null while unsampled. */
  onFps?: (fps: number | null) => void;
  onError?: (error: unknown) => void;
  /** Read once per RAF, so speed can change without rebuilding the machine. */
  freeRun?: () => boolean;
  now?: () => number;
  schedule?: HostSchedule;
  cancel?: HostCancel;

  /**
   * Primarily useful for deterministic tests and very unusual hosts.  The
   * default is deliberately small enough to keep presentation responsive.
   */
  workBudgetMs?: number;
  /** Maximum wall-clock debt retained after a host stall, in frames. */
  maxDebtFrames?: number;
}

export interface HostLoop {
  start(): void;
  pause(): void;
  dispose(): void;
  isRunning(): boolean;
}

const defaultNow = (): number => {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
};

function defaultSchedule(callback: HostFrameCallback): HostFrameHandle {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame((timestamp) => callback(timestamp));
  }

  // RAF is absent in a few non-visual hosts (and in the test environment).
  // A timer keeps the loop usable there while preserving the same callback
  // contract.  The loop still uses its injected clock for elapsed time.
  return setTimeout(() => callback(defaultNow()), 16);
}

function defaultCancel(handle: HostFrameHandle): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle as number);
    return;
  }
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero`);
  }
  return value;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Create a browser-facing host loop for a structural machine.
 *
 * `start` and `pause` are idempotent.  A pause drops accumulated wall-clock
 * debt, so resuming after a user pause starts from the new host time rather
 * than producing a catch-up burst.  The same rule is used when a document is
 * hidden; the user's run intent remains active and scheduling resumes when it
 * becomes visible again.
 */
export function createHostLoop(
  machine: HostLoopMachine,
  options: HostLoopOptions = {},
): HostLoop {
  const pixelHz = positiveFinite(machine.timing.pixelHz, "timing.pixelHz");
  const pixelsPerFrame = positiveFinite(
    machine.timing.pixelsPerFrame,
    "timing.pixelsPerFrame",
  );
  if (typeof machine.advancePixels !== "function") {
    throw new TypeError("machine.advancePixels must be a function");
  }

  const clock = options.now ?? defaultNow;
  const schedule = options.schedule ?? defaultSchedule;
  const cancel = options.cancel ?? defaultCancel;
  const onUpdate = options.onUpdate;
  const onError = options.onError;
  const workBudgetMs = positiveFinite(
    options.workBudgetMs ?? HOST_LOOP_WORK_BUDGET_MS,
    "workBudgetMs",
  );
  const maxDebtFrames = positiveFinite(
    options.maxDebtFrames ?? HOST_LOOP_MAX_DEBT_FRAMES,
    "maxDebtFrames",
  );
  const maxDebtPixels = Math.max(
    HOST_LOOP_MAX_CHUNK_PIXELS,
    pixelsPerFrame * maxDebtFrames,
  );

  // The chunk cap only bounds retained debt.  The normal limiter below uses
  // fresh host-clock samples and the work budget; tying this cap to the
  // budget would incorrectly limit a 60 Hz callback to roughly half of its
  // elapsed pixel time on a fast host.
  const maxChunksPerCallback = Math.max(
    1,
    Math.ceil(maxDebtPixels / HOST_LOOP_MAX_CHUNK_PIXELS),
  );

  let freeRun = options.freeRun?.() ?? false;
  let running = false;
  let disposed = false;
  let hidden =
    typeof document !== "undefined" && document.visibilityState === "hidden";
  let previousHostTime: number | undefined;
  let pixelDebt = 0;
  let pendingHandle: HostFrameHandle | undefined;
  let pendingToken: number | undefined;
  let nextToken = 0;
  let sampledFrames = 0;
  let sampleStart = 0;

  const readTime = (timestamp?: number): number => {
    let value: number;
    try {
      // An injected clock is authoritative.  Without one, an RAF timestamp
      // is preferable to taking another performance.now() sample, and makes
      // the default path use the browser's single frame timestamp.
      value = options.now
        ? clock()
        : typeof timestamp === "number" && Number.isFinite(timestamp)
          ? timestamp
          : clock();
    } catch {
      value = previousHostTime ?? 0;
    }
    return finiteOr(value, previousHostTime ?? 0);
  };

  const resetFps = (): void => {
    sampledFrames = 0;
    sampleStart = readTime();
    options.onFps?.(null);
  };

  const reportError = (error: unknown): void => {
    // Stop before notifying the consumer.  If onError itself throws, the
    // scheduler must still remain stopped and must not keep invoking it.
    running = false;
    previousHostTime = undefined;
    pixelDebt = 0;
    resetFps();
    cancelPending();
    try {
      onError?.(error);
    } catch {
      // Error handlers belong to the host application.  Letting a handler
      // throw back through RAF would make the loop's stopped state unclear.
    }
  };

  const notifyUpdate = (): boolean => {
    if (!onUpdate) return true;
    try {
      onUpdate();
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  const cancelPending = (): void => {
    const handle = pendingHandle;
    pendingHandle = undefined;
    pendingToken = undefined;
    if (handle !== undefined) {
      try {
        cancel(handle);
      } catch (error) {
        reportError(error);
      }
    }
  };

  const advanceDuePixels = (): void => {
    let chunks = 0;
    const workStart = readTime();
    const deadline =
      workStart +
      (freeRun
        ? (options.workBudgetMs ?? FREE_RUN_WORK_BUDGET_MS)
        : workBudgetMs);
    const chunkLimit = freeRun ? FREE_RUN_MAX_CHUNKS : maxChunksPerCallback;

    while ((freeRun || pixelDebt >= 1) && chunks < chunkLimit) {
      const chunk = freeRun
        ? HOST_LOOP_MAX_CHUNK_PIXELS
        : Math.min(HOST_LOOP_MAX_CHUNK_PIXELS, Math.floor(pixelDebt));
      if (chunk < 1) break;

      sampledFrames += machine.advancePixels(chunk);
      if (!freeRun) pixelDebt = Math.max(0, pixelDebt - chunk);
      chunks += 1;

      // Always make one unit of progress, then yield when the real host clock
      // says the callback's budget has elapsed.  The chunk cap above prevents
      // a frozen/injected clock from making this loop unbounded.
      if (chunks > 0 && readTime() >= deadline) break;
    }
  };

  const runFrame = (token: number, timestamp?: number): void => {
    // A canceled RAF may still be delivered by a scheduler.  The token check
    // prevents an old callback from consuming a newly scheduled callback's
    // slot after pause/resume.
    if (disposed || !running || hidden || pendingToken !== token) {
      return;
    }

    pendingToken = undefined;
    pendingHandle = undefined;

    const callbackTime = readTime(timestamp);
    const nextFreeRun = options.freeRun?.() ?? false;
    if (nextFreeRun !== freeRun) {
      freeRun = nextFreeRun;
      pixelDebt = 0;
      previousHostTime = callbackTime;
      resetFps();
    }
    if (previousHostTime === undefined) {
      previousHostTime = callbackTime;
    } else {
      const elapsed = callbackTime - previousHostTime;
      previousHostTime = callbackTime;
      if (!freeRun && elapsed > 0) {
        pixelDebt = Math.min(
          maxDebtPixels,
          pixelDebt + (elapsed * pixelHz) / 1000,
        );
      }
    }

    try {
      advanceDuePixels();
      if (sampledFrames >= FPS_SAMPLE_FRAMES) {
        const sampleEnd = readTime();
        const elapsed = sampleEnd - sampleStart;
        if (elapsed > 0) {
          options.onFps?.((sampledFrames * 1000) / elapsed);
          sampledFrames = 0;
          sampleStart = sampleEnd;
        }
      }
    } catch (error) {
      reportError(error);
      return;
    }

    if (!notifyUpdate()) return;

    if (running && !hidden && !disposed) {
      scheduleNext();
    }
  };

  const scheduleNext = (): void => {
    if (disposed || !running || hidden || pendingToken !== undefined) return;

    const token = ++nextToken;
    pendingToken = token;
    try {
      const handle = schedule((timestamp) => runFrame(token, timestamp));
      // A custom scheduler may invoke the callback synchronously.  In that
      // case a later callback has already claimed the pending slot; do not
      // overwrite its handle with the completed synchronous one.
      if (pendingToken === token) {
        pendingHandle = handle;
      }
    } catch (error) {
      if (pendingToken === token) {
        pendingToken = undefined;
        pendingHandle = undefined;
      }
      reportError(error);
    }
  };

  const visibilityTarget =
    typeof document !== "undefined" &&
    typeof document.addEventListener === "function"
      ? document
      : undefined;

  const handleVisibility = (): void => {
    if (disposed || !visibilityTarget) return;
    const nextHidden = visibilityTarget.visibilityState === "hidden";
    if (nextHidden === hidden) return;
    hidden = nextHidden;

    if (hidden) {
      // Keep `running` true so visibility changes do not steal the user's run
      // intent.  Resetting the baseline and debt avoids a catch-up burst when
      // the tab becomes visible after an arbitrary amount of time.
      cancelPending();
      previousHostTime = undefined;
      pixelDebt = 0;
      resetFps();
      return;
    }

    if (running) {
      previousHostTime = readTime();
      resetFps();
      scheduleNext();
    }
  };

  visibilityTarget?.addEventListener("visibilitychange", handleVisibility);

  const loop: HostLoop = {
    start(): void {
      if (disposed || running) return;
      running = true;
      previousHostTime = readTime();
      pixelDebt = 0;
      resetFps();

      if (!notifyUpdate()) return;
      if (!hidden) scheduleNext();
    },

    pause(): void {
      if (disposed || !running) return;
      running = false;
      cancelPending();
      previousHostTime = undefined;
      pixelDebt = 0;
      resetFps();
      notifyUpdate();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      running = false;
      cancelPending();
      previousHostTime = undefined;
      pixelDebt = 0;
      resetFps();
      visibilityTarget?.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    },

    isRunning(): boolean {
      return running;
    },
  };

  return loop;
}
