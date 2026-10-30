import { expect, it } from "vitest";
import { parseTape } from "./tape";
import { parseTzx, TZX_SIGNATURE } from "./tzx";

const image = (...body: number[]) =>
  new Uint8Array([...TZX_SIGNATURE, 1, 20, ...body]);
const data = (byte: number) => [0x10, 0xe8, 3, 3, 0, 255, byte, 255 ^ byte];
const values = (bytes: Uint8Array) => parseTzx(bytes).map((b) => b.payload[0]);
it("reads standard, turbo and pure data blocks with metadata", () => {
  const turbo = [0x11, ...new Array(12).fill(0), 8, 0, 0, 3, 0, 0, 255, 2, 253];
  const pure = [0x14, 0, 0, 0, 0, 8, 0, 0, 3, 0, 0, 255, 3, 252];
  const custom = [0x35, ...new Array(16).fill(65), 2, 0, 0, 0, 0, 0];
  const bytes = image(
    0x30,
    2,
    72,
    105,
    ...custom,
    ...data(1),
    ...turbo,
    ...pure,
  );
  expect(values(bytes)).toEqual([1, 2, 3]);
  expect(parseTape(bytes, "TEST.TZX")).toEqual(parseTzx(bytes));
});
it("counts metadata in signed relative jumps and call targets", () => {
  // Jump forwards to a call, then backwards to a subroutine.
  expect(
    values(
      image(
        0x23,
        3,
        0,
        ...data(7),
        0x27,
        0x26,
        1,
        0,
        0xfe,
        0xff,
        ...data(9),
        0x20,
        0,
        0,
      ),
    ),
  ).toEqual([7, 9]);
  expect(
    values(
      image(
        0x26,
        2,
        0,
        3,
        0,
        5,
        0,
        ...data(3),
        0x20,
        0,
        0,
        ...data(1),
        0x27,
        ...data(2),
        0x27,
      ),
    ),
  ).toEqual([1, 2, 3]);
});
it("expands finite nested loops and never skips across stop markers", () => {
  expect(values(image(0x24, 2, 0, 0x24, 2, 0, ...data(4), 0x25, 0x25))).toEqual(
    [4, 4, 4, 4],
  );
  for (const stop of [
    [0x20, 0, 0],
    [0x2a, 0, 0, 0, 0],
  ])
    expect(values(image(...data(1), ...stop, ...data(2)))).toEqual([1]);
});
it("rejects bad control flow instead of hanging", () => {
  for (const body of [
    [0x23, 0, 0],
    [0x23, 0xff, 0xff],
    [0x27],
    [0x25],
    [0x24, 0, 0],
    [0x24, 2, 0, ...data(1)],
    [0x26, 1, 0, 0, 0],
  ])
    expect(() => parseTzx(image(...body))).toThrow(/TZX/);
});
it("rejects truncated data, unsupported formats and partial bytes", () => {
  const valid = image(...data(1));
  for (let end = 0; end < valid.length; end++)
    expect(() => parseTzx(valid.slice(0, end))).toThrow();
  for (const id of [0x15, 0x18, 0x19])
    expect(() => parseTzx(image(id))).toThrow("pulse playback");
  expect(() => parseTzx(image(0x28))).toThrow("selection menus");
  expect(() => parseTzx(image(0x40))).toThrow("snapshots");
  expect(() => parseTzx(image(0x11, ...new Array(12).fill(0), 7))).toThrow(
    "partial-byte",
  );
  expect(() =>
    parseTape(new Uint8Array([2, 0, 255, 255]), "bad.tzx"),
  ).toThrow();
  const corrupted = valid.slice();
  corrupted[corrupted.length - 1] ^= 1;
  expect(parseTzx(corrupted)[0].checksumValid).toBe(false);
});
