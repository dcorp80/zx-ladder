import { expect, it } from "vitest";
import { ROM_SIZE, type RomRecord, type RomSlot } from "../storage/types";
import { normalizeRomPair, replaceRomPage } from "./romPair";

function input(size: 1 | 2, name = "incoming.rom"): RomRecord {
  const bytes = new Uint8Array(ROM_SIZE * size).fill(0x33);
  if (size === 2) bytes.fill(0x44, ROM_SIZE);
  return { name, bytes, updatedAt: 42 };
}
function existing(): RomRecord {
  const bytes = new Uint8Array(ROM_SIZE * 2).fill(0x11);
  bytes.fill(0x22, ROM_SIZE);
  return { name: "previous.rom", bytes, pageNames: ["zero.rom", "one.rom"] };
}
function pageValues(record: RomRecord) {
  return [record.bytes[0], record.bytes[ROM_SIZE]];
}

it("normalizes legacy 48K firmware into ROM 1 with an empty ROM 0", () => {
  const source = input(1, "48.rom");
  const pair = normalizeRomPair(source);
  expect(pair.bytes).toHaveLength(ROM_SIZE * 2);
  expect(
    pair.bytes.subarray(0, ROM_SIZE).every((value) => value === 0xff),
  ).toBe(true);
  expect(pair.bytes.subarray(ROM_SIZE)).toEqual(source.bytes);
  expect(pair.pageNames).toEqual([null, "48.rom"]);
  expect(pair.updatedAt).toBe(42);
  expect(source.bytes).toHaveLength(ROM_SIZE);
});

it("preserves both halves of legacy pairs and derives page labels only once", () => {
  const source = input(2, "128.rom");
  const pair = normalizeRomPair(source);
  expect(pair.bytes).toEqual(source.bytes);
  expect(pair.bytes).not.toBe(source.bytes);
  expect(pair.pageNames).toEqual(["128.rom (1/2)", "128.rom (2/2)"]);
  expect(normalizeRomPair(pair)).toEqual(pair);
  const named = { ...source, pageNames: ["loader.rom", null] as const };
  expect(normalizeRomPair(named).pageNames).toEqual(named.pageNames);
  expect(normalizeRomPair(named).pageNames).not.toBe(named.pageNames);
});

it.each([
  {
    slot: 0,
    size: 1,
    values: [0x33, 0x22],
    names: ["incoming.rom", "one.rom"],
  },
  {
    slot: 1,
    size: 1,
    values: [0x11, 0x33],
    names: ["zero.rom", "incoming.rom"],
  },
  {
    slot: 0,
    size: 2,
    values: [0x33, 0x44],
    names: ["incoming.rom (1/2)", "incoming.rom (2/2)"],
  },
  {
    slot: 1,
    size: 2,
    values: [0x11, 0x33],
    names: ["zero.rom", "incoming.rom (1/2)"],
  },
] as const)(
  "imports $size page(s) through ROM $slot",
  ({ slot, size, values, names }) => {
    const current = existing();
    const source = input(size);
    const currentBytes = current.bytes.slice();
    const sourceBytes = source.bytes.slice();
    const result = replaceRomPage(current, source, slot);
    expect(result.bytes).toHaveLength(ROM_SIZE * 2);
    expect(pageValues(result)).toEqual(values);
    expect(result.pageNames).toEqual(names);
    expect(result.name).toBe(source.name);
    expect(result.updatedAt).toBe(42);
    expect(current.bytes).toEqual(currentBytes);
    expect(source.bytes).toEqual(sourceBytes);
    expect(result.bytes).not.toBe(current.bytes);
    expect(result.bytes).not.toBe(source.bytes);
    expect(result.pageNames).not.toBe(current.pageNames);
  },
);

it.each([0, 1] as const)(
  "keeps an unused ROM slot empty when importing into ROM %i",
  (slot: RomSlot) => {
    const result = replaceRomPage(null, input(1), slot);
    expect(
      result.bytes
        .subarray((1 - slot) * ROM_SIZE, (2 - slot) * ROM_SIZE)
        .every((value) => value === 0xff),
    ).toBe(true);
    expect(result.pageNames?.[1 - slot]).toBeNull();
    expect(result.pageNames?.[slot]).toBe("incoming.rom");
  },
);

it("retains the other ROM when importing into a legacy record", () => {
  const result = replaceRomPage(input(1, "48.rom"), input(1, "custom.rom"), 0);
  expect(result.pageNames).toEqual(["custom.rom", "48.rom"]);
  expect(pageValues(result)).toEqual([0x33, 0x33]);
});

it("rejects invalid firmware and metadata without changing the existing pair", () => {
  const current = existing();
  const bytes = current.bytes.slice();
  const names = [...(current.pageNames ?? [])];
  expect(() =>
    replaceRomPage(current, { name: "bad.rom", bytes: new Uint8Array(10) }, 0),
  ).toThrow("exactly");
  expect(() =>
    replaceRomPage(
      current,
      { ...input(1), pageNames: ["bad"] } as unknown as RomRecord,
      1,
    ),
  ).toThrow("metadata");
  expect(() => replaceRomPage(current, input(1), 2 as RomSlot)).toThrow(
    "ROM 0 or ROM 1",
  );
  expect(current.bytes.every((value, index) => value === bytes[index])).toBe(
    true,
  );
  expect(current.pageNames).toEqual(names);
  expect(current.name).toBe("previous.rom");
});
