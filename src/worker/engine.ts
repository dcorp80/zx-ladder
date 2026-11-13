import { PCM_BLOCK_FRAMES } from "../audio/mixer";
import { captureByteLength, copyCapture } from "../devices/frameRenderer";
import { KEY_ROWS } from "../devices/keyboard";
import type { VideoPreset } from "../devices/videoPresets";
import { createMachine, type Machine } from "../machine/machine";
import { createHostLoop, type HostLoop } from "../runloop/hostLoop";
import type { FromWorker, MachineState, Request, ToWorker } from "./protocol";

const ALL_KEYS = KEY_ROWS.flat();
export const WORKER_EXECUTION_BUDGET_MS = 4;

/** Owns the complete machine. No DOM, UI store, or browser storage access. */
export class WorkerEngine {
  private machine?: Machine;
  private loop?: HostLoop;
  private epoch = 0;
  private running = false;
  private visible = true;
  private freeRun = false;
  private border = true;
  private rawFrames = false;
  private pendingPreset?: VideoPreset;
  private pendingLate?: boolean;
  private pendingExtended?: boolean;
  private applyVideoChanges(): void {
    const m = this.machine;
    if (!m) return;
    if (this.pendingPreset) {
      m.setVideoPreset(this.pendingPreset);
      this.pendingPreset = undefined;
      this.lastFrame = -1;
      this.dirty = true;
      if (this.frameBuffer)
        this.frameBuffer = new Uint8ClampedArray(this.frameBytes());
    }
    if (this.pendingLate !== undefined) {
      m.setLateInt(this.pendingLate);
      this.pendingLate = undefined;
    }
    if (this.pendingExtended !== undefined) {
      m.setExtendedMode(this.pendingExtended);
      this.pendingExtended = undefined;
    }
    this.makeLoop();
  }

  private frameBytes(): number {
    if (!this.machine) throw new Error("Worker machine is not initialized");
    const slots = this.machine.timing.pixelsPerFrame;
    return this.rawFrames ? captureByteLength(slots) : slots * 4;
  }
  private audio = false;
  private fps: number | null = null;
  private lastUpdate = 0;
  private lastFrame = -1;
  private dirty = true;
  private frameBuffer?: Uint8ClampedArray;
  private taskChannel?: MessageChannel;
  private taskToken = 0;
  private queuedTask?: {
    token: number;
    callback: (timestamp?: number) => void;
  };

