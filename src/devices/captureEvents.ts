/** Frame-owned presentation events with retained storage; no live device storage escapes. */
export interface CaptureEvents {
  slots: number;
  intStart: number;
  intEnd: number;
  intComplex: boolean;
  initialFe: number;
  feCount: number;
  feTimes: number[];
  feValues: number[];
  feDense: boolean;
  initialExtended: number;
  modeCount: number;
  /** Effective symbol indices (multiply by eight for raster slots). */
  modeTimes: number[];
  /** False only for compatibility with dense input frames, not an overflow path. */
  modeEvents: boolean;
}
export function createCaptureEvents(slots: number): CaptureEvents {
  return {
    slots,
    intStart: -1,
    intEnd: -1,
    intComplex: false,
    initialFe: 0,
    feCount: 0,
    feTimes: new Array<number>(Math.floor((slots - 6) / 5)).fill(0),
    feValues: new Array<number>(Math.floor((slots - 6) / 5)).fill(0),
    feDense: false,
    initialExtended: 0,
    modeCount: 0,
    modeTimes: [],
    modeEvents: true,
  };
}
export function expandEvents(
  events: CaptureEvents,
  border: {
    [index: number]: number;
    fill(value: number, start?: number, end?: number): unknown;
  },
  extended: {
    [index: number]: number;
    fill(value: number, start?: number, end?: number): unknown;
  },
): void {
  if (!events.feDense) {
    let start = 0,
      value = events.initialFe;
    for (let i = 0; i < events.feCount; i++) {
      border.fill(value & 7, start, events.feTimes[i]);
      start = events.feTimes[i];
      value = events.feValues[i];
    }
    border.fill(value & 7, start, events.slots);
  }
  if (events.modeEvents) {
    let start = 0,
      value = events.initialExtended;
    for (let i = 0; i < events.modeCount; i++) {
      extended.fill(value, start, events.modeTimes[i]);
      start = events.modeTimes[i];
      value ^= 1;
    }
    extended.fill(value, start, events.slots / 8);
  }
}
