import {
  type Accessor,
  createContext,
  createEffect,
  createRoot,
  createSignal,
  useContext,
} from "solid-js";
import { BeeperOutput } from "../audio/output";
import type { KeyboardDevice } from "../devices/keyboard";
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
import { isKeyboardLayout, KEYBOARD_PROFILE_ID } from "../input/keyboardLayout";
import type { RasterTiming } from "../machine/config";
import { Counter } from "../machine/counters";
import { createMachine } from "../machine/machine";
import { loadBundledRom } from "../rom/bundledRom";
import { createHostLoop } from "../runloop/hostLoop";
import {
  applyTheme,
  loadConfig,
  sanitizeTheme,
  saveConfig,
  type Theme,
} from "../storage/config";
import { openDefaultBackend } from "../storage/indexeddb";
import {
  ROM_SIZE,
  type RomRecord,
  type StorageBackend,
  validateRomBytes,
  validateRomRecord,
} from "../storage/types";
import { WorkerMachine } from "../worker/client";

export type { Theme } from "../storage/config";

/** The part of the machine contract the UI needs. */
export interface MachineLike {
  setAudioSink?(sink?: (latch: Uint8Array, slotHz: number) => void): void;
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
  readonly hasFrame: boolean;
  setLateInt(enabled: boolean): void;
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
  readonly keyboardColor: Accessor<"theme" | "light" | "dark">;
  setKeyboardColor(value: "theme" | "light" | "dark"): void;
  readonly soundEnabled: Accessor<boolean>;
  readonly volume: Accessor<number>;
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
  setTurbo(enabled: boolean): void;
  setFreeRun(enabled: boolean): void;
  setReset(pressed: boolean): void;
  setShowBorder(enabled: boolean): void;
  setTheme(theme: Theme): void;
  importRom(file: File): Promise<void>;
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
    const [rom, setRom] = createSignal<RomRecord | null>(null);
    const [status, setStatus] = createSignal<RuntimeStatus>({
      frames: 0,
      pc: 0,
      ticks: 0,
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
    const [audioStatus, setAudioStatus] = createSignal(
      "Click or press a key to enable audio",
    );
    const audio = new BeeperOutput(setAudioStatus);
    createEffect(() => {
      audio.setPlaying(soundEnabled() && isRunning() && !freeRun());
      audio.setVolume(volume());
      const active = machine();
      if (active instanceof WorkerMachine) {
        active.setAudioEnabled(soundEnabled() && isRunning() && !freeRun());
        active.setFreeRun(freeRun());
        active.setShowBorder(showBorder());
      }
    });

    const persistConfig = () => {
      try {
        saveConfig({
          version: 1,
          keyboardColor: keyboardColor(),
          soundEnabled: soundEnabled(),
          volume: volume(),
          videoPreset: videoPreset().id,
          turbo: turbo(),
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

    const refresh = () => {
      const active = machine();
      if (!active) {
        setStatus({
          frames: 0,
          pc: 0,
          ticks: 0,
          framePosition: 0,
          hasFrame: false,
          width: videoPreset().width,
          height: videoPreset().height,
        });
        refreshPresentation(null);
        return;
      }
      const position = Math.max(0, Math.floor(active.framePosition));
      const frames = Math.max(0, Math.floor(active.frameCount));
      setStatus({
        frames,
        pc: Math.max(0, Math.floor(active.cpu.regs?.pc ?? 0)) & 0xffff,
        ticks: active.counters[Counter.pixels],
        framePosition: position,
        hasFrame: active.hasFrame,
        width: active.width,
        height: active.height,
      });
      refreshPresentation(active);
      setIsRunning(loop?.isRunning() ?? false);
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
          lateInt: lateInt(),
          videoPreset: videoPreset(),
        });
      } catch (cause) {
        setError(messageForError(cause, "The machine could not be created."));
        return false;
      }

      stopLoop();
      setRom({ name, bytes: new Uint8Array(bytes), updatedAt: Date.now() });
      unsubscribeKeyboard?.();
      const previousKeyboard = machine()?.keyboard;
      if (previousKeyboard?.hostCapsLock !== undefined) {
        next.keyboard.observeHostCapsLock(previousKeyboard.hostCapsLock);
        next.keyboard.capsSyncActive = previousKeyboard.capsSyncActive;
      }
      previousKeyboard?.releaseAll();
      machine()?.setAudioSink?.();
      machine()?.dispose?.();
      audio.reset();
      next.setAudioSink?.((latch, slotHz) => audio.consumeFrame(latch, slotHz));
      setMachine(next);
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
            stopLoop();
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

    store = {
      keyboardColor,
      setKeyboardColor(value) {
        setKeyboardColor(value);
        persistConfig();
      },
      soundEnabled,
      volume,
      audioStatus,
      unlockAudio() {
        if (soundEnabled()) void audio.unlock();
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
          await backend.deleteFile(id);
          setFiles(await backend.listFiles());
        } catch (cause) {
          setError(messageForError(cause, "Delete failed."));
        } finally {
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
              "Choose a supported 48K ROM before loading a tape.",
            );
          const file = await backend.getFile(id);
          if (!file)
            throw new Error("The file is no longer in browser storage.");
          if (active !== machine())
            throw new Error("Machine changed; please load again.");
          audio.reset();
          await active.loadTape(file.bytes, file.name);
          if (active !== machine()) return;
          store.run();
          store.focusScreen();
        } catch (cause) {
          setError(messageForError(cause, "Load failed."));
        } finally {
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
        machine()?.keyboard.releaseAll();
        setKeyboardLayoutSignal(id);
        persistConfig();
      },
      run() {
        const active = machine();
        if (!active || !loop) {
          setError("Choose a valid 16 KiB ROM before starting the machine.");
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
        if (!active) {
          setError("Choose a valid 16 KiB ROM before stepping.");
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
        }
      },
      setReset(pressed: boolean) {
        if (pressed) audio.reset();
        machine()?.setReset(pressed);
      },
      coldBoot() {
        const selected = rom();
        if (!selected) {
          setError("There is no ROM to cold boot.");
          return;
        }
        if (activateRom(selected)) store.focusScreen();
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
                stopLoop();
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
      async importRom(file: File) {
        let bytes: Uint8Array;
        try {
          bytes = validateRomBytes(await file.arrayBuffer());
        } catch (cause) {
          setError(
            messageForError(cause, `ROM must be exactly ${ROM_SIZE} bytes.`),
          );
          return;
        }
        const record = validateRomRecord({
          name: file.name || "selected.rom",
          bytes,
        });
        if (!activateRom(record)) return;
        store.focusScreen();
        await persistRom(record);
      },
      refresh,
      clearError() {
        setError(null);
      },
      dispose() {
        machine()?.keyboard.releaseAll();
        unsubscribeKeyboard?.();
        stopLoop();
        machine()?.setAudioSink?.();
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
