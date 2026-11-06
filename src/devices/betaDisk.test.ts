import { expect, it } from "vitest";
import { diskFixture } from "../test/trd";
import { BetaDisk } from "./betaDisk";

it("reads and writes sectors, side selection, errors and drive A only", () => {
  const d = new BetaDisk(),
    original = diskFixture();
  d.mount(original, "one", "one.trd");
  d.write(0xff, 0x14);
  d.write(0x5f, 1);
  d.write(0x1f, 0x80);
  const bytes = Array.from({ length: 256 }, () => d.read(0x7f));
  expect(bytes).toEqual(Array.from(original.slice(0, 256)));
  expect(d.read(0xff)).toBe(128);
  expect(d.read(0x1f)).toBe(0);
  expect(d.read(0xff)).toBe(0);
  d.write(0x1f, 0xa0);
  for (let i = 0; i < 256; i++) d.write(0x7f, 42);
  expect(d.image[0]).toBe(42);
  expect(original[0]).not.toBe(42);
  expect(d.dirty).toBe(true);
  d.write(0xff, 0x15);
  d.write(0x1f, 0x80);
  expect(d.read(0x1f) & 128).toBe(128);
  d.write(0xff, 0x14);
  d.write(0x5f, 0);
  d.write(0x1f, 0x80);
  expect(d.read(0x1f) & 16).toBe(16);
  d.reset();
  expect(d.dirty).toBe(true);
  expect(d.image[0]).toBe(42);
});
it("retains step direction and obeys track-register update bit", () => {
  const d = new BetaDisk();
  d.mount(diskFixture(), "a", "a.trd");
  d.write(0x1f, 0x40);
  expect(d.head).toBe(1);
  expect(d.track).toBe(0);
  d.write(0x1f, 0x30);
  expect(d.head).toBe(2);
  expect(d.track).toBe(2);
  d.write(0x1f, 0x70);
  expect(d.head).toBe(1);
  expect(d.track).toBe(1);
});

it("zero-fills omitted trailing sectors and extends shortened disks on writes", () => {
  const original = diskFixture().slice(0, 0x1200);
  const d = new BetaDisk();
  d.mount(original, "short", "short.trd");
  d.write(0xff, 0x14);
  d.write(0x7f, 2);
  d.write(0x1f, 0x10);
  d.write(0x5f, 1);
  d.write(0x1f, 0x80);
  expect(Array.from({ length: 256 }, () => d.read(0x7f))).toEqual(
    new Array(256).fill(0),
  );
  expect(d.read(0xff)).toBe(128);
  expect(d.image.length).toBe(original.length);
  d.write(0x1f, 0xa0);
  for (let i = 0; i < 256; i++) d.write(0x7f, 37);
  expect(d.image.length).toBe(2 * 2 * 4096 + 256);
  expect(d.image[2 * 2 * 4096]).toBe(37);
  expect(d.image[original.length]).toBe(0);
  expect(d.dirty).toBe(true);
  expect(original.length).toBe(0x1200);
});
