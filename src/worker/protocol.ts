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
  | { type: "inspect"; address: number; length: number };
export type Request = { id: number; epoch: number; command: Command };
export type ToWorker =
  | Request
  | {
      recycle: "frame" | "audio";
      presented?: boolean;
      bytes: Uint8Array | Uint8ClampedArray;
    };
export interface MachineState {
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
      bytes: Uint8Array;
      length: number;
      slotHz: number;
    }
  | {
      type: "reply";
      id: number;
      state?: MachineState;
      memory?: Uint8Array;
      error?: string;
    }
  | { type: "error"; error: string };
