import { expect, it } from "vitest";
import { createCaptureEvents } from "./captureEvents";
import {
  compactCaptureByteLength,
  compactCaptureCapacity,
  compactCaptureViews,
  copyCompactCapture,
} from "./compactCapture";
import {
  captureByteLength,
  createRasterMasks,
  renderCapturedFrame,
} from "./frameRenderer";
import type { CapturePlanes } from "./video";
import { LVIV_VIDEO_PRESET, PENTAGON_VIDEO_PRESET } from "./videoPresets";

it.each([PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET])(
  "retains output through sparse, dense and legacy packet reuse in $id",
  (preset) => {
    const slots = preset.pixelsPerFrame,
      symbols = slots / 8;
    const capacity = 44 + symbols * 6 + slots;
    const sendStorage = new Uint8ClampedArray(capacity + 13).fill(231);
    const send = sendStorage.subarray(5, 5 + capacity);
    const receive = new Uint8ClampedArray(capacity + 7).subarray(
      3,
      3 + capacity,
    );
    const decoded = compactCaptureViews(receive, slots);
    const identities = [
      decoded.pixels,
      decoded.attributes,
      decoded.events,
      decoded.interrupts[0],
    ];
    const pixels = Uint8Array.from(
      { length: symbols },
      (_, i) => (i * 73) & 255,
    );
    const attributes = Uint8Array.from(
      { length: symbols },
      (_, i) => (i * 37) & 255,
    );
    const extended = Uint8Array.from({ length: symbols }, (_, i) => i & 1);
    const border = Uint8Array.from({ length: slots }, (_, i) => i & 7);
    const masks = createRasterMasks(preset);
    for (const kind of [
      "sparse",
      "maximum",
      "dense",
      "legacy",
      "mixed",
      "sparse",
    ]) {
      const e = createCaptureEvents(slots);
      e.initialFe = 3;
      e.initialExtended = 1;
      e.intStart = 11;
      e.intEnd = 57;
      if (kind === "maximum") {
        e.feCount = Math.floor((slots - 6) / 5);
        for (let i = 0; i < e.feCount; i++) {
          e.feTimes[i] = i * 5;
          e.feValues[i] = i & 7;
        }
        e.modeCount = symbols;
        for (let i = 0; i < symbols; i++) e.modeTimes[i] = i;
      } else if (kind === "dense") e.feDense = true;
      else if (kind === "mixed") {
        e.modeEvents = false;
        e.feCount = 2;
        e.feTimes[0] = 9;
        e.feTimes[1] = slots - 1;
        e.feValues[0] = 7;
        e.feValues[1] = 2;
      }
      const frame: CapturePlanes = {
        pixels,
        attributes,
        border,
        extended,
        events: kind === "legacy" ? undefined : e,
        interruptCount: 3,
        interrupts: [
          { start: 0, endExclusive: 5 },
          { start: 37, endExclusive: 49 },
          { start: slots - 7, endExclusive: slots },
        ],
      };
      if (kind === "maximum") e.intComplex = true;
      const length = compactCaptureByteLength(frame);
      copyCompactCapture(frame, send);
      // Copy only this packet, leaving old bytes in the retained receive buffer.
      receive.set(send.subarray(0, length));
      decoded.refresh(length);
      for (const showBorder of [false, true])
        for (const technical of [false, true]) {
          const actual = renderCapturedFrame(
            decoded,
            masks,
            new Uint8ClampedArray(slots * 4),
            showBorder,
            technical,
          );
          const expected = renderCapturedFrame(
            frame,
            masks,
            new Uint8ClampedArray(slots * 4),
            showBorder,
            technical,
          );
          const mismatch = actual.findIndex(
            (value, index) => value !== expected[index],
          );
          expect({ kind, showBorder, technical, mismatch }).toEqual({
            kind,
            showBorder,
            technical,
            mismatch: -1,
          });
        }
      expect(decoded.pixels).toBe(identities[0]);
      expect(decoded.attributes).toBe(identities[1]);
      expect(decoded.events).toBe(identities[2]);
      expect(decoded.interrupts[0]).toBe(identities[3]);
      expect(sendStorage.subarray(0, 5)).toEqual(
        new Uint8ClampedArray(5).fill(231),
      );
      expect(sendStorage.subarray(5 + capacity)).toEqual(
        new Uint8ClampedArray(8).fill(231),
      );
      if (kind === "sparse") {
        expect(length).toBe(44 + symbols * 2);
        expect(compactCaptureCapacity(slots)).toBeLessThan(
          captureByteLength(slots) / 6,
        );
        expect(decoded.events?.feTimes.length).toBeLessThanOrEqual(
          Math.floor((slots - 6) / 5),
        );
      }
    }
  },
);

it("rejects truncated, wrong-geometry and inconsistent compact packets", () => {
  const slots = 16;
  const frame: CapturePlanes = {
    pixels: [1, 2],
    attributes: [3, 4],
    extended: [0, 0],
    border: new Uint8Array(slots),
    events: createCaptureEvents(slots),
    interruptCount: 0,
    interrupts: [],
  };
  const bytes = new Uint8ClampedArray(compactCaptureCapacity(slots));
  const length = compactCaptureByteLength(frame);
  copyCompactCapture(frame, bytes);
  const views = compactCaptureViews(bytes, slots);
  views.refresh(length);
  expect(() => views.refresh(length - 1)).toThrow(RangeError);
  const data = new DataView(bytes.buffer);
  for (const [offset, bad] of [
    [0, 0],
    [4, 24],
    [8, 0xffffffff],
    [12, 3],
  ]) {
    const original = data.getUint32(offset, true);
    data.setUint32(offset, bad, true);
    expect(() => views.refresh(length)).toThrow(RangeError);
    data.setUint32(offset, original, true);
  }
  expect(() =>
    copyCompactCapture(frame, new Uint8ClampedArray(length - 1)),
  ).toThrow(RangeError);
});
