import { KeyboardDevice, type SpectrumKey } from "../devices/keyboard";
import {
  PENTAGON_VIDEO_PRESET,
  type VideoPreset,
} from "../devices/videoPresets";
import { rasterTiming } from "../machine/config";
import { createCounters } from "../machine/counters";
import type { MachineOptions } from "../machine/machine";
import type { CreateStoreDeps, HostLoopLike, MachineLike } from "../store";
import type {
  Command,
  FromWorker,
  KeyboardCommand,
  MachineState,
} from "./protocol";

type LoopOptions = Parameters<
  NonNullable<CreateStoreDeps["hostLoopFactory"]>
>[1];
class RemoteKeyboard extends KeyboardDevice {
  private visual = new Set<SpectrumKey>();
  constructor(private readonly send: (input: KeyboardCommand) => void) {
    super();
  }
  override press(
    source: string,
    key: SpectrumKey | readonly SpectrumKey[],
  ): void {
    super.press(source, key);
    this.send({
      action: "press",
      source,
      keys: typeof key === "string" ? [key] : key,
    });
  }
  override pressExtended(
    source: string,
    key: SpectrumKey,
    shifted = true,
  ): void {
    // Local ownership supports host-key highlighting; worker owns sequence timing.
    super.press(source, ["CAPS_SHIFT", "SYMBOL_SHIFT"]);
    this.send({ action: "extended", source, key, shifted });
  }
  override release(source: string): void {
    super.release(source);
    this.send({ action: "release", source });
  }
  override releaseAll(): void {
    super.releaseAll();
    this.visual.clear();
    this.notify();
    this.send({ action: "releaseAll" });
  }
  override observeHostCapsLock(value: boolean): void {
    if (value === this.hostCapsLock) return;
    super.observeHostCapsLock(value);
    this.send({ action: "caps", value });
  }
  override get capsSyncActive(): boolean {
    return super.capsSyncActive;
  }
  override set capsSyncActive(value: boolean) {
    if (super.capsSyncActive === value) return;
    super.capsSyncActive = value;
    this.send({ action: "capsActive", value });
  }
  override toggleCapsLockTarget(): void {
    this.send({ action: "capsToggle" });
  }
  override isPressed(key: SpectrumKey): boolean {
    return this.visual.has(key);
  }
  update(state: MachineState): void {
    const changed =
      this.visual.size !== state.keys.length ||
      state.keys.some((key) => !this.visual.has(key)) ||
      this.romCapsLock !== state.romCapsLock;
    this.romCapsLock = state.romCapsLock;
    if (changed) {
      this.visual.clear();
      for (const key of state.keys) this.visual.add(key);
      this.notify();
    }
  }
}

