import type { LibraryFile, StoredFile } from "../files/library";
export const ROM_SIZE = 0x4000;

export interface RomRecord {
  /** The browser file name, or a user-facing name supplied by a caller. */
  name: string;
  /** A private copy of exactly one 16 KiB ROM image. */
  bytes: Uint8Array;
  updatedAt?: number;
}

/**
 * The small persistence surface used by the emulator store. Keeping this
 * interface independent of IndexedDB makes UI tests deterministic and lets
 * another host provide persistence later without changing the store.
 */
export interface StorageBackend {
  /** True only when writes survive a page reload. */
  readonly persistent: boolean;
  listFiles(): Promise<LibraryFile[]>;
  getFile(id: string): Promise<StoredFile | null>;
  putFiles(files: readonly StoredFile[]): Promise<void>;
  deleteFile(id: string): Promise<void>;
  loadRom(): Promise<RomRecord | null>;
  saveRom(record: RomRecord): Promise<void>;
}

export function cloneRomRecord(record: RomRecord): RomRecord {
  return {
    name: record.name,
    bytes: new Uint8Array(record.bytes),
    updatedAt: record.updatedAt,
  };
}

export function validateRomBytes(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.byteLength !== ROM_SIZE) {
    throw new Error(
      `ROM must be exactly ${ROM_SIZE} bytes (received ${view.byteLength}).`,
    );
  }
  return new Uint8Array(view);
}

export function validateRomRecord(record: RomRecord): RomRecord {
  if (!record || typeof record.name !== "string") {
    throw new Error("Stored ROM metadata is invalid.");
  }
  return {
    name: record.name || "selected.rom",
    bytes: validateRomBytes(record.bytes),
    updatedAt: record.updatedAt,
  };
}
