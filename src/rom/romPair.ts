import {
  ROM_SIZE,
  type RomRecord,
  type RomSlot,
  validateRomRecord,
} from "../storage/types";

/** Canonical Spectrum firmware: two pages, with legacy 48K ROMs in ROM 1. */
export function normalizeRomPair(record: RomRecord): RomRecord {
  const source = validateRomRecord(record);
  if (source.bytes.length === ROM_SIZE * 2) {
    return {
      ...source,
      pageNames: source.pageNames ?? [
        `${source.name} (1/2)`,
        `${source.name} (2/2)`,
      ],
    };
  }
  const bytes = new Uint8Array(ROM_SIZE * 2).fill(0xff);
  bytes.set(source.bytes, ROM_SIZE);
  return { ...source, bytes, pageNames: [null, source.name] };
}

/** Import into one slot, or replace the entire pair for a 32K ROM 0 input. */
export function replaceRomPage(
  current: RomRecord | null,
  input: RomRecord,
  slot: RomSlot,
): RomRecord {
  if (slot !== 0 && slot !== 1) throw new Error("Choose ROM 0 or ROM 1.");
  const source = validateRomRecord(input);
  const pair = current
    ? normalizeRomPair(current)
    : {
        name: source.name,
        bytes: new Uint8Array(ROM_SIZE * 2).fill(0xff),
        pageNames: [null, null] as const,
      };
  if (slot === 0 && source.bytes.length === ROM_SIZE * 2)
    return normalizeRomPair(source);
  const pageNames: [string | null, string | null] = [
    pair.pageNames?.[0] ?? null,
    pair.pageNames?.[1] ?? null,
  ];
  pair.bytes.set(source.bytes.subarray(0, ROM_SIZE), slot * ROM_SIZE);
  pageNames[slot] =
    source.bytes.length === ROM_SIZE
      ? source.name
      : (normalizeRomPair(source).pageNames?.[0] ?? null);
  return {
    name: source.name,
    bytes: pair.bytes,
    pageNames,
    updatedAt: source.updatedAt,
  };
}
