import { describe, expect, it, vi } from "vitest";
import { IndexedDbBackend } from "./indexeddb";
import { MemoryBackend } from "./memory";
import {
  ROM_SIZE,
  type RomRecord,
  validateRomBytes,
  validateRomRecord,
} from "./types";

describe("ROM storage", () => {
  it("keeps saved bytes isolated from the caller", async () => {
    const backend = new MemoryBackend({ persistent: true });
    const bytes = new Uint8Array(ROM_SIZE);
    bytes[0] = 0x42;
    await backend.saveRom({ name: "test.rom", bytes });
    bytes[0] = 0;
    const saved = await backend.loadRom();
    expect(saved?.bytes[0]).toBe(0x42);
    expect(saved?.name).toBe("test.rom");
  });

  it("requires a 16 KiB image or 32 KiB pair", () => {
    expect(() => validateRomBytes(new Uint8Array(ROM_SIZE - 1))).toThrow(
      /exactly 16384 or 32768 bytes/,
    );
    expect(validateRomBytes(new Uint8Array(ROM_SIZE))).toHaveLength(ROM_SIZE);
    expect(validateRomBytes(new Uint8Array(ROM_SIZE * 2))).toHaveLength(
      ROM_SIZE * 2,
    );
    expect(() => validateRomBytes(new Uint8Array(ROM_SIZE * 2 + 1))).toThrow();
  });

  it("keeps page labels and bytes isolated across saves and restores", async () => {
    const names: [string | null, string | null] = [null, "48.rom"];
    const bytes = new Uint8Array(ROM_SIZE * 2).fill(0x55);
    const backend = new MemoryBackend({
      initial: { name: "pair.rom", bytes, pageNames: names },
    });
    names[1] = "changed.rom";
    bytes[ROM_SIZE] = 0;
    const first = await backend.loadRom();
    expect(first?.pageNames).toEqual([null, "48.rom"]);
    expect(first?.bytes[ROM_SIZE]).toBe(0x55);
    if (!first) throw new Error("Expected saved pair");
    await backend.saveRom(first);
    (first.pageNames as [string | null, string | null])[0] = "mutated.rom";
    first.bytes[0] = 0;
    const restored = await backend.loadRom();
    expect(restored?.pageNames).toEqual([null, "48.rom"]);
    expect(restored?.bytes[0]).toBe(0x55);
    expect(restored?.pageNames).not.toBe(first.pageNames);
  });

  it("rejects malformed page metadata and retains the previous record", async () => {
    const original = { name: "valid.rom", bytes: new Uint8Array(ROM_SIZE) };
    const backend = new MemoryBackend({ initial: original });
    const invalid = {
      ...original,
      pageNames: [null, 42],
    } as unknown as RomRecord;
    expect(() => validateRomRecord(invalid)).toThrow("metadata");
    await expect(backend.saveRom(invalid)).rejects.toThrow("metadata");
    expect((await backend.loadRom())?.name).toBe("valid.rom");
  });

  it("persists page metadata with the pair in IndexedDB", async () => {
    let stored: unknown;
    const db = {
      close() {},
      transaction() {
        const transaction = {
          oncomplete: undefined as undefined | (() => void),
          objectStore: () => ({
            put(record: unknown) {
              stored = structuredClone(record);
              queueMicrotask(() => transaction.oncomplete?.());
            },
            get() {
              const request = {
                result: undefined as unknown,
                onsuccess: undefined as undefined | (() => void),
              };
              queueMicrotask(() => {
                request.result = stored;
                request.onsuccess?.();
              });
              return request;
            },
          }),
        };
        return transaction;
      },
    };
    vi.stubGlobal("indexedDB", {
      open() {
        const request = {
          result: db,
          onsuccess: undefined as undefined | (() => void),
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });
    try {
      const bytes = new Uint8Array(ROM_SIZE * 2).fill(0x67);
      const pageNames: [string | null, string | null] = ["loader.rom", null];
      await new IndexedDbBackend().saveRom({
        name: "pair.rom",
        bytes,
        pageNames,
      });
      bytes[0] = 0;
      pageNames[0] = "changed.rom";
      const restored = await new IndexedDbBackend().loadRom();
      expect(restored?.bytes[0]).toBe(0x67);
      expect(restored?.pageNames).toEqual(["loader.rom", null]);
      expect(restored?.pageNames).not.toBe(pageNames);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
