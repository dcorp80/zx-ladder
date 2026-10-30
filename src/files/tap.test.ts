import { expect, it } from "vitest";
import { parseTap } from "./tap";

function tap(flag: number, payload: number[]): Uint8Array {
  const length = payload.length + 2;
  return new Uint8Array([
    length & 255,
    length >>> 8,
    flag,
    ...payload,
    payload.reduce((a, b) => a ^ b, flag),
  ]);
}
it("validates all block boundaries and keeps checksum errors visible", () => {
  expect(parseTap(tap(255, [1, 2, 3]))[0]).toEqual({
    flag: 255,
    payload: new Uint8Array([1, 2, 3]),
    checksumValid: true,
  });
  for (const bytes of [[], [1], [1, 0, 0], [4, 0, 255, 1]])
    expect(() => parseTap(new Uint8Array(bytes))).toThrow();
  const bytes = tap(255, [1]);
  bytes[3] ^= 1;
  expect(parseTap(bytes)[0].checksumValid).toBe(false);
});
