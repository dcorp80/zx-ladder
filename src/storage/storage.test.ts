import { describe, expect, it } from "vitest";
import { MemoryBackend } from "./memory";
import { ROM_SIZE, validateRomBytes } from "./types";

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
});
