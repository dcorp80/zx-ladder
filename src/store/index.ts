import {
  type Accessor,
  createContext,
  createEffect,
  createRoot,
  createSignal,
  untrack,
  useContext,
} from "solid-js";
import type { AyStereo, SoundSettings, StereoSink } from "../audio/mixer";
import { SoundOutput } from "../audio/output";
import type { DiskState } from "../devices/betaDisk";
import type { KempstonInput } from "../devices/kempston";
import type { KeyboardDevice } from "../devices/keyboard";
import type { MemoryMapping } from "../devices/memory";
import {
  PENTAGON_VIDEO_PRESET,
  VIDEO_PRESETS,
  type VideoPreset,
} from "../devices/videoPresets";
import {
  type ImportBatch,
  type LibraryFile,
  prepareImport,
} from "../files/library";
import { sclToTrd } from "../files/scl";
import { trdBoot } from "../files/trd";
import { KempstonController } from "../input/kempstonInput";
import { isKeyboardLayout, KEYBOARD_PROFILE_ID } from "../input/keyboardLayout";
import type { RasterTiming } from "../machine/config";
import { createMachine } from "../machine/machine";
import { loadBundledRom } from "../rom/bundledRom";
import { complete128Rom } from "../rom/romPair";
import { ROM_REQUIRED } from "../rom/trdos";
import { createHostLoop } from "../runloop/hostLoop";
import {
  openDefaultBackend,
  ROM_SIZE,
  type RomRecord,
  type StorageBackend,
  validateRomBytes,
  validateRomRecord,
} from "../storage";
import {
  applyTheme,
  loadConfig,
  sanitizeTheme,
  saveConfig,
  type Theme,
} from "../storage/config";
import { WorkerMachine } from "../worker/client";

export type { Theme } from "../storage/config";

export const MACHINE_METER_REFRESH_MS = 320;

/** The part of the machine contract the UI needs. */
export interface MachineLike {
  readonly mouseAccessed?: boolean;
  kempstonInput?(input: KempstonInput): void;
  readonly diskState?: DiskState;
  setDosRom?(bytes: Uint8Array | null): void | Promise<void>;
  mountDisk?(
    bytes: Uint8Array,
    id: string,
    name: string,
    autoRun?: boolean,
    dirty?: boolean,
  ): void | Promise<void>;
  runDisk?(index: number): void | Promise<void>;
  ejectDisk?(): void | Promise<void>;
  exportDisk?(saved?: boolean): Uint8Array | Promise<Uint8Array>;
  takeElapsedTicks(): number;
  setPcmSink?(sink?: StereoSink): void;
  configureSound?(settings: SoundSettings, sampleRate: number): void;
  readonly tape?: { readonly status: string };
  loadTape?(bytes: Uint8Array, name: string): void | Promise<void>;
  readonly presentationVersion?: number;
  dispose?(): void;
  readonly videoPreset: VideoPreset;
  readonly timing: RasterTiming;
  readonly keyboard: KeyboardDevice;
  readonly width: number;
  readonly height: number;
  readonly cpu: {
    readonly regs?: { readonly pc?: number };
  };
  readonly counters: Float64Array;
  readonly frameCount: number;
  readonly framePosition: number;
  readonly cpu7: boolean;
  readonly cpuLoad: number | null;
  readonly memoryMapping?: MemoryMapping;
  readonly hasFrame: boolean;
  setLateInt(enabled: boolean): void;
  setDecodeFd?(enabled: boolean): void;
  setRtcEnabled?(enabled: boolean): void;
  setTurbo(enabled: boolean): void;
  setReset(pressed: boolean): void;
  setVideoPreset(preset: VideoPreset): void;
  advancePixels(count: number): number;
  advanceFrame(): void;
  renderFrame(showBorder?: boolean): Uint8ClampedArray;
}

export interface HostLoopLike {
  start(): void;
  pause(): void;
  dispose(): void;
  isRunning(): boolean;
}

export interface RuntimeStatus {
  frames: number;
  pc: number;
  ticks: number;
  cpuLoad: number | null;
  memoryMapping: MemoryMapping | null;
  framePosition: number;
  hasFrame: boolean;
  width: number;
  height: number;
}

export interface StorageStatus {
  state: "loading" | "ready" | "saved" | "session-only" | "error";
  persistent: boolean;
  message: string;
}

export interface CreateStoreDeps {
  loadBundledRom?: () => Promise<RomRecord | null>;
  backend?: StorageBackend;
  machineFactory?: (options: {
    rom: Uint8Array;
    cpu7?: boolean;
    decodeFd?: boolean;
    rtcEnabled?: boolean;
    lateInt?: boolean;
    videoPreset?: VideoPreset;
  }) => MachineLike;
  hostLoopFactory?: (
    machine: MachineLike,
    options: {
      onUpdate?: () => void;
      onError?: (error: unknown) => void;
      onFps?: (fps: number | null) => void;
      freeRun?: () => boolean;
    },
  ) => HostLoopLike;
}

