import { Z80Cpu } from "@dcorp80/z80cpu";
import { BorderDevice } from "../devices/border";
import { KeyboardDevice } from "../devices/keyboard";
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
import { MACHINE_CONFIG, type RasterTiming, rasterTiming } from "./config";
import { Counter, createCounters } from "./counters";
import { type ClockContext, type Device, DeviceBus } from "./devices";

export interface MachineOptions {
  rom: Uint8Array;
  cpu7?: boolean;
  lateInt?: boolean;
  videoPreset?: VideoPreset;
  devices?: readonly Device[];
  videoFactory?: (videoPreset: VideoPreset) => RasterVideo;
}

export class Machine implements ClockContext {
  readonly config = MACHINE_CONFIG;
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
  readonly border: BorderDevice;
  readonly keyboard = new KeyboardDevice();
  readonly portFeInput = new PortFeInputDevice();
  readonly tape: Spectrum48Tape;
  private readonly capsLock: Spectrum48CapsLock;
  video: RasterVideo;
  bus: DeviceBus;
  readonly counters = createCounters();
  framePosition = 0;
  private turbo: boolean;
  private lateInterrupt: boolean;
  private interruptX = 0;
  private interruptLine = 0;
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
  private x = 0;
  private y = 0;
  private symbol = 0;
  private pixel = 0;
  private symbolIndex = 0;
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
    this.tape = new Spectrum48Tape(this.memory, this.keyboard);
    this.capsLock = new Spectrum48CapsLock(this.memory, this.keyboard);
    this.border = new BorderDevice(
      this.config.borderPort.mask,
      this.config.borderPort.value,
    );
    this.video = this.videoFactory(this.videoPreset);
    this.updateInterruptPosition();
    this.bus = new DeviceBus([
      this.memory,
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
    this.x =
      this.y =
      this.symbol =
      this.pixel =
      this.symbolIndex =
      this.framePosition =
        0;
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
  private updateInterruptPosition(): void {
    const p = this.videoPreset;
    this.interruptLine = this.lateInterrupt
      ? p.lateInterruptLine
      : p.interruptLine;
    const h = this.lateInterrupt ? p.lateInterruptH : p.vAdvance;
    this.interruptX = ((h - p.hOrigin + p.width / 2) % (p.width / 2)) * 2;
  }
  setTurbo(enabled: boolean): void {
    this.requestedTurbo = enabled;
  }

  /** Continuous read/IO pin resolution, without taking an extra memory slot. */
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
        if (b.nWR === 0 && b.data !== undefined)
          this.bus.writeIo(b.addr, b.data);
      }
    }
  }
  /** A press asserts immediately; even a brief tap spans six CPU edges. */
  setReset(pressed: boolean): void {
    if (pressed && !this.resetHeld) {
      this.resetHalfCycles = 6;
      this.capsLock.reset();
      this.tape.reset();
    }
    this.resetHeld = pressed;
    this.cpu.bus.nRESET = this.resetHeld || this.resetHalfCycles > 0 ? 0 : 1;
  }

  loadTape(bytes: Uint8Array, name: string): void {
    if (!this.tape.supported)
      throw new Error("This ROM is not supported by the 48K flash loader.");
    // Validate before touching the running machine.
    parseTape(bytes, name);
    this.setReset(true);
    this.setReset(false);
    this.tape.mount(bytes, name);
  }

  private cpuEdge(): void {
    this.resolveInputs();
    const previousM1 = this.cpu.bus.nM1;
    this.cpu.clockEdge();
    // Latch the requested divider on M1 deassertion. The current pixel slot
    // finishes its scheduled edges; the next slot uses the new divider.
    if (previousM1 === 0 && this.cpu.bus.nM1 === 1)
      this.turbo = this.requestedTurbo;
    if (this.resetHalfCycles > 0) this.resetHalfCycles--;
    if (!this.resetHeld && this.resetHalfCycles === 0) this.cpu.bus.nRESET = 1;
    this.counters[Counter.cpuEdges]++;
  }

  /** Resumable folded loops. Each inner slot is exactly one 7 MHz period. */
  advancePixels(count: number): number {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new RangeError("Pixel count must be a nonnegative safe integer");
    const framesBefore = this.frameCount;
    const symbolsPerLine = this.width / 8;
    while (count > 0) {
      for (; this.y < this.height; this.y++) {
        for (; this.symbol < symbolsPerLine; this.symbol++) {
          for (; this.pixel < 8; this.pixel++) {
            if (count === 0) return this.frameCount - framesBefore;
            this.x = this.symbol * 8 + this.pixel;
            this.symbolIndex = this.y * symbolsPerLine + this.symbol;
            const h = this.video.hPositions[this.x];
            const v = this.video.vPositions[this.symbolIndex];
            this.counters[Counter.h] = h;
            this.counters[Counter.v] = v;
            if (this.x === this.interruptX && v === this.interruptLine) {
              this.interruptRemaining = this.width;
            }
            if (
              this.x === this.video.advanceX &&
              v === this.videoPreset.flashLine
            )
              this.counters[Counter.flash]++;
            this.cpu.bus.nINT = this.interruptRemaining > 0 ? 0 : 1;
            for (const hook of this.clocks) {
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
                if (b.addr === 0x10a8 && b.nM1 === 0)
                  this.capsLock.keyboardPoll();
                this.readValue =
                  this.tape.read(b.addr, b.nM1 === 0, this.cpu) ??
                  this.bus.readMemory(b.addr);
                this.readActive = true;
                b.data = this.readValue;
              } else if (b.nRD === 1 && b.data !== undefined) {
                this.bus.writeMemory(b.addr, b.data);
                this.readActive = false;
              }
              this.video.cpuAccess();
            } else {
              this.video.fetch(this.bus, this.symbolIndex);
            }
            // Observe before the CPU edges: their request is serviced next slot.
            this.previousMreq = b.nMREQ;
            if (this.turbo) this.cpuEdge();
            this.resolveInputs();
            this.video.captureBorder(this.framePosition, this.border.value);
            this.video.captureInterrupt(
              this.framePosition,
              this.cpu.bus.nINT === 0,
            );
            this.cpuEdge();
            if (this.interruptRemaining > 0) this.interruptRemaining--;
            this.counters[Counter.pixels]++;
            this.framePosition++;
            count--;
          }
          this.pixel = 0;
        }
        this.symbol = 0;
      }
      this.y = 0;
      this.framePosition = 0;
      this.video.finishFrame();
      this.audioSink?.(this.video.completed.border, this.config.slotHz);
      this.keyboard.advanceFrame();
      this.tape.frame();
      if (this.cpu.bus.nRESET !== 0) this.capsLock.advanceFrame();
      this.counters[Counter.frames]++;
    }
    return this.frameCount - framesBefore;
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