  private readonly audioBuffers: Float32Array[] = Array.from(
    { length: 32 },
    () => new Float32Array(PCM_BLOCK_FRAMES * 2),
  );
  constructor(
    private readonly send: (
      message: FromWorker,
      transfer?: Transferable[],
    ) => void,
  ) {}
  private state(): MachineState {
    const m = this.machine;
    if (!m) throw new Error("Worker machine is not initialized");
    return {
      disk: m.diskState,
      mouseAccessed: m.mouseAccessed,
      running: this.running,
      frameCount: m.frameCount,
      framePosition: m.framePosition,
      tickDelta: m.takeElapsedTicks(),
      counters: Array.from(m.counters),
      pc: m.cpu.regs.pc,
      cpu7: m.cpu7,
      extendedMode: m.extendedMode,
      cpuLoad: m.cpuLoad,
      memoryMapping: m.memoryMapping,
      tape: m.tape.status,
      keys: ALL_KEYS.filter((key) => m.keyboard.isPressed(key)),
      romCapsLock: m.keyboard.romCapsLock,
      fps: this.fps,
    };
  }
  private update(force = false): void {
    const m = this.machine;
    if (!m) return;
    const now = performance.now();
    if (!force && now - this.lastUpdate < 20) return;
    this.lastUpdate = now;
    const state = this.state();
    if (
      m.hasFrame &&
      this.frameBuffer &&
      (this.dirty || m.frameCount !== this.lastFrame)
    ) {
      const bytes = this.frameBuffer;
      this.frameBuffer = undefined;
      if (this.rawFrames)
        copyCapture(m.video.rawCompleted ?? m.video.completed, bytes);
      else bytes.set(m.renderFrame(this.border));
      this.lastFrame = m.frameCount;
      this.dirty = false;
      this.send(
        { type: "frame", epoch: this.epoch, bytes, raw: this.rawFrames, state },
        [bytes.buffer],
      );
    } else this.send({ type: "state", epoch: this.epoch, state });
  }
  private makeLoop(): void {
    this.loop?.dispose();
    if (!this.machine) throw new Error("Worker machine is not initialized");
    const m = this.machine;
    const drive = {
      timing: m.timing,
      get framePosition() {
        return m.framePosition;
      },
      advancePixels: (count: number) => {
        const pending =
          this.pendingPreset !== undefined ||
          this.pendingLate !== undefined ||
          this.pendingExtended !== undefined;
        const result = m.advancePixels(
          pending
            ? Math.min(count, m.timing.pixelsPerFrame - m.framePosition)
            : count,
        );
        if (pending && m.framePosition === 0) this.applyVideoChanges();
        return result;
      },
    };
    this.loop = createHostLoop(drive, {
      framePacing: true,
      freeRun: () => this.freeRun,
      workBudgetMs: WORKER_EXECUTION_BUDGET_MS,
      // Return to the worker task queue between batches so commands can run.
      schedule: (callback, delayMs = 0) => {
        if (delayMs > 0)
          return {
            timer: setTimeout(() => callback(performance.now()), delayMs),
          };
        // A task, not a microtask: input messages can interleave. Avoid the
        // nested-timer clamp while computing an unfinished frame.
        if (!this.taskChannel) {
          this.taskChannel = new MessageChannel();
          this.taskChannel.port1.onmessage = (event) => {
            const task = this.queuedTask;
            if (!task || task.token !== event.data) return;
            this.queuedTask = undefined;
            task.callback(performance.now());
          };
        }
        const token = ++this.taskToken;
        this.queuedTask = { token, callback };
        this.taskChannel.port2.postMessage(token);
        return { token };
      },
      cancel: (handle) => {
        const scheduled = handle as {
          timer?: ReturnType<typeof setTimeout>;
          token?: number;
        };
        if (scheduled.timer !== undefined) clearTimeout(scheduled.timer);
        if (scheduled.token === this.queuedTask?.token)
          this.queuedTask = undefined;
      },
      // Paced updates occur only when a frame is due; do not apply the
      // free-run 20 ms throttle to Lviv's slightly shorter frame period.
      onUpdate: () => this.update(!this.freeRun),
      onFps: (fps) => {
        this.fps = fps;
      },
      onError: (error) => {
        this.running = false;
        if (this.machine?.disk.romRequired) {
          this.update(true);
          return;
        }
        this.send({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    if (this.running && this.visible) this.loop.start();
  }
  receive(message: ToWorker): void {
    if ("recycle" in message) {
      if (message.recycle === "frame") {
        if (message.presented === false) this.dirty = true;
        // One display buffer in flight. A preset change may change its size.
        if (!this.machine) return;
        const length = this.frameBytes();
        this.frameBuffer =
          message.bytes.length === length
            ? (message.bytes as Uint8ClampedArray)
            : new Uint8ClampedArray(length);
        if (!this.running) this.update(true);
      } else if (this.audioBuffers.length < 32)
        this.audioBuffers.push(message.bytes as Float32Array);
      return;
    }
    try {
      this.execute(message);
    } catch (cause) {
      if (this.machine?.disk.romRequired) {
        this.running = false;
        this.loop?.pause();
        this.update(true);
        this.send({ type: "reply", id: message.id, state: this.state() });
        return;
      }
      this.send({
        type: "reply",
        id: message.id,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  private execute({ id, epoch, command: c }: Request): void {
    // Finish partial capture under its old epoch; the client rejects stale PCM.
    if (epoch !== this.epoch) this.machine?.flushSound();
    this.epoch = epoch;
    if (c.type === "init") {
      this.pendingPreset = undefined;
      this.pendingLate = undefined;
      this.pendingExtended = undefined;
      this.rawFrames = c.rawFrames ?? false;
      this.machine = createMachine({
        rom: c.rom,
        decodeFd: c.decodeFd,
        rtcEnabled: c.rtcEnabled,
        videoPreset: c.preset,
        cpu7: c.turbo,
        lateInt: c.lateInt,
      });
      this.frameBuffer = new Uint8ClampedArray(this.frameBytes());
      this.machine.setPcmSink((samples, frames, sampleRate) => {
        if (!this.audio || !this.running || !this.visible || this.freeRun)
          return;
        const bytes = this.audioBuffers.pop();
        if (!bytes) return; // Bounded audio backlog; never stall CPU execution.
        bytes.set(samples);
        this.send(
          {
            type: "audio",
            epoch: this.epoch,
            bytes,
            length: frames,
            sampleRate,
          },
          [bytes.buffer],
        );
      });
      this.makeLoop();
    } else {
      const m = this.machine;
      if (!m) throw new Error("Worker machine is not initialized");
      switch (c.type) {
        case "run":
          this.running = c.value;
          if (c.value && this.visible) this.loop?.start();
          else this.loop?.pause();
          if (
            !c.value &&
            (this.pendingPreset ||
              this.pendingLate !== undefined ||
              this.pendingExtended !== undefined)
          )
            this.applyVideoChanges();
          break;
        case "step":
          this.running = false;
          this.loop?.pause();
          if (
            this.pendingPreset ||
            this.pendingLate !== undefined ||
            this.pendingExtended !== undefined
          )
            this.applyVideoChanges();
          if (c.pixels === undefined) m.advanceFrame();
          else m.advancePixels(c.pixels);
          break;
        case "video":
          if (this.running && m.framePosition !== 0) {
            this.pendingPreset = c.preset;
            break;
          }
          this.pendingPreset = undefined;
          m.setVideoPreset(c.preset);
          this.dirty = true;
          this.lastFrame = -1;
          if (this.frameBuffer)
            this.frameBuffer = new Uint8ClampedArray(this.frameBytes());
          this.makeLoop();
          break;
        case "border":
          this.border = c.value;
          this.dirty = true;
          break;
        case "decodeFd":
          m.setDecodeFd(c.value);
          break;
        case "extendedMode":
          if (this.running && m.framePosition !== 0) {
            this.pendingExtended = c.value;
            break;
          }
          this.pendingExtended = undefined;
          m.setExtendedMode(c.value);
          break;
        case "rtcEnabled":
          m.setRtcEnabled(c.value);
          break;
        case "turbo":
          m.setTurbo(c.value);
          break;
        case "reset":
          m.setReset(c.value);
          break;
        case "lateInt":
          if (this.running && m.framePosition !== 0) {
            this.pendingLate = c.value;
            break;
          }
          this.pendingLate = undefined;
          m.setLateInt(c.value);
          break;
        case "freeRun":
          this.freeRun = c.value;
          this.fps = null;
          break;
        case "sound":
          m.configureSound(c.settings, c.sampleRate);
          break;
        case "audio":
          this.audio = c.value;
          break;
        case "visible":
          this.visible = c.value;
          if (this.visible && this.running) this.loop?.start();
          else this.loop?.pause();
          break;
        case "kempston":
          m.kempstonInput(c.input);
          break;
        case "keyboard": {
          const k = m.keyboard,
            input = c.input;
          switch (input.action) {
            case "press":
              k.press(input.source, input.keys);
              break;
            case "extended":
              k.pressExtended(input.source, input.key, input.shifted);
              break;
            case "release":
              k.release(input.source);
              break;
            case "releaseAll":
              k.releaseAll();
              break;
            case "caps":
              k.observeHostCapsLock(input.value);
              break;
            case "capsActive":
              k.capsSyncActive = input.value;
              break;
            case "capsToggle":
              k.toggleCapsLockTarget();
              break;
          }
          break;
        }
        case "dosRom":
          m.setDosRom(c.bytes);
          break;
        case "diskMount":
          m.mountDisk(c.bytes, c.id, c.name, c.autoRun, c.dirty);
          break;
        case "diskRun":
          m.runDisk(c.index);
          break;
        case "diskEject":
          m.ejectDisk();
          break;
        case "diskExport": {
          const memory = m.exportDisk(c.saved);
          this.send({ type: "reply", id, state: this.state(), memory }, [
            memory.buffer,
          ]);
          return;
        }
        case "tape":
          m.loadTape(c.bytes, c.name);
          break;
        case "inspect": {
          if (
            !Number.isInteger(c.address) ||
            !Number.isInteger(c.length) ||
            c.address < 0 ||
            c.length < 0 ||
            c.address + c.length > 65536
          )
            throw new Error("Invalid memory range");
          const memory = new Uint8Array(c.length);
          for (let i = 0; i < c.length; i++)
            memory[i] = m.memory.read(c.address + i);
          this.send({ type: "reply", id, state: this.state(), memory }, [
            memory.buffer,
          ]);
          return;
        }
      }
    }
    this.update(true);
    this.send({ type: "reply", id, state: this.state() });
  }
  dispose(): void {
    this.loop?.dispose();
    this.taskChannel?.port1.close();
    this.taskChannel?.port2.close();
  }
}
