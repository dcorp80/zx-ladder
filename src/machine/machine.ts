import { Z80Cpu } from "@dcorp80/z80cpu";
import { AySynth } from "../audio/aySynth";
import {
  SoundMixer,
  type SoundSettings,
  type StereoSink,
} from "../audio/mixer";
import { AyDevice } from "../devices/ay";
import { BetaDisk } from "../devices/betaDisk";
import { BorderDevice, type FeBatch } from "../devices/border";
import { GlukRtc } from "../devices/glukRtc";
import { KempstonDevice, type KempstonInput } from "../devices/kempston";
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
import { basicTape, dosLauncher, trdBoot } from "../files/trd";
import { Spectrum48CapsLock } from "../rom/spectrum48CapsLock";
import { Spectrum48Tape } from "../rom/spectrum48Tape";
import { TrdosService } from "../rom/trdos";
import {
  CPU_LOAD_SAMPLE_FRAMES,
  MACHINE_CONFIG,
  type RasterTiming,
  rasterTiming,
} from "./config";
import { Counter, createCounters } from "./counters";
import { type ClockContext, type Device, DeviceBus } from "./devices";
import { IO_MAX_BATCH_TICKS } from "./ioCapture";

export interface MachineOptions {
  rom: Uint8Array;
  cpu7?: boolean;
  decodeFd?: boolean;
  rtcEnabled?: boolean;
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
  readonly ay?: AyDevice;
  readonly aySynth?: AySynth;
  private readonly mixer: SoundMixer;
  private feWriteDelay = 0;
  private borderFrameOffset = 0;
  private readonly consumeFe = (batch: FeBatch) => {
    let start = 0;
    let value = batch.initialValue & 7;
    const offset = this.borderFrameOffset;
    for (let i = 0; i < batch.count; i++) {
      const color = batch.value[i] & 7;
      if (color === value) continue;
      const end = batch.time[i];
      if (end > start)
        this.video.captureBorderSpan(offset + start, offset + end, value);
      start = end;
      value = color;
    }
    if (batch.duration > start)
      this.video.captureBorderSpan(
        offset + start,
        offset + batch.duration,
        value,
      );
    this.borderFrameOffset += batch.duration;
    this.mixer.consume(batch);
  };
  /** Flush a partial audio batch before host playback state changes. */
  flushSound(): void {
    this.flushAudio();
  }
  setPcmSink(sink?: StereoSink): void {
    this.mixer.setSink(sink);
  }
  configureSound(settings: SoundSettings, sampleRate: number): void {
    if (sampleRate !== this.mixer.sampleRate) {
      if (
        !Number.isSafeInteger(sampleRate) ||
        sampleRate < 8000 ||
        sampleRate > 192000
      )
        throw new RangeError("Unsupported audio sample rate");
      this.flushAudio();
      this.mixer.setSampleRate(sampleRate);
      this.aySynth?.setSampleRate(sampleRate);
    }
    this.mixer.configure(settings);
  }
  /** Monotonic 7 MHz time; independent of raster rephasing and reporting deltas. */
  private elapsedTicks = 0;
  private nextAudioFlush = IO_MAX_BATCH_TICKS;
  private readonly screenMemory: Pick<DeviceBus, "readMemory">;
  readonly border: BorderDevice;
  readonly rtc = new GlukRtc();
  setRtcEnabled(enabled: boolean): void {
    this.rtc.enabled = enabled;
  }
  readonly kempston = new KempstonDevice(() => this.dosEnabled);
  kempstonInput(input: KempstonInput) {
    this.kempston.input(input);
  }
  get mouseAccessed() {
    return this.kempston.mouseAccessed;
  }
  readonly keyboard = new KeyboardDevice();
  readonly portFeInput = new PortFeInputDevice();
  readonly disk = new BetaDisk(() => this.elapsedTicks);
  readonly dos: TrdosService;
  get diskState() {
    return this.disk.state;
  }
  get dosEnabled() {
    return this.disk.dosEnabled;
  }
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
  private coldClock = true;
  private resetHeld = false;
  private resetHalfCycles = 0;
  private previousMreq: 0 | 1 | undefined = 1;
  private readValue = 255;
  private readActive = false;
  private interruptRemaining = 0;
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
    this.mixer = new SoundMixer(this.memory.expanded);
    if (this.memory.expanded) {
      const synth = new AySynth();
      this.aySynth = synth;
      synth.setSink((block) => this.mixer.captureAy(block));
      this.ay = new AyDevice(
        () => this.elapsedTicks,
        (batch) => synth.process(batch),
      );
    }
    this.config = this.memory.expanded
      ? {
          ...MACHINE_CONFIG,
          id: "uncontended-128k",
          label: "128K · no contention",
        }
      : MACHINE_CONFIG;
    this.screenMemory = { readMemory: this.memory.readScreen };
    this.dos = new TrdosService(this.memory, this.disk);
    this.tape = new Spectrum48Tape(this.memory, this.keyboard);
    this.capsLock = new Spectrum48CapsLock(this.memory, this.keyboard);
    this.rtc.enabled = options.rtcEnabled ?? true;
    this.mcu = new Mcu(this.memory, options.decodeFd, () => {
      this.tape.romChanged();
      this.capsLock.reset();
    });
    this.border = new BorderDevice(
      this.config.borderPort.mask,
      this.config.borderPort.value,
      () => this.elapsedTicks + this.feWriteDelay,
    );
    this.video = this.videoFactory(this.videoPreset);
    this.updateInterruptPosition();
    this.bus = new DeviceBus([
      this.memory,
      this.disk,
      ...(this.memory.expanded ? [this.mcu] : []),
      ...(this.ay ? [this.ay] : []),
      this.border,
      this.keyboard,
      this.kempston,
      this.rtc,
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
      this.disk,
      ...(this.memory.expanded ? [this.mcu] : []),
      ...(this.ay ? [this.ay] : []),
      this.border,
      this.keyboard,
      this.kempston,
      this.rtc,
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
    this.flushAudio();
    this.borderFrameOffset = 0;
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
      }
    }
  }
  /** A press asserts immediately; even a brief tap spans six CPU edges. */
  setReset(pressed: boolean): void {
    if (pressed && !this.resetHeld) {
      this.resetHalfCycles = 6;
      this.mcu.reset();
      this.rtc.reset();
      this.disk.reset();
      this.kempston.reset();
      this.memory.dosRom = undefined;
      this.dos.reset();
      this.capsLock.reset();
      this.tape.reset();
    }
    this.resetHeld = pressed;
    this.cpu.bus.nRESET = this.resetHeld || this.resetHalfCycles > 0 ? 0 : 1;
    this.ay?.setReset(this.cpu.bus.nRESET === 0);
  }

  setDosRom(bytes: Uint8Array | null): void {
    this.disk.setRom(bytes);
    if (this.disk.dosEnabled) this.memory.dosRom = this.disk.rom;
  }
  mountDisk(
    bytes: Uint8Array,
    id: string,
    name: string,
    autoRun = true,
    dirty = false,
  ): void {
    this.disk.mount(bytes, id, name);
    this.disk.dirty = dirty;
    this.memory.dosRom = this.disk.dosEnabled ? this.disk.rom : undefined;
    this.dos.reset();
    const boot = trdBoot(this.disk.state.catalog);
    if (autoRun && boot) this.runDisk(boot.index);
  }
  ejectDisk(): void {
    this.disk.eject();
    this.memory.dosRom = this.disk.dosEnabled ? this.disk.rom : undefined;
    this.dos.reset();
  }
  exportDisk(saved = true): Uint8Array {
    if (!this.disk.bytes) throw new Error("No disk mounted.");
    if (saved) this.disk.dirty = false;
    return this.disk.bytes.slice();
  }
  runDisk(index: number): void {
    const file = this.disk.state.catalog.find(
      (f) => f.index === index && f.ext === "B",
    );
    if (!file || !this.disk.bytes)
      throw new Error("BASIC file is no longer on the disk.");
    const tape = this.disk.rom
      ? dosLauncher(file.name)
      : basicTape(this.disk.bytes, file);
    this.loadTape(tape, "disk-start.tap", true);
    this.dos.prepareBasic = this.disk.rom ? undefined : file;
  }
  loadTape(bytes: Uint8Array, name: string, reset = false): void {
    if (!this.tape.canMount)
      throw new Error("This ROM is not supported by the flash tape loader.");
    if (this.tape.supports128Menu && this.mcu.decodeFd)
      throw new Error(
        "Select standard 128K paging (uncheck low-byte FD) before loading with the 128K ROM.",
      );
    // Validate before touching the running machine.
    parseTape(bytes, name, this.memory.expanded);
    if (reset || !this.memory.expanded || this.tape.supports128Menu) {
      this.setReset(true);
      this.setReset(false);
    }
    this.tape.mount(bytes, name);
  }

  private cpuEdge(afterBorder: boolean): void {
    this.resolveInputs();
    const b = this.cpu.bus;
    const previousM1 = b.nM1;
    const previousIorq = b.nIORQ;
    this.cpu.clockEdge();
    // Latch every ordinary port read/write once on nIORQ assertion.
    // Keep this before reset release and in the slot that produced the edge.
    if (
      previousIorq === 1 &&
      b.nIORQ === 0 &&
      b.nM1 === 1 &&
      b.nRESET === 1 &&
      b.nBUSACK === 1 &&
      b.addr !== undefined
    ) {
      // FE takes effect at its next raster sample. AY retains the I/O edge tick.
      this.feWriteDelay = afterBorder ? 1 : 0;
      try {
        if (b.nRD === 0) {
          this.kempston.observeRead(b.addr);
          b.data = this.bus.readIo(b.addr);
        } else if (b.nWR === 0 && b.data !== undefined)
          this.bus.writeIo(b.addr, b.data);
      } finally {
        this.feWriteDelay = 0;
      }
    }
    // Latch the requested divider on M1 deassertion. The current pixel slot
    // finishes its scheduled edges; the next slot uses the new divider.
    if (previousM1 === 0 && this.cpu.bus.nM1 === 1)
      this.turbo = this.requestedTurbo;
    if (this.resetHalfCycles > 0) this.resetHalfCycles--;
    if (!this.resetHeld && this.resetHalfCycles === 0 && b.nRESET === 0) {
      b.nRESET = 1;
      this.ay?.setReset(false);
    }
    this.counters[Counter.cpuEdges]++;
  }

  private flushAudio(): void {
    this.ay?.flush();
    this.border.flush(this.elapsedTicks, this.consumeFe);
    this.nextAudioFlush = this.elapsedTicks + IO_MAX_BATCH_TICKS;
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
      if (count > 0 && this.coldClock) {
        this.coldClock = false;
        // The core's first edge is rising. At 3.5 MHz it belongs to the
        // opening boundary of slot zero; the final edge is then falling.
        // Turbo already supplies that opening edge in the slot loop.
        if (!this.turbo) this.cpuEdge(false);
      }
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
            const opcode = b.nM1 === 0;
            if (opcode && b.nRESET === 1 && b.nBUSACK === 1) {
              const before = this.disk.dosEnabled;
              if (
                (b.addr & 0xff00) === 0x3d00 &&
                (!this.memory.expanded || this.mcu.latch & 16)
              )
                this.disk.dosEnabled = true;
              else if (b.addr >= 0x4000) this.disk.dosEnabled = false;
              if (before !== this.disk.dosEnabled) {
                this.kempston.input({ action: "buttons", buttons: 0 });
                this.memory.dosRom = this.disk.dosEnabled
                  ? this.disk.rom
                  : undefined;
                if (this.disk.dosEnabled) this.tape.cancel();
                else this.tape.romChanged();
                this.capsLock.reset();
              }
              this.dos.fetchRam(b.addr, true);
            }
            if (!this.dosEnabled && b.addr === 0x10a8 && opcode) {
              this.dos.basicReady();
              this.capsLock.keyboardPoll();
            }
            if (
              !this.dosEnabled &&
              opcode &&
              b.addr === 0x0805 &&
              this.tape.status === "Block 2/2 loaded; end of tape."
            )
              this.dos.basicReady();
            this.readValue =
              this.dos.read(b.addr, opcode, this.cpu) ??
              (!this.dosEnabled
                ? this.tape.read(b.addr, opcode, this.cpu)
                : undefined) ??
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
        if (this.turbo) this.cpuEdge(false);
        this.resolveInputs();
        // Retain the former per-pixel sampling phase, including turbo ACKs.
        const interrupt = this.cpu.bus.nINT === 0;
        if (interrupt !== this.sampledInterrupt) {
          video.captureInterrupt(position, interrupt);
          this.sampledInterrupt = interrupt;
        }
        if (this.cpu.bus.nHALT === 0) this.haltedSlots++;
        this.cpuEdge(true);
        if (this.interruptRemaining > 0) this.interruptRemaining--;
        position++;
        this.elapsedTicks++;
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
          this.flushAudio();
          this.borderFrameOffset = 0;
          video.finishFrame();
          this.keyboard.advanceFrame();
          if (!this.dosEnabled) this.tape.frame();
          if (this.cpu.bus.nRESET !== 0 && !this.dosEnabled)
            this.capsLock.advanceFrame();
          counters[Counter.frames]++;
        } else if (this.elapsedTicks === this.nextAudioFlush) this.flushAudio();
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
