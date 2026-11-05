import { Z80Cpu } from "@dcorp80/z80cpu";
import { BorderDevice } from "../devices/border";
import { KeyboardDevice } from "../devices/keyboard";
import { Mcu } from "../devices/mcu";
import { BankedMemory } from "../devices/memory";
import { PortFeInputDevice } from "../devices/portFeInput";
import { type RasterVideo, TimedVideo } from "../devices/video";
import {
  PENTAGON_VIDEO_PRESET,
  type VideoPreset,
  validateVideoPreset,
} from "../devices/videoPresets";
import { parseTape } from "../files/tape";
import { Spectrum48CapsLock } from "../rom/spectrum48CapsLock";
import { Spectrum48Tape } from "../rom/spectrum48Tape";
import {
  CPU_LOAD_SAMPLE_FRAMES,
  MACHINE_CONFIG,
  type RasterTiming,
  rasterTiming,
} from "./config";
import { Counter, createCounters } from "./counters";
import { type ClockContext, type Device, DeviceBus } from "./devices";

export interface MachineOptions {
  rom: Uint8Array;
  cpu7?: boolean;
  decodeFd?: boolean;
  lateInt?: boolean;
  videoPreset?: VideoPreset;
  devices?: readonly Device[];
  videoFactory?: (videoPreset: VideoPreset) => RasterVideo;
}

export class Machine implements ClockContext {
  readonly config: {
    readonly id: string;
    readonly label: string;
    readonly slotHz: number;
    readonly borderPort: { readonly mask: number; readonly value: number };
  };
  videoPreset: VideoPreset;
  timing: RasterTiming;
  get width(): number {
    return this.videoPreset.width;
  }
  get height(): number {
    return this.videoPreset.height;
  }
  readonly cpu = new Z80Cpu();
  readonly memory: BankedMemory;
  readonly mcu: Mcu;
  private readonly screenMemory: Pick<DeviceBus, "readMemory">;
  readonly border: BorderDevice;
  readonly keyboard = new KeyboardDevice();
  readonly portFeInput = new PortFeInputDevice();
  readonly tape: Spectrum48Tape;
  private readonly capsLock: Spectrum48CapsLock;
  video: RasterVideo;
  bus: DeviceBus;
  readonly counters = createCounters();
  framePosition = 0;
  private pendingTicks = 0;
  /** Reporting delta, accumulated once per execution chunk, never per slot. */
  takeElapsedTicks(): number {
    const ticks = this.pendingTicks;
    this.pendingTicks = 0;
    return ticks;
  }
  private turbo: boolean;
  private lateInterrupt: boolean;
  private interruptPosition = 0;
  private flashPosition = 0;
  private sampledInterrupt = false;
  private haltedSlots = 0;
  private loadSampleFrames = 0;
  /** Active fraction over the last completed sampling window, in percent. */
  cpuLoad: number | null = null;
  private requestedTurbo: boolean;
  private resetHeld = false;
  private resetHalfCycles = 0;
  private previousMreq: 0 | 1 | undefined = 1;
  private readValue = 255;
  private readActive = false;
  private interruptRemaining = 0;
  private audioSink?: (latch: Uint8Array, slotHz: number) => void;
  setAudioSink(sink?: (latch: Uint8Array, slotHz: number) => void): void {
    this.audioSink = sink;
  }
  private readonly extraDevices: readonly Device[];
  private readonly videoFactory: (preset: VideoPreset) => RasterVideo;
  private clocks: {
    divider: number;
    remaining: number;
    tick: (ctx: ClockContext) => void;
  }[];

