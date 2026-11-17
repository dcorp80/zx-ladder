import type { SoundSettings } from "../audio/mixer";
import type { DiskDrive, DiskState } from "../devices/betaDisk";
import type { KempstonInput } from "../devices/kempston";
import type { SpectrumKey } from "../devices/keyboard";
import type { MemoryMapping } from "../devices/memory";
import type { VideoPreset } from "../devices/videoPresets";
import type { TapeState } from "../files/tape";

export type KeyboardCommand =
  | { action: "press"; source: string; keys: readonly SpectrumKey[] }
  | { action: "extended"; source: string; key: SpectrumKey; shifted: boolean }
  | { action: "release"; source: string }
  | { action: "releaseAll" }
  | { action: "caps"; value: boolean }
  | { action: "capsActive"; value: boolean }
  | { action: "capsToggle" };
export type Command =
  | { type: "kempston"; input: KempstonInput }
  | { type: "sound"; settings: SoundSettings; sampleRate: number }
  | {
      type: "init";
      rom: Uint8Array;
      mode48k?: boolean;
      rtcEnabled?: boolean;
      preset: VideoPreset;
      turbo: boolean;
      /** Transfer completed capture planes for main-thread RGBA expansion. */
      rawFrames?: boolean;
    }
  | { type: "run"; value: boolean }
  | { type: "step"; pixels?: number }
  | { type: "video"; preset: VideoPreset }
  | {
      type:
        | "border"
        | "technicalFields"
        | "extendedMode"
        | "turbo"
        | "mode48k"
        | "rtcEnabled"
        | "reset"
        | "freeRun"
        | "visible"
        | "audio";
      value: boolean;
    }
  | { type: "keyboard"; input: KeyboardCommand }
  | { type: "tape"; bytes: Uint8Array; name: string }
  | { type: "tapeMount"; bytes: Uint8Array; name: string }
  | { type: "tapeSeek"; index: number }
  | { type: "tapeRun"; index: number }
  | { type: "tapeEject" }
  | { type: "dosRom"; bytes: Uint8Array | null }
  | {
      type: "diskMount";
      bytes: Uint8Array;
      id: string;
      name: string;
      autoRun: boolean;
      dirty?: boolean;
      drive?: DiskDrive;
    }
  | { type: "diskRun"; index: number; drive?: DiskDrive }
  | { type: "diskEject"; drive?: DiskDrive }
  | { type: "diskExport"; saved: boolean; drive?: DiskDrive }
  | { type: "inspect"; address: number; length: number };
export type Request = { id: number; epoch: number; command: Command };
export type ToWorker =
  | Request
  | {
      recycle: "frame" | "audio";
      presented?: boolean;
      bytes: Uint8Array | Uint8ClampedArray | Float32Array;
    };
export interface MachineState {
  mouseAccessed?: boolean;
  disk?: DiskState;
  disks?: readonly [DiskState, DiskState];
  running?: boolean;
  frameCount: number;
  framePosition: number;
  /** Slots since the previous emitted snapshot, including obsolete epochs. */
  tickDelta: number;
  counters: number[];
  pc: number;
  cpu7: boolean;
  extendedMode?: boolean;
  showTechnicalFields: boolean;
  cpuLoad: number | null;
  active48kMode: boolean;
  memoryMapping: MemoryMapping;
  tape: string;
  tapeState?: Omit<TapeState, "catalog"> & { catalog?: TapeState["catalog"] };
  keys: SpectrumKey[];
  romCapsLock: boolean | undefined;
  fps: number | null;
}
export type FromWorker =
  | { type: "state"; epoch: number; state: MachineState }
  | {
      type: "frame";
      epoch: number;
      bytes: Uint8ClampedArray;
      /** bytes holds packed capture planes when true; otherwise RGBA. */
      raw?: boolean;
      /** Variable-length active planes/events rather than the legacy layout. */
      compact?: boolean;
      state: MachineState;
    }
  | {
      type: "audio";
      epoch: number;
      bytes: Float32Array;
      length: number;
      sampleRate: number;
    }
  | {
      type: "reply";
      id: number;
      state?: MachineState;
      memory?: Uint8Array;
      error?: string;
    }
  | { type: "error"; error: string };