export interface Store {
  readonly kempston: KempstonController;
  readonly mouseAccessed: Accessor<boolean>;
  readonly disk: Accessor<DiskState | undefined>;
  readonly dosRom: Accessor<RomRecord | null>;
  readonly dosRomStatus: Accessor<string>;
  readonly diskChangePending: Accessor<boolean>;
  resolveDiskChange(choice: "download" | "discard" | "cancel"): void;
  importDosRom(file: File): Promise<void>;
  removeDosRom(): Promise<void>;
  ejectDisk(): Promise<void>;
  downloadDisk(): Promise<void>;
  runDisk(index: number): Promise<void>;
  readonly keyboardColor: Accessor<"theme" | "light" | "dark">;
  setKeyboardColor(value: "theme" | "light" | "dark"): void;
  readonly soundEnabled: Accessor<boolean>;
  readonly volume: Accessor<number>;
  readonly ayEnabled: Accessor<boolean>;
  readonly ayVolume: Accessor<number>;
  readonly ayStereo: Accessor<AyStereo>;
  readonly ayMiddle: Accessor<number>;
  setAyEnabled(value: boolean): void;
  setAyVolume(value: number): void;
  setAyStereo(value: AyStereo): void;
  setAyMiddle(value: number): void;
  readonly audioStatus: Accessor<string>;
  setSoundEnabled(value: boolean): void;
  setVolume(value: number): void;
  unlockAudio(): void;
  readonly screenFocusRequest: Accessor<number>;
  focusScreen(): void;
  readonly files: Accessor<LibraryFile[]>;
  readonly filesBusy: Accessor<boolean>;
  readonly filesMessage: Accessor<string>;
  readonly pendingImport: Accessor<ImportBatch | null>;
  importFiles(files: readonly File[]): Promise<void>;
  confirmImport(replaceIds: readonly string[]): Promise<void>;
  cancelImport(): void;
  deleteFile(id: string): Promise<void>;
  loadFile(id: string): Promise<void>;
  readonly machine: Accessor<MachineLike | null>;
  readonly rom: Accessor<RomRecord | null>;
  readonly status: Accessor<RuntimeStatus>;
  readonly storage: Accessor<StorageStatus>;
  readonly error: Accessor<string | null>;
  readonly frameVersion: Accessor<number>;
  readonly isRunning: Accessor<boolean>;
  readonly fps: Accessor<number | null>;
  readonly videoPreset: Accessor<VideoPreset>;
  readonly turbo: Accessor<boolean>;
  readonly decodeFd: Accessor<boolean>;
  readonly rtcEnabled: Accessor<boolean>;
  readonly freeRun: Accessor<boolean>;
  readonly showBorder: Accessor<boolean>;
  readonly lateInt: Accessor<boolean>;
  readonly theme: Accessor<Theme>;
  readonly keyboardVersion: Accessor<number>;
  readonly keyboardLayout: Accessor<string>;
  setKeyboardLayout(id: string): void;
  run(): void;
  pause(): void;
  stepFrame(): void;
  coldBoot(): void;
  setVideoPreset(id: string): void;
  setLateInt(enabled: boolean): void;
  setDecodeFd(enabled: boolean): void;
  setRtcEnabled(enabled: boolean): void;
  setTurbo(enabled: boolean): void;
  setFreeRun(enabled: boolean): void;
  setReset(pressed: boolean): void;
  setShowBorder(enabled: boolean): void;
  setTheme(theme: Theme): void;
  importRom(file: File, as128?: boolean): Promise<void>;
  useBundled128Rom(): Promise<void>;
  refresh(): void;
  clearError(): void;
  dispose(): void;
}