  constructor(options: MachineOptions) {
    this.videoPreset = options.videoPreset ?? PENTAGON_VIDEO_PRESET;
    validateVideoPreset(this.videoPreset);
    this.timing = rasterTiming(this.videoPreset);
    this.extraDevices = options.devices ?? [];
    this.videoFactory =
      options.videoFactory ?? ((preset) => new TimedVideo(preset));
    this.turbo = options.cpu7 ?? false;
    this.lateInterrupt = options.lateInt ?? this.videoPreset.defaultLateInt;
    this.requestedTurbo = this.turbo;
    this.memory = new BankedMemory(options.rom);
    this.config = this.memory.expanded
      ? {
          ...MACHINE_CONFIG,
          id: "uncontended-128k",
          label: "128K · no contention",
        }
      : MACHINE_CONFIG;
    this.screenMemory = { readMemory: this.memory.readScreen };
    this.tape = new Spectrum48Tape(this.memory, this.keyboard);
    this.capsLock = new Spectrum48CapsLock(this.memory, this.keyboard);
    this.mcu = new Mcu(this.memory, options.decodeFd, () => {
      this.tape.romChanged();
      this.capsLock.reset();
    });
    this.border = new BorderDevice(
      this.config.borderPort.mask,
      this.config.borderPort.value,
    );
    this.video = this.videoFactory(this.videoPreset);
    this.updateInterruptPosition();
    this.bus = new DeviceBus([
      this.memory,
      ...(this.memory.expanded ? [this.mcu] : []),
      this.border,
      this.keyboard,
      this.portFeInput,
      this.video,
      ...this.extraDevices,
    ]);
    this.clocks = this.bus.clocks.map((h) => ({
      divider: h.divider,
      remaining: h.phase,
      tick: h.tick,
    }));
    this.counters[Counter.h] = this.videoPreset.hOrigin;
    this.counters[Counter.v] = this.videoPreset.vOrigin;
    // A fresh core starts at PC=0 in its reset architectural state.
    // Cold boot reconstructs the core and all devices instead of patching registers.
    this.cpu.bus.nRESET = 1;
    this.cpu.bus.nWAIT = 1;
    this.cpu.bus.nBUSRQ = 1;
    this.cpu.bus.nINT = 1;
  }
  /** Rephase the raster without replacing CPU, RAM, or memory arbitration state. */
  setVideoPreset(preset: VideoPreset): void {
    validateVideoPreset(preset);
    const video = this.videoFactory(preset);
    const bus = new DeviceBus([
      this.memory,
      ...(this.memory.expanded ? [this.mcu] : []),
      this.border,
      this.keyboard,
      this.portFeInput,
      video,
      ...this.extraDevices,
    ]);
    const clocks = bus.clocks.map(
      (h) =>
        this.clocks.find((old) => old.tick === h.tick) ?? {
          divider: h.divider,
          remaining: h.phase,
          tick: h.tick,
        },
    );
    this.videoPreset = preset;
    this.timing = rasterTiming(preset);
    this.video = video;
    this.lateInterrupt = preset.defaultLateInt;
    this.updateInterruptPosition();
    this.bus = bus;
    this.clocks = clocks;
    this.framePosition = 0;
    this.sampledInterrupt = false;
    this.haltedSlots = 0;
    this.loadSampleFrames = 0;
    this.cpuLoad = null;
    this.interruptRemaining = 0;
    this.cpu.bus.nINT = 1;
    this.counters[Counter.h] = preset.hOrigin;
    this.counters[Counter.v] = preset.vOrigin;
  }

  get frameCount(): number {
    return this.counters[Counter.frames];
  }
  get cpu7(): boolean {
    return this.turbo;
  }
  get hasFrame(): boolean {
    return this.video.hasFrame;
  }
  setLateInt(enabled: boolean): void {
    this.lateInterrupt = enabled;
    this.updateInterruptPosition();
  }
  /** Resolve counter wiring once, including V advance within a raster line. */
  private positionForCounter(line: number, x: number): number {
    const { width, height } = this.videoPreset;
    for (let y = 0; y < height; y++) {
      const position = y * width + x;
      if (this.video.vPositions[position >>> 3] === line) return position;
    }
    throw new Error("Video counter does not contain the requested trigger");
  }
  private updateInterruptPosition(): void {
    const p = this.videoPreset;
    const line = this.lateInterrupt ? p.lateInterruptLine : p.interruptLine;
    const h = this.lateInterrupt ? p.lateInterruptH : p.vAdvance;
    const x = ((h - p.hOrigin + p.width / 2) % (p.width / 2)) * 2;
    this.interruptPosition = this.positionForCounter(line, x);
    this.flashPosition = this.positionForCounter(
      p.flashLine,
      this.video.advanceX,
    );
  }
  get memoryMapping() {
    return this.memory.mapping;
  }
  setDecodeFd(enabled: boolean): void {
    this.mcu.decodeFd = enabled;
  }
  setTurbo(enabled: boolean): void {
    this.requestedTurbo = enabled;
  }

  /** Continuous read pin resolution, without taking an extra memory slot. */
  private resolveInputs(): void {
    const b = this.cpu.bus;
    if (this.readActive && b.nMREQ === 0 && b.nRD === 0)
      b.data = this.readValue;
    if (b.nIORQ === 0) {
      if (b.nM1 === 0) {
        b.data = 255;
        this.interruptRemaining = 0;
        b.nINT = 1;
      } else if (b.addr !== undefined) {
        if (b.nRD === 0) b.data = this.bus.readIo(b.addr);
      }
    }
  }
  /** A press asserts immediately; even a brief tap spans six CPU edges. */
  setReset(pressed: boolean): void {
    if (pressed && !this.resetHeld) {
      this.resetHalfCycles = 6;
      this.mcu.reset();
      this.capsLock.reset();
      this.tape.reset();
    }
    this.resetHeld = pressed;
    this.cpu.bus.nRESET = this.resetHeld || this.resetHalfCycles > 0 ? 0 : 1;
  }

  loadTape(bytes: Uint8Array, name: string): void {
    if (!this.tape.canMount)
      throw new Error("This ROM is not supported by the flash tape loader.");
    if (this.tape.supports128Menu && this.mcu.decodeFd)
      throw new Error(
        "Select exact 7FFD paging (uncheck low-byte FD) before loading with the 128K ROM.",
      );
    // Validate before touching the running machine.
    parseTape(bytes, name, this.memory.expanded);
    if (!this.memory.expanded || this.tape.supports128Menu) {
      this.setReset(true);
      this.setReset(false);
    }
    this.tape.mount(bytes, name);
  }

