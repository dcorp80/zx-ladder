import { KEY_ROWS } from "../devices/keyboard";
import { Counter } from "../machine/counters";
import { createMachine, type Machine } from "../machine/machine";
import { createHostLoop, type HostLoop } from "../runloop/hostLoop";
import type { FromWorker, MachineState, Request, ToWorker } from "./protocol";

const ALL_KEYS = KEY_ROWS.flat();

/** Owns the complete machine. No DOM, UI store, or browser storage access. */
export class WorkerEngine {
  private machine?: Machine;
  private loop?: HostLoop;
  private epoch = 0;
  private running = false;
  private visible = true;
  private freeRun = false;
  private border = true;
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

  private readonly audioBuffers: Uint8Array[] = Array.from(
    { length: 3 },
    () => new Uint8Array(448 * 320),
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
      frameCount: m.frameCount,
      framePosition: m.framePosition,
      ticks: m.counters[Counter.pixels],
      counters: Array.from(m.counters),
      pc: m.cpu.regs.pc,
      cpu7: m.cpu7,
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
    if (!force && (now - this.lastUpdate < 20 || !this.frameBuffer)) return;
    this.lastUpdate = now;
    const state = this.state();
    if (
      m.hasFrame &&
      this.frameBuffer &&
      (this.dirty || m.frameCount !== this.lastFrame)
    ) {
      const bytes = this.frameBuffer;
      this.frameBuffer = undefined;
      bytes.set(m.renderFrame(this.border));
      this.lastFrame = m.frameCount;
      this.dirty = false;
      this.send({ type: "frame", epoch: this.epoch, bytes, state }, [
        bytes.buffer,
      ]);
    } else this.send({ type: "state", epoch: this.epoch, state });
  }
  private makeLoop(): void {
    this.loop?.dispose();
    if (!this.machine) throw new Error("Worker machine is not initialized");
    this.loop = createHostLoop(this.machine, {
      freeRun: () => this.freeRun,
      workBudgetMs: 4,
      // Return to the worker task queue between batches so commands can run.
      schedule: (callback) => {
        if (!this.freeRun)
          return { timer: setTimeout(() => callback(performance.now()), 4) };
        // A task, not a microtask: input messages can interleave. Avoid the
        // nested-timer 4 ms clamp limiting free-run to roughly half a core.
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
      onUpdate: () => this.update(),
      onFps: (fps) => {
        this.fps = fps;
      },
      onError: (error) => {
        this.running = false;
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
        const length = this.machine.width * this.machine.height * 4;
        this.frameBuffer =
          message.bytes.length === length
            ? (message.bytes as Uint8ClampedArray)
            : new Uint8ClampedArray(length);
        if (!this.running) this.update(true);
      } else if (this.audioBuffers.length < 3)
        this.audioBuffers.push(message.bytes as Uint8Array);
      return;
    }
    try {
      this.execute(message);
    } catch (cause) {
      this.send({
        type: "reply",
        id: message.id,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  private execute({ id, epoch, command: c }: Request): void {
    this.epoch = epoch;
    if (c.type === "init") {
      this.machine = createMachine({
        rom: c.rom,
        videoPreset: c.preset,
        cpu7: c.turbo,
        lateInt: c.lateInt,
      });
      this.frameBuffer = new Uint8ClampedArray(
        this.machine.width * this.machine.height * 4,
      );
      this.machine.setAudioSink((latch, slotHz) => {
        if (!this.audio || !this.running || !this.visible || this.freeRun)
          return;
        const bytes = this.audioBuffers.pop();
        if (!bytes) return; // Bounded audio backlog; never stall CPU execution.
        bytes.set(latch);
        this.send(
          {
            type: "audio",
            epoch: this.epoch,
            bytes,
            length: latch.length,
            slotHz,
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
          break;
        case "step":
          this.running = false;
          this.loop?.pause();
          if (c.pixels === undefined) m.advanceFrame();
          else m.advancePixels(c.pixels);
          break;
        case "video":
          m.setVideoPreset(c.preset);
          this.dirty = true;
          this.lastFrame = -1;
          if (this.frameBuffer)
            this.frameBuffer = new Uint8ClampedArray(m.width * m.height * 4);
          this.makeLoop();
          break;
        case "border":
          this.border = c.value;
          this.dirty = true;
          break;
        case "turbo":
          m.setTurbo(c.value);
          break;
        case "reset":
          m.setReset(c.value);
          break;
        case "lateInt":
          m.setLateInt(c.value);
          break;
        case "freeRun":
          this.freeRun = c.value;
          this.fps = null;
          break;
        case "audio":
          this.audio = c.value;
          break;
        case "visible":
          this.visible = c.value;
          if (this.visible && this.running) this.loop?.start();
          else this.loop?.pause();
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