/** UI-side snapshot and command adapter. The CPU and RAM exist only in the worker. */
export class WorkerMachine implements MachineLike {
  private readonly worker: Worker;
  private options?: LoopOptions;
  private disposed = false;
  private running = false;
  private epoch = 0;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (message: Extract<FromWorker, { type: "reply" }>) => void;
      reject: (error: Error) => void;
    }
  >();
  private sink?: (latch: Uint8Array, slotHz: number) => void;
  private audioEnabled = false;
  private freeRun = false;
  private border = true;
  private rgba: Uint8ClampedArray;
  private readonly visibility = () => {
    this.epoch++;
    this.fire({ type: "visible", value: !document.hidden });
  };
  readonly keyboard: RemoteKeyboard;
  readonly counters = createCounters();
  readonly cpu = { regs: { pc: 0 } };
  readonly tape = { status: "No tape mounted." };
  frameCount = 0;
  framePosition = 0;
  cpu7: boolean;
  hasFrame = false;
  presentationVersion = 0;
  videoPreset: VideoPreset;
  get timing() {
    return rasterTiming(this.videoPreset);
  }
  get width() {
    return this.videoPreset.width;
  }
  get height() {
    return this.videoPreset.height;
  }
  constructor(
    options: Pick<MachineOptions, "rom" | "cpu7" | "lateInt" | "videoPreset">,
  ) {
    this.videoPreset = options.videoPreset ?? PENTAGON_VIDEO_PRESET;
    this.cpu7 = options.cpu7 ?? false;
    this.rgba = new Uint8ClampedArray(this.width * this.height * 4);
    this.worker = new Worker(new URL("./machine.worker.ts", import.meta.url), {
      type: "module",
    });
    this.keyboard = new RemoteKeyboard((input) =>
      this.fire({ type: "keyboard", input }),
    );
    this.worker.onmessage = (event) => this.receive(event.data as FromWorker);
    this.worker.onerror = (event) =>
      this.fail(new Error(event.message || "Emulator worker failed"));
    this.worker.onmessageerror = () =>
      this.fail(new Error("Emulator worker message could not be decoded"));
    this.fire({
      type: "init",
      rom: options.rom,
      preset: this.videoPreset,
      turbo: this.cpu7,
      lateInt: options.lateInt ?? false,
    });
    document.addEventListener("visibilitychange", this.visibility);
    this.fire({ type: "visible", value: !document.hidden });
  }
  private request(
    command: Command,
  ): Promise<Extract<FromWorker, { type: "reply" }>> {
    if (this.disposed)
      return Promise.reject(new Error("Worker machine disposed"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, epoch: this.epoch, command });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private fire(command: Command): void {
    void this.request(command).catch((error) => {
      if (!this.disposed) this.fail(error);
    });
  }
  private fail(error: Error): void {
    if (this.disposed) return;
    this.running = false;
    // Reject waiters and terminate a failed worker instead of silently losing state.
    this.dispose();
    this.options?.onError?.(error);
  }
  private apply(state: MachineState): void {
    this.frameCount = state.frameCount;
    this.framePosition = state.framePosition;
    this.counters.set(state.counters);
    this.cpu.regs.pc = state.pc;
    this.cpu7 = state.cpu7;
    this.tape.status = state.tape;
    this.keyboard.update(state);
    this.options?.onFps?.(state.fps);
  }
  private receive(message: FromWorker): void {
    if (this.disposed) return;
    if (message.type === "reply") {
      const waiting = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiting?.reject(new Error(message.error));
      else waiting?.resolve(message);
      return;
    }
    if (message.type === "error") {
      this.fail(new Error(message.error));
      return;
    }
    if (message.type === "audio") {
      try {
        if (
          message.epoch === this.epoch &&
          this.audioEnabled &&
          this.running &&
          !this.freeRun
        )
          this.sink?.(
            message.bytes.subarray(0, message.length),
            message.slotHz,
          );
      } finally {
        this.worker.postMessage({ recycle: "audio", bytes: message.bytes }, [
          message.bytes.buffer,
        ]);
      }
      return;
    }
    if (message.type === "frame") {
      let presented = false;
      try {
        if (
          message.epoch !== this.epoch ||
          message.bytes.length !== this.rgba.length
        )
          return;
        presented = true;
        this.rgba.set(message.bytes);
        this.hasFrame = true;
        this.presentationVersion++;
        this.apply(message.state);
        this.options?.onUpdate?.();
      } finally {
        this.worker.postMessage(
          { recycle: "frame", bytes: message.bytes, presented },
          [message.bytes.buffer],
        );
      }
    } else if (message.epoch === this.epoch) {
      this.apply(message.state);
      this.options?.onUpdate?.();
    }
  }
  createLoop(options: LoopOptions): HostLoopLike {
    this.options = options;
    this.setFreeRun(options.freeRun?.() ?? false);
    return {
      start: () => {
        this.running = true;
        this.fire({ type: "run", value: true });
      },
      pause: () => {
        if (this.running)
          void this.pauseExecution().catch((error) => {
            if (!this.disposed) this.fail(error);
          });
      },
      dispose: () => {}, // Machine lifetime is independent of pacing-adapter replacement.
      isRunning: () => this.running,
    };
  }
  setAudioSink(sink?: (latch: Uint8Array, slotHz: number) => void): void {
    this.sink = sink;
  }
  setAudioEnabled(value: boolean): void {
    if (value !== this.audioEnabled) {
      this.audioEnabled = value;
      this.fire({ type: "audio", value });
    }
  }
  setFreeRun(value: boolean): void {
    if (value !== this.freeRun) {
      this.freeRun = value;
      this.epoch++;
      this.fire({ type: "freeRun", value });
    }
  }
  setShowBorder(value: boolean): void {
    if (value !== this.border) {
      this.border = value;
      this.epoch++;
      this.fire({ type: "border", value });
    }
  }
  setLateInt(value: boolean): void {
    this.fire({ type: "lateInt", value });
  }
  setTurbo(value: boolean): void {
    this.fire({ type: "turbo", value });
  }
  setReset(value: boolean): void {
    this.epoch++;
    this.fire({ type: "reset", value });
  }
  setVideoPreset(preset: VideoPreset): void {
    this.epoch++;
    this.videoPreset = preset;
    this.hasFrame = false;
    this.rgba = new Uint8ClampedArray(this.width * this.height * 4);
    this.fire({ type: "video", preset });
  }
  async loadTape(bytes: Uint8Array, name: string): Promise<void> {
    this.epoch++;
    await this.request({ type: "tape", bytes, name });
  }
  advancePixels(_count: number): number {
    throw new Error("Worker execution is asynchronous; use stepPixels");
  }
  advanceFrame(): void {
    this.fire({ type: "step" });
  }
  /** Debugger-facing pause acknowledgment contains one coherent stopped state. */
  async pauseExecution(): Promise<MachineState> {
    this.running = false;
    this.epoch++;
    const result = await this.request({ type: "run", value: false });
    if (!result.state)
      throw new Error("Worker did not acknowledge stopped state");
    return result.state;
  }
  async stepPixels(pixels: number): Promise<void> {
    await this.request({ type: "step", pixels });
  }
  async inspectMemory(address: number, length: number): Promise<Uint8Array> {
    const result = await this.request({ type: "inspect", address, length });
    if (!result.memory)
      throw new Error("Worker did not return requested memory");
    return result.memory;
  }
  renderFrame(): Uint8ClampedArray {
    return this.rgba;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    document.removeEventListener("visibilitychange", this.visibility);
    this.worker.terminate();
    for (const waiting of this.pending.values())
      waiting.reject(new Error("Worker machine disposed"));
    this.pending.clear();
  }
}
