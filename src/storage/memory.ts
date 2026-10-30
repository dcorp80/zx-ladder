import { fileMetadata, type StoredFile } from "../files/library";
import {
  cloneRomRecord,
  type RomRecord,
  type StorageBackend,
  validateRomRecord,
} from "./types";

export interface MemoryBackendOptions {
  initial?: RomRecord | null;
  /**
   * Defaults to false: this backend is normally the explicit session-only
   * fallback used when IndexedDB is unavailable. Tests can mark it persistent
   * when they want to model a successful durable backend.
   */
  persistent?: boolean;
  loadError?: Error;
  saveError?: Error;
}

/** In-memory backend used by tests and by the session-only browser fallback. */
export class MemoryBackend implements StorageBackend {
  readonly persistent: boolean;
  private record: RomRecord | null;
  private readonly loadFailure?: Error;
  private readonly saveFailure?: Error;

  constructor(options: MemoryBackendOptions = {}) {
    this.persistent = options.persistent === true;
    this.record = options.initial ? validateRomRecord(options.initial) : null;
    this.loadFailure = options.loadError;
    this.saveFailure = options.saveError;
  }

  private files = new Map<string, StoredFile>();
  async listFiles() {
    return [...this.files.values()].map(fileMetadata);
  }
  async getFile(id: string) {
    const file = this.files.get(id);
    return file ? { ...file, bytes: file.bytes.slice() } : null;
  }
  async putFiles(files: readonly StoredFile[]) {
    if (this.saveFailure) throw this.saveFailure;
    for (const file of files)
      this.files.set(file.id, { ...file, bytes: file.bytes.slice() });
  }
  async deleteFile(id: string) {
    if (this.saveFailure) throw this.saveFailure;
    this.files.delete(id);
  }

  async loadRom(): Promise<RomRecord | null> {
    if (this.loadFailure) throw this.loadFailure;
    return this.record ? cloneRomRecord(this.record) : null;
  }

  async saveRom(record: RomRecord): Promise<void> {
    if (this.saveFailure) throw this.saveFailure;
    this.record = cloneRomRecord(validateRomRecord(record));
  }
}
