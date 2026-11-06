import type { SoundSettings } from "../audio/mixer";
import type { DiskState } from "../devices/betaDisk";
import type { SpectrumKey } from "../devices/keyboard";
import type { MemoryMapping } from "../devices/memory";
import type { VideoPreset } from "../devices/videoPresets";

export type KeyboardCommand =
  | { action: "press"; source: string; keys: readonly SpectrumKey[] }
  | { action: "extended"; source: string; key: SpectrumKey; shifted: boolean }
  | { action: "release"; source: string }
  | { action: "releaseAll" }
  | { action: "caps"; value: boolean }
  | { action: "capsActive"; value: boolean }
  | { action: "capsToggle" };
export type Command =
  | { type: "sound"; settings: SoundSettings; sampleRate: number }
  | {
      type: "init";
      rom: Uint8Array;
      decodeFd?: boolean;
      preset: VideoPreset;
      turbo: boolean;
      lateInt: boolean;
    }
  | { type: "run"; value: boolean }
  | { type: "step"; pixels?: number }
  | { type: "video"; preset: VideoPreset }
  | {
      type:
        | "border"
        | "turbo"
        | "decodeFd"
        | "reset"
        | "lateInt"
        | "freeRun"
        | "visible"
        | "audio";
      value: boolean;
    }
  | { type: "keyboard"; input: KeyboardCommand }
  | { type: "tape"; bytes: Uint8Array; name: string }
  | { type: "dosRom"; bytes: Uint8Array | null }
  | {
      type: "diskMount";
      bytes: Uint8Array;
      id: string;
      name: string;
      autoRun: boolean;
      dirty?: boolean;
    }
  | { type: "diskRun"; index: number }
  | { type: "diskEject" }
  | { type: "diskExport"; saved: boolean }
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
  disk?: DiskState;
  running?: boolean;
  frameCount: number;
  framePosition: number;
  /** Slots since the previous emitted snapshot, including obsolete epochs. */
  tickDelta: number;
  counters: number[];
  pc: number;
  cpu7: boolean;
  cpuLoad: number | null;
  memoryMapping: MemoryMapping;
  tape: string;
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
