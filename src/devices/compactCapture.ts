import type { CaptureEvents } from "./captureEvents";
import type { CaptureViews } from "./frameRenderer";
import type { CapturePlanes } from "./video";

const HEADER = 44;
const MAGIC = 0x31434c5a; // ZLC1, little endian.
const FE_EVENTS = 1;
const MODE_EVENTS = 2;
const RAW_ATTRIBUTES = 4;
const FLASH_PHASE = 8;
const KNOWN_FLAGS = FE_EVENTS | MODE_EVENTS | RAW_ATTRIBUTES | FLASH_PHASE;

/** Common frames need two symbol planes and small event histories. */
export const compactCaptureMinimum = (slots: number): number =>
  HEADER + (slots / 8) * 2;
export const compactCaptureCapacity = (slots: number): number =>
  compactCaptureMinimum(slots) + 1024;

export function compactCaptureByteLength(frame: CapturePlanes): number {
  const symbols = frame.pixels.length;
  const e = frame.events;
  return (
    HEADER +
    symbols * 2 +
    (e?.modeEvents ? e.modeCount * 4 : symbols) +
    (e && !e.feDense ? e.feCount * 5 : symbols * 8)
  );
}

/** Pack only active records. Unused capacity never belongs to the packet view. */
export function copyCompactCapture(
  frame: CapturePlanes,
  bytes: Uint8ClampedArray,
): void {
  const symbols = frame.pixels.length;
  const e = frame.events;
  const feEvents = !!e && !e.feDense;
  const modeEvents = !!e?.modeEvents;
  const length = compactCaptureByteLength(frame);
  if (bytes.length < length)
    throw new RangeError("Capture buffer is too small");
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  bytes.fill(0, 0, HEADER);
  data.setUint32(0, MAGIC, true);
  data.setUint32(4, symbols * 8, true);
  data.setUint32(8, feEvents ? e.feCount : 0, true);
  data.setUint32(12, modeEvents ? e.modeCount : 0, true);
  bytes[16] =
    (feEvents ? FE_EVENTS : 0) |
    (modeEvents ? MODE_EVENTS : 0) |
    (frame.flashPhase !== undefined ? RAW_ATTRIBUTES : 0) |
    (frame.flashPhase === 1 ? FLASH_PHASE : 0);
  bytes[17] = e?.initialFe ?? 0;
  bytes[18] = e?.initialExtended ?? 0;
  if (e && !e.intComplex) {
    bytes[19] = 255;
    data.setInt32(20, e.intStart, true);
    data.setInt32(24, e.intEnd, true);
  } else {
    if (frame.interruptCount > 3)
      throw new RangeError("Too many capture interrupt intervals");
    bytes[19] = frame.interruptCount;
    for (let i = 0; i < frame.interruptCount; i++) {
      data.setInt32(20 + i * 8, frame.interrupts[i].start, true);
      data.setInt32(24 + i * 8, frame.interrupts[i].endExclusive, true);
    }
  }
  bytes.set(frame.pixels, HEADER);
  bytes.set(frame.attributes, HEADER + symbols);
  let offset = HEADER + symbols * 2;
  if (modeEvents) {
    for (let i = 0; i < e.modeCount; i++, offset += 4)
      data.setUint32(offset, e.modeTimes[i], true);
  } else {
    bytes.set(frame.extended, offset);
    offset += symbols;
  }
  if (feEvents) {
    for (let i = 0; i < e.feCount; i++, offset += 5) {
      data.setUint32(offset, e.feTimes[i], true);
      bytes[offset + 4] = e.feValues[i];
    }
  } else bytes.set(frame.border, offset);
}

export interface CompactCaptureViews extends CaptureViews {
  /** The retained backing buffer can be larger than this packet's used bytes. */
  refresh(length?: number): void;
}