function messageForError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export async function createAppStore(
  deps: CreateStoreDeps = {},
): Promise<Store> {
  const backend = deps.backend ?? openDefaultBackend();
  const config = loadConfig();
  const initialVideoPreset =
    VIDEO_PRESETS.find((p) => p.id === config.videoPreset) ??
    PENTAGON_VIDEO_PRESET;
  const makeMachine =
    deps.machineFactory ??
    ((options) =>
      typeof Worker !== "undefined"
        ? new WorkerMachine(options)
        : createMachine(options));
  const makeHostLoop =
    deps.hostLoopFactory ??
    ((machine, options) =>
      machine instanceof WorkerMachine
        ? machine.createLoop(options)
        : createHostLoop(machine, options));

  let disposeRoot: (() => void) | undefined;
  let store!: Store;
  let loop: HostLoopLike | undefined;
  let hydration: Promise<void> | undefined;
  let unsubscribeKeyboard: (() => void) | undefined;

  createRoot((rootDispose) => {
    disposeRoot = rootDispose;

    const [files, setFiles] = createSignal<LibraryFile[]>([]);
    const [filesBusy, setFilesBusy] = createSignal(false);
    const [filesMessage, setFilesMessage] = createSignal(
      backend.persistent
        ? "Files persist in this browser."
        : "Session-only file storage.",
    );
    const [pendingImport, setPendingImport] = createSignal<ImportBatch | null>(
      null,
    );
    const [mouseAccessed, setMouseAccessed] = createSignal(false);
    const [disk, setDisk] = createSignal<DiskState>();
    const [dosRom, setDosRom] = createSignal<RomRecord | null>(null);
    const [dosRomStatus, setDosRomStatus] = createSignal(
      "No ROM selected · basic loading available without ROM",
    );
    const [diskChangePending, setDiskChangePending] = createSignal(false);
    let resolveDiskChange:
      | ((choice: "download" | "discard" | "cancel") => void)
      | undefined;
    const downloadDisk = async () => {
      const active = machine();
      if (!active?.exportDisk || !active.diskState?.id) return;
      const bytes = await active.exportDisk();
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = (
        active.diskState.name.split("/").pop() ?? "disk.trd"
      ).replace(/\.(trd|scl)$/i, "-modified.trd");
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      refresh();
    };
    let resumeDiskAction = false;
    const finishDiskAction = () => {
      refresh();
      if (resumeDiskAction && !machine()?.diskState?.romRequired) store.run();
      resumeDiskAction = false;
    };
    const allowDiskChange = async () => {
      const active = machine();
      const wasRunning = isRunning();
      store.pause();
      if (active instanceof WorkerMachine) await active.pauseExecution();
      resumeDiskAction = wasRunning;
      if (!active?.diskState?.dirty) return true;
      setDiskChangePending(true);
      const choice = await new Promise<"download" | "discard" | "cancel">(
        (resolve) => {
          resolveDiskChange = resolve;
        },
      );
      resolveDiskChange = undefined;
      setDiskChangePending(false);
      if (choice === "download") await downloadDisk();
      if (choice === "cancel" && wasRunning) {
        store.run();
        resumeDiskAction = false;
      }
      return choice !== "cancel";
    };
    const commitImport = async (
      batch: ImportBatch,
      replaceIds: readonly string[],
    ) => {
      const existing = new Set(files().map((f) => f.id));
      const selected = batch.files.filter(
        (f) => !existing.has(f.id) || replaceIds.includes(f.id),
      );
      try {
        await backend.putFiles(selected);
        setFiles(await backend.listFiles());
        const replaced = selected.filter((f) => existing.has(f.id)).length;
        setFilesMessage(
          `${selected.length - replaced} added, ${replaced} replaced, ${batch.files.length - selected.length} skipped. ${batch.messages.join("; ")}${backend.persistent ? "" : " Session-only storage."}`,
        );
        setPendingImport(null);
      } catch (cause) {
        setError(messageForError(cause, "Files could not be saved."));
      } finally {
        setFilesBusy(false);
      }
    };
    const [screenFocusRequest, setScreenFocusRequest] = createSignal(0);
    const [machine, setMachine] = createSignal<MachineLike | null>(null);
    const kempston = new KempstonController(machine, config.kempston, () =>
      persistConfig(),
    );
    const [rom, setRom] = createSignal<RomRecord | null>(null);
    const [status, setStatus] = createSignal<RuntimeStatus>({
      frames: 0,
      pc: 0,
      ticks: 0,
      cpuLoad: null,
      memoryMapping: null,
      framePosition: 0,
      hasFrame: false,
      width: initialVideoPreset.width,
      height: initialVideoPreset.height,
    });
    const [storage, setStorage] = createSignal<StorageStatus>({
      state: "loading",
      persistent: backend.persistent,
      message: "Checking ROM persistence…",
    });
    const [error, setError] = createSignal<string | null>(null);
    const [frameVersion, setFrameVersion] = createSignal(0);
    const [isRunning, setIsRunning] = createSignal(false);
    const [fps, setFps] = createSignal<number | null>(null);
    const [videoPreset, setVideoPresetSignal] =
      createSignal<VideoPreset>(initialVideoPreset);
    const [decodeFd, setDecodeFdSignal] = createSignal(config.decodeFd);
    const [rtcEnabled, setRtcEnabledSignal] = createSignal(config.rtcEnabled);
    const [turbo, setTurboSignal] = createSignal(config.turbo);
    const [freeRun, setFreeRunSignal] = createSignal(config.freeRun);
    const [lateInt, setLateIntSignal] = createSignal(config.lateInt);
    const [showBorder, setShowBorder] = createSignal(config.showBorder);
    const [keyboardVersion, setKeyboardVersion] = createSignal(0);
    const [keyboardLayout, setKeyboardLayoutSignal] = createSignal(
      config.keyboardLayout,
    );
    const [theme, setThemeSignal] = createSignal<Theme>(config.theme);

    const [keyboardColor, setKeyboardColor] = createSignal(
      config.keyboardColor,
    );
    const [soundEnabled, setSoundEnabled] = createSignal(config.soundEnabled);
    const [volume, setVolume] = createSignal(config.volume);
    const [ayEnabled, setAyEnabled] = createSignal(config.ayEnabled);
    const [ayVolume, setAyVolume] = createSignal(config.ayVolume);
    const [ayStereo, setAyStereo] = createSignal<AyStereo>(config.ayStereo);
    const [ayMiddle, setAyMiddle] = createSignal(config.ayMiddle);
    const [sampleRate, setSampleRate] = createSignal(48000);
    const [audioStatus, setAudioStatus] = createSignal(
      "Click or press a key to enable audio",
    );
    const audio = new SoundOutput(setAudioStatus, setSampleRate);
    createEffect(() => {
      audio.setPlaying(
        (soundEnabled() || ayEnabled()) && isRunning() && !freeRun(),
      );
      const active = machine();
      active?.configureSound?.(
        {
          beeperEnabled: soundEnabled(),
          beeperVolume: volume(),
          ayEnabled: ayEnabled(),
          ayVolume: ayVolume(),
          ayStereo: ayStereo(),
          ayMiddle: ayMiddle(),
        },
        sampleRate(),
      );
      if (active instanceof WorkerMachine) {
        active.setAudioEnabled(
          (soundEnabled() || ayEnabled()) && isRunning() && !freeRun(),
        );
        active.setFreeRun(freeRun());
        active.setShowBorder(showBorder());
      }
    });

    const persistConfig = () => {
      try {
        saveConfig({
          version: 1,
          kempston: kempston.settings(),
          keyboardColor: keyboardColor(),
          soundEnabled: soundEnabled(),
          volume: volume(),
          ayEnabled: ayEnabled(),
          ayVolume: ayVolume(),
          ayStereo: ayStereo(),
          ayMiddle: ayMiddle(),
          videoPreset: videoPreset().id,
          turbo: turbo(),
          decodeFd: decodeFd(),
          rtcEnabled: rtcEnabled(),
          freeRun: freeRun(),
          showBorder: showBorder(),
          lateInt: lateInt(),
          theme: theme(),
          keyboardLayout: keyboardLayout(),
          keyboardProfile: KEYBOARD_PROFILE_ID,
        });
      } catch {
        setError(
          "Configuration could not be saved. Changes apply for this session only.",
        );
      }
    };

    let presentedMachine: MachineLike | null = null;
    let presentedPreset: VideoPreset | undefined;
    let presentedFrame = -1;
    let presentedHasFrame = false;
    const refreshPresentation = (active: MachineLike | null) => {
      const frame = active?.presentationVersion ?? active?.frameCount ?? -1;
      const hasFrame = active?.hasFrame ?? false;
      const preset = active?.videoPreset;
      if (
        active === presentedMachine &&
        frame === presentedFrame &&
        hasFrame === presentedHasFrame &&
        preset === presentedPreset
      )
        return;
      presentedMachine = active;
      presentedFrame = frame;
      presentedHasFrame = hasFrame;
      presentedPreset = preset;
      setFrameVersion((version) => version + 1);
    };

    let tickMachine: MachineLike | null = null;
    let elapsedTicks = 0;
    let lastMeterUpdate = -Infinity;
    let romRequired = false;
    const refresh = () => {
      const active = machine();
      setMouseAccessed(active?.mouseAccessed ?? false);
      const replaced = active !== tickMachine;
      if (replaced) {
        tickMachine = active;
        elapsedTicks = 0;
        romRequired = false;
      }
      if (!active) {
        setStatus({
          frames: 0,
          pc: 0,
          ticks: 0,
          cpuLoad: null,
          memoryMapping: null,
          framePosition: 0,
          hasFrame: false,
          width: videoPreset().width,
          height: videoPreset().height,
        });
        refreshPresentation(null);
        return;
      }
      const needsRom = active.diskState?.romRequired ?? false;
      if (needsRom && !romRequired) setError(ROM_REQUIRED);
      else if (!needsRom && romRequired && untrack(error) === ROM_REQUIRED)
        setError(null);
      romRequired = needsRom;
      setDisk(active.diskState);
      elapsedTicks += active.takeElapsedTicks();
      const running = loop?.isRunning() ?? false;
      const now = performance.now();
      const previous = untrack(status);
      // Reporting is throttled; execution accounting and video presentation are not.
      // A stopped machine always publishes exact values, including pause replies.
      if (
        !running ||
        replaced ||
        now - lastMeterUpdate >= MACHINE_METER_REFRESH_MS ||
        previous.hasFrame !== active.hasFrame ||
        previous.width !== active.width ||
        previous.height !== active.height
      ) {
        lastMeterUpdate = now;
        setStatus({
          frames: Math.max(0, Math.floor(active.frameCount)),
          pc: Math.max(0, Math.floor(active.cpu.regs?.pc ?? 0)) & 0xffff,
          ticks: elapsedTicks,
          cpuLoad: active.cpuLoad,
          memoryMapping: active.memoryMapping ?? null,
          framePosition: Math.max(0, Math.floor(active.framePosition)),
          hasFrame: active.hasFrame,
          width: active.width,
          height: active.height,
        });
      }
      refreshPresentation(active);
      setIsRunning(running);
    };

    const stopLoop = () => {
      audio.setPlaying(false);
      loop?.pause();
      loop?.dispose();
      loop = undefined;
      setIsRunning(false);
      setFps(null);
    };

    const installMachine = (bytes: Uint8Array, name: string): boolean => {
      let next: MachineLike;
      setError(null);
      try {
        next = makeMachine({
          rom: new Uint8Array(bytes),
          cpu7: turbo(),
          decodeFd: decodeFd(),
          rtcEnabled: rtcEnabled(),
          lateInt: lateInt(),
          videoPreset: videoPreset(),
        });
      } catch (cause) {
        setError(messageForError(cause, "The machine could not be created."));
        return false;
      }

      const selectedDos = dosRom();
      if (selectedDos) void next.setDosRom?.(selectedDos.bytes);
      stopLoop();
      setRom({ name, bytes: new Uint8Array(bytes), updatedAt: Date.now() });
      unsubscribeKeyboard?.();
      const previousKeyboard = machine()?.keyboard;
      if (previousKeyboard?.hostCapsLock !== undefined) {
        next.keyboard.observeHostCapsLock(previousKeyboard.hostCapsLock);
        next.keyboard.capsSyncActive = previousKeyboard.capsSyncActive;
      }
      kempston.reset();
      previousKeyboard?.releaseAll();
      machine()?.setPcmSink?.();
      machine()?.dispose?.();
      audio.reset();
      next.setPcmSink?.((samples, frames, rate) =>
        audio.consume(samples, frames, rate),
      );
      setMachine(next);
      kempston.install();
      unsubscribeKeyboard = next.keyboard.subscribe(() =>
        setKeyboardVersion((v) => v + 1),
      );
      setKeyboardVersion((v) => v + 1);
      try {
        loop = makeHostLoop(next, {
          onUpdate: refresh,
          onFps: setFps,
          freeRun,
          onError: (cause) => {
            setError(
              messageForError(cause, "The host loop stopped unexpectedly."),
            );
            if (cause instanceof Error && cause.message === ROM_REQUIRED) {
              loop?.pause();
              setIsRunning(false);
            } else stopLoop();
            refresh();
          },
        });
      } catch (cause) {
        setError(messageForError(cause, "The host loop could not be created."));
        loop = undefined;
      }
      refresh();
      return true;
    };

    const persistRom = async (record: RomRecord): Promise<void> => {
      try {
        await backend.saveRom(record);
        if (backend.persistent) {
          setStorage({
            state: "saved",
            persistent: true,
            message: "ROM saved in browser storage.",
          });
        } else {
          setStorage({
            state: "session-only",
            persistent: false,
            message:
              "ROM is active in session-only mode; browser persistence is unavailable.",
          });
        }
      } catch (cause) {
        setStorage({
          state: "error",
          persistent: backend.persistent,
          message: `ROM persistence failed: ${messageForError(cause, "storage unavailable")}. The ROM remains active in session-only mode.`,
        });
        setError(messageForError(cause, "ROM persistence failed."));
      }
    };

    const activateRom = (record: RomRecord): boolean =>
      installMachine(record.bytes, record.name);
    const activateWithDisk = async (record: RomRecord): Promise<boolean> => {
      const active = machine();
      if (!active?.diskState?.id || !active.exportDisk)
        return activateRom(record);
      store.pause();
      if (active instanceof WorkerMachine) await active.pauseExecution();
      const bytes = await active.exportDisk(false),
        media = active.diskState;
      if (active !== machine() || !activateRom(record)) return false;
      await machine()?.mountDisk?.(
        bytes,
        media.id,
        media.name,
        false,
        media.dirty,
      );
      refresh();
      return true;
    };

    store = {
      kempston,
      mouseAccessed,
      disk,
      dosRom,
      dosRomStatus,
      diskChangePending,
      resolveDiskChange(choice) {
        resolveDiskChange?.(choice);
      },
      async downloadDisk() {
        try {
          await downloadDisk();
        } catch (cause) {
          setError(messageForError(cause, "Download failed."));
        }
      },
      async ejectDisk() {
        if (filesBusy()) return;
        setFilesBusy(true);
        try {
          if (await allowDiskChange()) {
            await machine()?.ejectDisk?.();
            refresh();
          }
        } catch (cause) {
          setError(messageForError(cause, "Eject failed."));
        } finally {
          finishDiskAction();
          setFilesBusy(false);
        }
      },
      async runDisk(index) {
        if (filesBusy()) return;
        setFilesBusy(true);
        try {
          await machine()?.runDisk?.(index);
          store.run();
          store.focusScreen();
          refresh();
        } catch (cause) {
          setError(messageForError(cause, "Disk Run failed."));
        } finally {
          finishDiskAction();
          setFilesBusy(false);
        }
      },
      async importDosRom(file) {
        if (filesBusy()) return;
        setFilesBusy(true);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (bytes.length !== ROM_SIZE)
            throw new Error("TR-DOS ROM must be exactly 16 KiB.");
          const record = { name: file.name, bytes, updatedAt: Date.now() };
          await machine()?.setDosRom?.(bytes);
          setDosRom(record);
          setError(null);
          refresh();
          try {
            await backend.saveRom(record, "trdos");
            setDosRomStatus(
              backend.persistent
                ? "ROM saved in this browser"
                : "ROM loaded for this session only",
            );
          } catch {
            setDosRomStatus("ROM loaded for this session; saving failed");
          }
        } catch (cause) {
          setError(messageForError(cause, "TR-DOS ROM could not be loaded."));
        } finally {
          setFilesBusy(false);
        }
      },
      async removeDosRom() {
        if (filesBusy() || !dosRom()) return;
        setFilesBusy(true);
        const active = machine(),
          wasRunning = isRunning();
        store.pause();
        try {
          if (active instanceof WorkerMachine) await active.pauseExecution();
          await backend.deleteRom("trdos");
          await active?.setDosRom?.(null);
          setDosRom(null);
          setDosRomStatus(
            "No ROM selected · basic loading available without ROM",
          );
          refresh();
          if (wasRunning && !active?.diskState?.dosEnabled) store.run();
        } catch (cause) {
          setError(messageForError(cause, "TR-DOS ROM could not be removed."));
          if (wasRunning) store.run();
        } finally {
          setFilesBusy(false);
        }
      },
      keyboardColor,
      setKeyboardColor(value) {
        setKeyboardColor(value);
        persistConfig();
      },
      soundEnabled,
      volume,
      ayEnabled,
      ayVolume,
      ayStereo,
      ayMiddle,
      setAyEnabled(value) {
        setAyEnabled(value);
        persistConfig();
        if (value) void audio.unlock();
      },
      setAyVolume(value) {
        setAyVolume(Math.max(0, Math.min(1, value)));
        persistConfig();
      },
      setAyStereo(value) {
        setAyStereo(value);
        persistConfig();
      },
      setAyMiddle(value) {
        setAyMiddle(Math.max(0, Math.min(1, value)));
        persistConfig();
      },
      audioStatus,
      unlockAudio() {
        if (soundEnabled() || ayEnabled()) void audio.unlock();
      },
      setSoundEnabled(value) {
        setSoundEnabled(value);
        persistConfig();
        if (value) void audio.unlock();
      },
      setVolume(value) {
        setVolume(Math.max(0, Math.min(1, value)));
        persistConfig();
      },
      screenFocusRequest,
      focusScreen() {
        if (machine()) setScreenFocusRequest((v) => v + 1);
      },
      files,
      filesBusy,
      filesMessage,
      pendingImport,
      async importFiles(incoming) {
        if (filesBusy() || pendingImport()) return;
        setFilesBusy(true);
        try {
          const batch = await prepareImport(incoming);
          if (batch.files.some((f) => files().some((old) => old.id === f.id))) {
            setPendingImport(batch);
            setFilesBusy(false);
          } else await commitImport(batch, []);
        } catch (cause) {
          setError(messageForError(cause, "Import failed."));
          setFilesBusy(false);
        }
      },
      async confirmImport(replaceIds) {
        const batch = pendingImport();
        if (!batch || filesBusy()) return;
        setFilesBusy(true);
        await commitImport(batch, replaceIds);
      },
      cancelImport() {
        if (!filesBusy()) setPendingImport(null);
      },
      async deleteFile(id) {
        if (filesBusy() || pendingImport()) return;
        setFilesBusy(true);
        try {
          const active = machine();
          const mounted = active?.diskState?.id === id;
          if (mounted && !(await allowDiskChange())) return;
          await backend.deleteFile(id);
          if (mounted) await active?.ejectDisk?.();
          refresh();
          setFiles(await backend.listFiles());
        } catch (cause) {
          setError(messageForError(cause, "Delete failed."));
        } finally {
          finishDiskAction();
          setFilesBusy(false);
        }
      },
      async loadFile(id) {
        if (filesBusy()) return;
        setFilesBusy(true);
        try {
          const active = machine();
          if (!active?.loadTape)
            throw new Error(
              "Choose a supported 48K or 128K ROM before loading a tape.",
            );
          const file = await backend.getFile(id);
          if (!file)
            throw new Error("The file is no longer in browser storage.");
          if (active !== machine())
            throw new Error("Machine changed; please load again.");
          audio.reset();
          if (/\.(trd|scl)$/i.test(file.name)) {
            if (!active.mountDisk)
              throw new Error("Disk loading is unavailable.");
            const bytes = /\.scl$/i.test(file.name)
              ? sclToTrd(file.bytes)
              : file.bytes;
            if (!(await allowDiskChange())) return;
            await active.mountDisk(bytes, file.id, file.name);
            refresh();
            if (!trdBoot(active.diskState?.catalog ?? [])) return;
          } else await active.loadTape(file.bytes, file.name);
          if (active !== machine()) return;
          store.run();
          store.focusScreen();
        } catch (cause) {
          setError(messageForError(cause, "Load failed."));
        } finally {
          finishDiskAction();
          setFilesBusy(false);
        }
      },
      machine,
      rom,
      status,
      storage,
      error,
      frameVersion,
      isRunning,
      fps,
      videoPreset,
      turbo,
      decodeFd,
      rtcEnabled,
      setDecodeFd(enabled: boolean) {
        machine()?.setDecodeFd?.(enabled);
        setDecodeFdSignal(enabled);
        persistConfig();
      },
      setRtcEnabled(enabled: boolean) {
        machine()?.setRtcEnabled?.(enabled);
        setRtcEnabledSignal(enabled);
        persistConfig();
      },
      freeRun,
      showBorder,
      lateInt,
      setLateInt(_enabled: boolean) {
        machine()?.setLateInt(false);
        setLateIntSignal(false);
        persistConfig();
      },
      theme,
      keyboardVersion,
      keyboardLayout,
      setKeyboardLayout(id: string) {
        if (id !== "auto" && !isKeyboardLayout(id)) return;
        kempston.clearKeys();
        machine()?.keyboard.releaseAll();
        setKeyboardLayoutSignal(id);
        persistConfig();
      },
      run() {
        const active = machine();
        if (active?.diskState?.romRequired) {
          setError(ROM_REQUIRED);
          return;
        }
        if (!active || !loop) {
          setError("Choose a valid ROM before starting the machine.");
          return;
        }
        try {
          loop.start();
          setIsRunning(true);
          refresh();
        } catch (cause) {
          setError(messageForError(cause, "The machine could not start."));
        }
      },
      pause() {
        audio.setPlaying(false);
        try {
          loop?.pause();
        } finally {
          setIsRunning(false);
          refresh();
        }
      },
      stepFrame() {
        const active = machine();
        if (active?.diskState?.romRequired) {
          setError(ROM_REQUIRED);
          return;
        }
        if (!active) {
          setError("Choose a valid ROM before stepping.");
          return;
        }
        store.pause();
        try {
          active.advanceFrame();
          refresh();
        } catch (cause) {
          setError(
            messageForError(cause, "The machine could not advance a frame."),
          );
          refresh();
        }
      },
      setReset(pressed: boolean) {
        if (pressed) {
          audio.reset();
          kempston.reset();
        }
        machine()?.setReset(pressed);
        refresh();
      },
      coldBoot() {
        if (filesBusy()) return;
        const selected = rom();
        if (!selected) {
          setError("There is no ROM to cold boot.");
          return;
        }
        const active = machine();
        if (!active?.diskState?.id || !active.exportDisk) {
          if (activateRom(selected)) store.focusScreen();
          return;
        }
        store.pause();
        setFilesBusy(true);
        void (async () => {
          try {
            if (active instanceof WorkerMachine) await active.pauseExecution();
            const bytes = await active.exportDisk?.(false);
            const state = active.diskState;
            if (!bytes || !state) return;
            if (active !== machine()) return;
            if (activateRom(selected)) {
              await machine()?.mountDisk?.(
                bytes,
                state.id,
                state.name,
                false,
                state.dirty,
              );
              refresh();
              store.focusScreen();
            }
          } catch (cause) {
            setError(messageForError(cause, "Cold boot failed."));
          } finally {
            setFilesBusy(false);
          }
        })();
      },
      setVideoPreset(id: string) {
        const next = VIDEO_PRESETS.find((p) => p.id === id);
        if (!next || next.id === videoPreset().id) return;
        const wasRunning = isRunning();
        const active = machine();
        store.pause();
        try {
          active?.setVideoPreset(next);
          setVideoPresetSignal(next);
          const defaultLate = next.defaultLateInt;
          active?.setLateInt(defaultLate);
          setLateIntSignal(defaultLate);
          persistConfig();
          // Recreate only the host pacing adapter, whose frame budget changed.
          stopLoop();
          if (active)
            loop = makeHostLoop(active, {
              onUpdate: refresh,
              onFps: setFps,
              freeRun,
              onError: (cause) => {
                setError(
                  messageForError(cause, "The host loop stopped unexpectedly."),
                );
                if (cause instanceof Error && cause.message === ROM_REQUIRED) {
                  loop?.pause();
                  setIsRunning(false);
                } else stopLoop();
                refresh();
              },
            });
          refresh();
          if (wasRunning) store.run();
        } catch (cause) {
          setError(
            messageForError(cause, "The video preset could not be changed."),
          );
        }
      },
      setFreeRun(enabled: boolean) {
        setFreeRunSignal(enabled);
        persistConfig();
        setFps(null);
      },
      setTurbo(enabled: boolean) {
        setTurboSignal(enabled);
        persistConfig();
        const active = machine();
        if (active) {
          try {
            active.setTurbo(enabled);
          } catch (cause) {
            setError(
              messageForError(cause, "The CPU speed could not be changed."),
            );
          }
          refresh();
        }
      },
      setShowBorder(enabled: boolean) {
        setShowBorder(enabled);
        persistConfig();
      },
      setTheme(nextTheme: Theme) {
        const clean = sanitizeTheme(nextTheme);
        setThemeSignal(clean);
        applyTheme(clean);
        persistConfig();
      },
      async useBundled128Rom() {
        if (filesBusy()) return;
        try {
          const record = await loadBundledRom("128.rom");
          record.bytes = await complete128Rom(
            record.bytes,
            async () => (await loadBundledRom()).bytes,
          );
          if (filesBusy() || !(await activateWithDisk(record))) return;
          store.focusScreen();
          await persistRom(record);
        } catch (cause) {
          setError(
            messageForError(cause, "The bundled 128K ROM could not be loaded."),
          );
        }
      },
      async importRom(file: File, as128 = false) {
        if (filesBusy()) return;
        let bytes: Uint8Array;
        try {
          bytes = validateRomBytes(await file.arrayBuffer());
          if (as128)
            bytes = await complete128Rom(
              bytes,
              async () => (await loadBundledRom()).bytes,
            );
        } catch (cause) {
          setError(
            messageForError(
              cause,
              `ROM must be exactly ${ROM_SIZE} or ${ROM_SIZE * 2} bytes.`,
            ),
          );
          return;
        }
        if (filesBusy()) return;
        const record = validateRomRecord({
          name: file.name || "selected.rom",
          bytes,
        });
        try {
          if (!(await activateWithDisk(record))) return;
          store.focusScreen();
          await persistRom(record);
        } catch (cause) {
          setError(messageForError(cause, "ROM replacement failed."));
        }
      },
      refresh,
      clearError() {
        setError(null);
      },
      dispose() {
        kempston.dispose();
        resolveDiskChange?.("cancel");
        machine()?.keyboard.releaseAll();
        unsubscribeKeyboard?.();
        stopLoop();
        machine()?.setPcmSink?.();
        machine()?.dispose?.();
        audio.dispose();
        disposeRoot?.();
      },
    };

    applyTheme(theme());

    hydration = (async () => {
      try {
        setFiles(await backend.listFiles());
      } catch (cause) {
        setFilesMessage(
          messageForError(cause, "File library could not be restored."),
        );
      }

      try {
        const savedDos = await backend.loadRom("trdos");
        if (savedDos) {
          if (savedDos.bytes.length !== ROM_SIZE)
            throw new Error("Stored TR-DOS ROM has invalid size.");
          setDosRom(savedDos);
          setDosRomStatus(
            backend.persistent
              ? "ROM restored from this browser"
              : "Session-only ROM",
          );
        }
      } catch (cause) {
        setDosRomStatus(messageForError(cause, "TR-DOS ROM restore failed."));
      }
      try {
        const saved = await backend.loadRom();
        if (saved) {
          const record = validateRomRecord(saved);
          if (activateRom(record)) {
            setStorage({
              state: backend.persistent ? "saved" : "session-only",
              persistent: backend.persistent,
              message: backend.persistent
                ? "Restored ROM from browser storage."
                : "Restored ROM in session-only mode; browser persistence is unavailable.",
            });
          } else {
            setStorage({
              state: "error",
              persistent: backend.persistent,
              message:
                "The saved ROM was found, but the machine could not be created.",
            });
          }
        } else {
          try {
            const bundled = await (deps.loadBundledRom ?? loadBundledRom)();
            if (bundled) {
              const record = validateRomRecord(bundled);
              if (activateRom(record)) await persistRom(record);
            }
          } catch (cause) {
            setStorage({
              state: "error",
              persistent: backend.persistent,
              message: messageForError(
                cause,
                "Bundled ROM could not be loaded. Choose a ROM file to continue.",
              ),
            });
            setError(
              messageForError(
                cause,
                "Bundled ROM could not be loaded. Choose a ROM file to continue.",
              ),
            );
          }
        }
      } catch (cause) {
        setStorage({
          state: "error",
          persistent: backend.persistent,
          message: `ROM persistence failed: ${messageForError(cause, "storage unavailable")}. Imported ROMs will remain in session-only mode.`,
        });
        setError(messageForError(cause, "ROM storage could not be opened."));
      }
    })();
  });

  await hydration;
  return store;
}

const StoreContext = createContext<Store>();

export const StoreProvider = StoreContext.Provider;

export function useStore(): Store {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore called outside StoreProvider");
  return value;
}