  private cpuEdge(): void {
    this.resolveInputs();
    const b = this.cpu.bus;
    const previousM1 = b.nM1;
    const previousWr = b.nWR;
    this.cpu.clockEdge();
    // Commit once at assertion, not on every sample of a held I/O strobe.
    // Keep this before reset release and in the slot that produced the edge.
    if (
      previousWr === 1 &&
      b.nWR === 0 &&
      b.nIORQ === 0 &&
      b.nM1 === 1 &&
      b.nRESET === 1 &&
      b.nBUSACK === 1 &&
      b.addr !== undefined &&
      b.data !== undefined
    )
      this.bus.writeIo(b.addr, b.data);
    // Latch the requested divider on M1 deassertion. The current pixel slot
    // finishes its scheduled edges; the next slot uses the new divider.
    if (previousM1 === 0 && this.cpu.bus.nM1 === 1)
      this.turbo = this.requestedTurbo;
    if (this.resetHalfCycles > 0) this.resetHalfCycles--;
    if (!this.resetHeld && this.resetHalfCycles === 0) this.cpu.bus.nRESET = 1;
    this.counters[Counter.cpuEdges]++;
  }

  /** One resumable loop; each iteration is exactly one 7 MHz raster slot. */
  advancePixels(count: number): number {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new RangeError("Pixel count must be a nonnegative safe integer");
    const framesBefore = this.frameCount;
    // Configuration is stable for this synchronous execution chunk. Device
    // hooks still observe live counters, frame position and CPU pin values.
    const video = this.video;
    const bus = this.bus;
    const videoMemory = this.memory.expanded ? this.screenMemory : bus;
    const counters = this.counters;
    const clocks = this.clocks;
    const { width, pixelsPerFrame } = this.videoPreset;
    const { hPositions, vPositions } = video;
    const interruptPosition = this.interruptPosition;
    const flashPosition = this.flashPosition;
    const requested = count;
    let position = this.framePosition;
    try {
      while (count > 0) {
        const symbolIndex = position >>> 3;
        counters[Counter.h] = hPositions[position % width];
        counters[Counter.v] = vPositions[symbolIndex];
        if (position === interruptPosition) this.interruptRemaining = width;
        if (position === flashPosition) counters[Counter.flash]++;
        this.cpu.bus.nINT = this.interruptRemaining > 0 ? 0 : 1;
        for (const hook of clocks) {
          if (hook.remaining === 0) {
            hook.tick(this);
            hook.remaining = hook.divider;
          }
          hook.remaining--;
        }

        const b = this.cpu.bus;
        const request =
          this.previousMreq === 1 && b.nMREQ === 0 && b.nRFSH === 1;
        if (b.nMREQ !== 0) this.readActive = false;
        if (request && b.addr !== undefined) {
          if (b.nRD === 0) {
            if (b.addr === 0x10a8 && b.nM1 === 0) this.capsLock.keyboardPoll();
            this.readValue =
              this.tape.read(b.addr, b.nM1 === 0, this.cpu) ??
              bus.readMemory(b.addr);
            this.readActive = true;
            b.data = this.readValue;
          } else if (b.nRD === 1 && b.data !== undefined) {
            bus.writeMemory(b.addr, b.data);
            this.readActive = false;
          }
          video.cpuAccess();
        } else video.fetch(videoMemory, symbolIndex);

        // Observe before the CPU edges: their request is serviced next slot.
        this.previousMreq = b.nMREQ;
        if (this.turbo) this.cpuEdge();
        this.resolveInputs();
        video.captureBorder(position, this.border.value);
        // Retain the former per-pixel sampling phase, including turbo ACKs.
        const interrupt = this.cpu.bus.nINT === 0;
        if (interrupt !== this.sampledInterrupt) {
          video.captureInterrupt(position, interrupt);
          this.sampledInterrupt = interrupt;
        }
        if (this.cpu.bus.nHALT === 0) this.haltedSlots++;
        this.cpuEdge();
        if (this.interruptRemaining > 0) this.interruptRemaining--;
        position++;
        this.framePosition = position;
        count--;
        if (position === pixelsPerFrame) {
          position = this.framePosition = 0;
          if (++this.loadSampleFrames === CPU_LOAD_SAMPLE_FRAMES) {
            this.cpuLoad =
              100 *
              (1 -
                this.haltedSlots / (pixelsPerFrame * CPU_LOAD_SAMPLE_FRAMES));
            this.haltedSlots = 0;
            this.loadSampleFrames = 0;
          }
          video.finishFrame();
          this.audioSink?.(video.completed.border, this.config.slotHz);
          this.keyboard.advanceFrame();
          this.tape.frame();
          if (this.cpu.bus.nRESET !== 0) this.capsLock.advanceFrame();
          counters[Counter.frames]++;
        }
      }
      return this.frameCount - framesBefore;
    } finally {
      this.pendingTicks += requested - count;
    }
  }
  advanceFrame(): void {
    this.advancePixels(this.videoPreset.pixelsPerFrame - this.framePosition);
  }
  renderFrame(showBorder = true): Uint8ClampedArray {
    return this.video.render(showBorder);
  }
}
export const createMachine = (options: MachineOptions): Machine =>
  new Machine(options);
