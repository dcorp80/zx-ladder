import { expect, it } from "vitest";
import { sclFixture } from "../test/scl";
import { parseScl, sclToTrd } from "./scl";
import { trdBasic, trdBoot, trdCatalog, trdGeometry } from "./trd";

it.each([true, false])(
  "converts SCL headers/data without changing the source (checksum little endian=%s)",
  (littleEndian) => {
    const source = sclFixture(littleEndian),
      saved = source.slice();
    expect(parseScl(source).warning).toBe("");
    const trd = sclToTrd(source),
      file = trdBoot(trdCatalog(trd));
    if (!file) throw new Error("Expected boot file");
    expect(trdGeometry(trd)).toEqual({ tracks: 80, sides: 2 });
    expect(trd.length).toBe(655360);
    expect(trd.slice(0, 14)).toEqual(source.slice(9, 23));
    expect(trd.slice(4096, 4352)).toEqual(source.slice(23, 279));
    expect(trd[14]).toBe(0);
    expect(trd[15]).toBe(1);
    expect(trdBasic(trd, file).line).toBe(10);
    expect(trd[0x8e5] | (trd[0x8e6] << 8)).toBe(2543);
    expect(trd[0x8e1]).toBe(1);
    expect(trd[0x8e2]).toBe(1);
    trd[4096] = 99;
    expect(source).toEqual(saved);
  },
);
it("keeps checksum problems nonfatal", () => {
  const source = sclFixture();
  source[source.length - 1] ^= 1;
  expect(parseScl(source).warning).toContain("mismatch");
  expect(sclToTrd(source).length).toBe(655360);
  expect(parseScl(source.slice(0, -4)).warning).toContain("absent");
});
it("rejects invalid signature, truncated headers/data, excess files and overflow", () => {
  const source = sclFixture();
  const bad = source.slice();
  bad[0] = 0;
  expect(() => parseScl(bad)).toThrow("signature");
  expect(() => parseScl(source.slice(0, 20))).toThrow("descriptors");
  expect(() => parseScl(source.slice(0, -10))).toThrow("sector data");
  const tooMany = new Uint8Array(9);
  tooMany.set(source.subarray(0, 9));
  tooMany[8] = 129;
  expect(() => parseScl(tooMany)).toThrow("128");
  const overflow = new Uint8Array(9 + 11 * 14 + 11 * 255 * 256);
  overflow.set(source.subarray(0, 8));
  overflow[8] = 11;
  for (let i = 0; i < 11; i++) overflow[9 + i * 14 + 13] = 255;
  expect(() => parseScl(overflow)).toThrow("capacity");
});
it("places files across track boundaries and accounts for a full disk", () => {
  const source = new Uint8Array(9 + 10 * 14 + 2544 * 256);
  source.set(Array.from("SINCLAIR", (c) => c.charCodeAt(0)));
  source[8] = 10;
  let offset = 149;
  for (let i = 0; i < 10; i++) {
    const p = 9 + i * 14;
    source[p] = 65 + i;
    source[p + 8] = 67;
    source[p + 13] = i === 9 ? 249 : 255;
    source.fill(i + 1, offset, offset + source[p + 13] * 256);
    offset += source[p + 13] * 256;
  }
  const trd = sclToTrd(source),
    files = trdCatalog(trd);
  expect(files).toHaveLength(10);
  expect(files[1].offset).toBe((16 + 255) * 256);
  expect(trd[files[1].offset]).toBe(2);
  expect(trd.at(-1)).toBe(10);
  expect(trd[0x8e5] | (trd[0x8e6] << 8)).toBe(0);
  expect(trd[0x8e1]).toBe(0);
  expect(trd[0x8e2]).toBe(160);
});
