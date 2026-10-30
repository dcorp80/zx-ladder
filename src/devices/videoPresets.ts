export interface VideoPreset {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly pixelsPerFrame: number;
  readonly hReload: number;
  readonly hLimit: number;
  readonly hOrigin: number;
  readonly vOrigin: number;
  readonly vAdvance: number;
  readonly hBorder: readonly [number, number];
  readonly hBlank: readonly [number, number];
  readonly hSync: readonly [number, number];
  readonly vPaperEnd: number;
  readonly vBlank: readonly [number, number];
  readonly vSync: readonly [number, number];
  readonly interruptLine: number;
  readonly lateInterruptLine: number;
  readonly lateInterruptH: number;
  readonly defaultLateInt: boolean;
  readonly flashLine: number;
  readonly flashBit: number;
}

export const PENTAGON_VIDEO_PRESET: VideoPreset = Object.freeze({
  id: "pentagon",
  label: "Pentagon",
  width: 448,
  height: 320,
  pixelsPerFrame: 143_360,
  hReload: 32,
  hLimit: 256,
  hOrigin: 68,
  vOrigin: 246,
  vAdvance: 64,
  hBorder: [36, 132] as const,
  hBlank: [63, 102] as const,
  hSync: [68, 84] as const,
  vPaperEnd: 192,
  vBlank: [240, 256] as const,
  vSync: [246, 248] as const,
  interruptLine: 240,
  lateInterruptLine: 242,
  lateInterruptH: 112,
  defaultLateInt: false,
  flashLine: 240,
  flashBit: 4,
});

export const LVIV_VIDEO_PRESET: VideoPreset = Object.freeze({
  id: "lviv",
  label: "Lviv",
  width: 448,
  height: 312,
  pixelsPerFrame: 448 * 312,
  hReload: 0,
  hLimit: 224,
  hOrigin: 160,
  vOrigin: 244,
  vAdvance: 160,
  hBorder: [132, 4] as const,
  hBlank: [152, 200] as const,
  hSync: [160, 176] as const,
  vPaperEnd: 192,
  vBlank: [240, 264] as const,
  vSync: [244, 248] as const,
  interruptLine: 248,
  lateInterruptLine: 0, // V=312 wraps to zero.
  lateInterruptH: 160,
  defaultLateInt: false,
  flashLine: 240,
  flashBit: 4,
});

export const VIDEO_PRESETS: readonly VideoPreset[] = [
  PENTAGON_VIDEO_PRESET,
  LVIV_VIDEO_PRESET,
];

export function validateVideoPreset(p: VideoPreset): void {
  const ints = [
    p.width,
    p.height,
    p.hReload,
    p.hLimit,
    p.hOrigin,
    p.vOrigin,
    p.vAdvance,
    p.interruptLine,
    p.lateInterruptLine,
    p.lateInterruptH,
    p.flashLine,
    p.flashBit,
    p.vPaperEnd,
  ];
  if (
    ints.some((v) => !Number.isInteger(v)) ||
    p.width <= 0 ||
    p.height <= 0 ||
    p.width % 8 !== 0 ||
    p.width !== (p.hLimit - p.hReload) * 2 ||
    p.pixelsPerFrame !== p.width * p.height ||
    p.hOrigin < p.hReload ||
    p.hOrigin >= p.hLimit ||
    p.hOrigin % 4 !== 0 ||
    p.vAdvance < p.hReload ||
    p.vAdvance >= p.hLimit ||
    p.vOrigin < 0 ||
    p.vOrigin >= p.height ||
    p.lateInterruptLine < 0 ||
    p.lateInterruptLine >= p.height ||
    p.lateInterruptH < p.hReload ||
    p.lateInterruptH >= p.hLimit ||
    p.interruptLine < 0 ||
    p.interruptLine >= p.height ||
    p.flashLine < 0 ||
    p.flashLine >= p.height ||
    p.flashBit < 0 ||
    p.flashBit > 30 ||
    p.vPaperEnd < 0 ||
    p.vPaperEnd > p.height ||
    p.vAdvance % 4 !== 0
  ) {
    throw new RangeError("Invalid video timing preset");
  }
  for (const [start, end] of [p.hBorder, p.hBlank, p.hSync]) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < p.hReload ||
      start >= p.hLimit ||
      end < p.hReload ||
      end > p.hLimit ||
      start === end
    )
      throw new RangeError("Invalid horizontal signal window");
  }
  for (const [start, end] of [p.vBlank, p.vSync]) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > p.height ||
      start >= end
    )
      throw new RangeError("Invalid vertical signal window");
  }
}
