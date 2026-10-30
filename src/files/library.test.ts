import { deflateRawSync } from "node:zlib";
import { expect, it } from "vitest";
import { MemoryBackend } from "../storage/memory";
import { createAppStore } from "../store";
import { fileId, prepareImport } from "./library";
import { crc32, extractZip } from "./zip";

const tap = new Uint8Array([3, 0, 255, 42, 213]);
function zip(entries: { name: string; bytes: Uint8Array }[], deflate = false) {
  const parts: Uint8Array[] = [],
    directory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const data = deflate
      ? new Uint8Array(deflateRawSync(entry.bytes))
      : entry.bytes;
    const local = new Uint8Array(30 + name.length + data.length),
      l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(8, deflate ? 8 : 0, true);
    l.setUint32(14, crc32(entry.bytes), true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, entry.bytes.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length),
      c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, deflate ? 8 : 0, true);
    c.setUint32(16, crc32(entry.bytes), true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, entry.bytes.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    parts.push(local);
    directory.push(central);
    offset += local.length;
  }
  const size = directory.reduce((sum, b) => sum + b.length, 0);
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + 22);
  let p = 0;
  for (const part of [...parts, ...directory, end]) {
    result.set(part, p);
    p += part.length;
  }
  return result;
}
function file(name: string, bytes: Uint8Array): File {
  return {
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}
it.each([false, true])(
  "extracts supported ZIP entries only, deflated=%s",
  async (deflated) => {
    const archive = zip(
      [
        { name: "a/demo.tap", bytes: tap },
        { name: "b/demo.tap", bytes: tap },
        { name: "readme.txt", bytes: new Uint8Array([1]) },
      ],
      deflated,
    );
    expect((await extractZip(archive)).map((f) => f.name)).toEqual([
      "a/demo.tap",
      "b/demo.tap",
    ]);
    const batch = await prepareImport([
      file("games.zip", archive),
      file("demo.tap", tap),
    ]);
    expect(batch.files).toHaveLength(3);
    expect(new Set(batch.files.map((f) => f.id)).size).toBe(3);
  },
);
it("rejects broken ZIP CRC and duplicate member paths", async () => {
  const archive = zip([{ name: "demo.tap", bytes: tap }]);
  archive[38] ^= 1;
  await expect(extractZip(archive)).rejects.toThrow("checksum");
  await expect(
    extractZip(
      zip([
        { name: "demo.tap", bytes: tap },
        { name: "demo.tap", bytes: tap },
      ]),
    ),
  ).rejects.toThrow("Duplicate");
});
it("asks before replacement, preserves skipped files, and restores the library", async () => {
  const backend = new MemoryBackend();
  const store = await createAppStore({ backend });
  await store.importFiles([file("demo.tap", tap)]);
  expect(store.files()).toHaveLength(1);
  const changed = new Uint8Array([3, 0, 255, 43, 212]);
  await store.importFiles([file("demo.tap", changed)]);
  expect(store.pendingImport()).not.toBeNull();
  expect((await backend.getFile(fileId(null, "demo.tap")))?.bytes).toEqual(tap);
  await store.confirmImport([]);
  expect((await backend.getFile(fileId(null, "demo.tap")))?.bytes).toEqual(tap);
  await store.importFiles([file("demo.tap", changed)]);
  await store.confirmImport([fileId(null, "demo.tap")]);
  const next = await createAppStore({ backend });
  expect(next.files()).toHaveLength(1);
  expect((await backend.getFile(next.files()[0].id))?.bytes).toEqual(changed);
  await next.deleteFile(next.files()[0].id);
  expect(next.files()).toHaveLength(0);
  next.dispose();
  store.dispose();
});
it("reports a failed write without adding library rows", async () => {
  const store = await createAppStore({
    backend: new MemoryBackend({ saveError: new Error("Quota exceeded") }),
  });
  await store.importFiles([file("demo.tap", tap)]);
  expect(store.files()).toHaveLength(0);
  expect(store.error()).toBe("Quota exceeded");
  store.dispose();
});

it("imports TZX directly and from ZIP alongside TAP", async () => {
  const tzx = new Uint8Array([
    90,
    88,
    84,
    97,
    112,
    101,
    33,
    26,
    1,
    20,
    0x10,
    0xe8,
    3,
    ...tap,
  ]);
  const archive = zip([
    { name: "folder/demo.TZX", bytes: tzx },
    { name: "demo.tap", bytes: tap },
  ]);
  const batch = await prepareImport([
    file("direct.tzx", tzx),
    file("mixed.zip", archive),
  ]);
  expect(batch.files.map((f) => f.name)).toEqual([
    "direct.tzx",
    "folder/demo.TZX",
    "demo.tap",
  ]);
  expect(batch.messages).toEqual([]);
  const invalid = await prepareImport([file("broken.tzx", tap)]);
  expect(invalid.files).toHaveLength(0);
  expect(invalid.messages[0]).toContain("TZX");
});