/** Reuse decoded events and plane views until the retained buffer grows. */
export function compactCaptureViews(
  bytes: Uint8ClampedArray,
  slots: number,
): CompactCaptureViews {
  const symbols = slots / 8;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const view = (offset: number, length: number) =>
    new Uint8Array(bytes.buffer, bytes.byteOffset + offset, length);
  const empty = new Uint8Array(0);
  const events: CaptureEvents = {
    slots,
    intStart: -1,
    intEnd: -1,
    intComplex: false,
    initialFe: 0,
    feCount: 0,
    feTimes: [],
    feValues: [],
    feDense: false,
    initialExtended: 0,
    modeCount: 0,
    modeTimes: [],
    modeEvents: true,
  };
  const frame: CompactCaptureViews = {
    flashPhase: undefined,
    pixels: view(HEADER, symbols),
    attributes: view(HEADER + symbols, symbols),
    extended: empty,
    border: empty,
    events,
    interruptCount: 0,
    interrupts: Array.from({ length: 3 }, () => ({
      start: 0,
      endExclusive: 0,
    })),
    refresh(length = bytes.length) {
      if (
        length < HEADER + symbols * 2 ||
        length > bytes.length ||
        data.getUint32(0, true) !== MAGIC ||
        data.getUint32(4, true) !== slots ||
        bytes[16] & ~KNOWN_FLAGS ||
        (bytes[16] & FLASH_PHASE && !(bytes[16] & RAW_ATTRIBUTES))
      )
        throw new RangeError("Invalid compact capture header");
      const flags = bytes[16];
      const feCount = data.getUint32(8, true);
      const modeCount = data.getUint32(12, true);
      const modeEvents = !!(flags & MODE_EVENTS);
      const feEvents = !!(flags & FE_EVENTS);
      const expected =
        HEADER +
        symbols * 2 +
        (modeEvents ? modeCount * 4 : symbols) +
        (feEvents ? feCount * 5 : slots);
      if (
        expected !== length ||
        modeCount > symbols ||
        feCount > slots ||
        (!modeEvents && modeCount !== 0) ||
        (!feEvents && feCount !== 0) ||
        (bytes[19] !== 255 && bytes[19] > 3)
      )
        throw new RangeError("Invalid compact capture length or event count");
      events.modeEvents = modeEvents;
      this.flashPhase =
        flags & RAW_ATTRIBUTES ? (flags & FLASH_PHASE ? 1 : 0) : undefined;
      events.modeCount = modeCount;
      events.initialExtended = bytes[18];
      let offset = HEADER + symbols * 2;
      if (modeEvents) {
        this.extended = empty;
        for (let i = 0; i < modeCount; i++, offset += 4)
          events.modeTimes[i] = data.getUint32(offset, true);
      } else {
        if (this.extended.length !== symbols)
          this.extended = view(offset, symbols);
        offset += symbols;
      }
      events.feDense = !feEvents;
      events.feCount = feCount;
      events.initialFe = bytes[17];
      if (feEvents) {
        this.border = empty;
        for (let i = 0; i < feCount; i++, offset += 5) {
          events.feTimes[i] = data.getUint32(offset, true);
          events.feValues[i] = bytes[offset + 4];
        }
      } else if (
        this.border.length !== slots ||
        !(this.border instanceof Uint8Array) ||
        this.border.byteOffset !== bytes.byteOffset + offset
      )
        this.border = view(offset, slots);
      events.intComplex = bytes[19] !== 255;
      if (!events.intComplex) {
        events.intStart = data.getInt32(20, true);
        events.intEnd = data.getInt32(24, true);
        this.interruptCount = events.intStart < 0 ? 0 : 1;
        this.interrupts[0].start = events.intStart;
        this.interrupts[0].endExclusive = events.intEnd;
      } else {
        events.intStart = events.intEnd = -1;
        this.interruptCount = bytes[19];
        for (let i = 0; i < this.interruptCount; i++) {
          this.interrupts[i].start = data.getInt32(20 + i * 8, true);
          this.interrupts[i].endExclusive = data.getInt32(24 + i * 8, true);
        }
      }
    },
  };
  return frame;
}
