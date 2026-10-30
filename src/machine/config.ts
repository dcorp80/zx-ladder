import type { VideoPreset } from "../devices/videoPresets";

/** Fixed initial machine: uncontended 48K, one shared memory slot per pixel. */
export const MACHINE_CONFIG = Object.freeze({
  id: "uncontended-48k",
  label: "48K · no contention",
  slotHz: 7_000_000,
  borderPort: { mask: 1, value: 0 },
});

export interface RasterTiming {
  readonly pixelHz: number;
  readonly pixelsPerFrame: number;
  readonly frameHz: number;
}

export function rasterTiming(video: VideoPreset): RasterTiming {
  return {
    pixelHz: MACHINE_CONFIG.slotHz,
    pixelsPerFrame: video.pixelsPerFrame,
    frameHz: MACHINE_CONFIG.slotHz / video.pixelsPerFrame,
  };
}
