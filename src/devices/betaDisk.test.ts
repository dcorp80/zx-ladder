import { expect, it } from "vitest";
import { diskFixture } from "../test/trd";
import { BetaDisk } from "./betaDisk";

it("reads and writes sectors, side selection, errors and an empty drive B", () => {
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

it("keeps writable media and physical head positions independent for A and B", () => {
  const d = new BetaDisk();
  const a = diskFixture(),
    b = diskFixture();
  a[256] = 11;
  b[256] = 22;
  d.mount(a, "a", "a.trd");
  d.mount(b, "b", "b.trd", 1);
  for (const drive of [0, 1] as const) {
    d.write(0xff, 0x14 | drive);
    d.write(0x1f, 0); // Restore also synchronizes the shared track register.
    d.write(0x5f, 2);
    d.write(0x1f, 0x80);
    expect(d.read(0x7f)).toBe(drive === 0 ? 11 : 22);
    d.write(0x1f, 0xa0);
    for (let i = 0; i < 256; i++) d.write(0x7f, drive + 70);
    d.write(0x7f, drive + 3);
    d.write(0x1f, 0x10);
    expect(d.head).toBe(drive + 3);
  }
  expect(d.states.map((s) => [s.id, s.dirty])).toEqual([
    ["a", true],
    ["b", true],
  ]);
  expect(d.imageFor(0)[256]).toBe(70);
  expect(d.imageFor(1)[256]).toBe(71);
  expect(a[256]).toBe(11);
  expect(b[256]).toBe(22);
  d.selectDrive(0);
  expect(d.head).toBe(3);
  expect(d.track).toBe(4); // Shared WD1793 register, independent mechanisms.
  d.selectDrive(1);
  expect(d.head).toBe(4);
  for (const drive of [2, 3]) {
    d.selectDrive(drive);
    d.write(0x1f, 0x80);
    expect(d.read(0x1f) & 128).toBe(128);
  }
});

it("keeps an active transfer during changes to the other drive, and cancels selected-media changes", () => {
  const d = new BetaDisk();
  d.mount(diskFixture(), "a", "a.trd");
  d.write(0x1f, 0xa0);
  d.write(0x7f, 90);
  d.mount(diskFixture(), "b", "b.trd", 1);
  expect(d.drive).toBe(0);
  expect(d.read(0xff) & 64).toBe(64);
  for (let i = 1; i < 256; i++) d.write(0x7f, 91);
  expect(d.imageFor(0)[0]).toBe(90);
  expect(d.stateFor(1).dirty).toBe(false);
  d.write(0x1f, 0xa0);
  d.write(0x7f, 12);
  d.selectDrive(1);
  expect(d.read(0xff) & 64).toBe(0);
  d.write(0x7f, 13);
  expect(d.imageFor(0)[0]).toBe(90);
  expect(d.imageFor(1)[0]).not.toBe(13);
  d.write(0x1f, 0x80);
  d.mount(diskFixture(), "b2", "b2.trd", 1);
  expect(d.read(0xff) & 64).toBe(0);
  d.write(0x1f, 0xa0);
  d.eject(1);
  expect(d.read(0xff) & 64).toBe(0);
  expect(d.stateFor(0).dirty).toBe(true);
  expect(d.stateFor(1).id).toBe("");
  d.reset();
  expect(d.imageFor(0)[0]).toBe(90);
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
