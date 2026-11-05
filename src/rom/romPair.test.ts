import { expect, it, vi } from "vitest";
import { complete128Rom } from "./romPair";

it("uses both halves of a complete image without requesting a fallback", async () => {
  const source = new Uint8Array(32768).fill(7);
  source.fill(8, 16384);
  const fallback = vi.fn();
  const pair = await complete128Rom(source, fallback);
  expect(pair).toEqual(source);
  expect(pair).not.toBe(source);
  expect(fallback).not.toHaveBeenCalled();
});
it("pairs a 16K 128K ROM with the existing 48K firmware", async () => {
  const pair = await complete128Rom(new Uint8Array(16384).fill(7), async () =>
    new Uint8Array(16384).fill(9),
  );
  expect(pair.length).toBe(32768);
  expect(pair[0]).toBe(7);
  expect(pair[16383]).toBe(7);
  expect(pair[16384]).toBe(9);
  expect(pair[32767]).toBe(9);
  await expect(
    complete128Rom(new Uint8Array(16384), async () => new Uint8Array(32768)),
  ).rejects.toThrow("fallback");
});
