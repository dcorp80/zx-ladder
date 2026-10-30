import {
  fileMetadata,
  type LibraryFile,
  type StoredFile,
} from "../files/library";
import { MemoryBackend } from "./memory";
import {
  cloneRomRecord,
  type RomRecord,
  type StorageBackend,
  validateRomRecord,
} from "./types";

const DB_NAME = "zx-ladder";
const DB_VERSION = 2;
const ROM_STORE = "roms";
const SELECTED_ROM_KEY = "selected";

interface PersistedRomRecord {
  key: string;
  name: string;
  bytes: ArrayBuffer;
  updatedAt: number;
}

function indexedDb(): IDBFactory {
  const candidate = globalThis.indexedDB;
  if (!candidate) {
    throw new Error(
      "IndexedDB is unavailable; ROM persistence is session-only.",
    );
  }
  return candidate;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDb().open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["files", "fileMetadata"]) {
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ROM_STORE)) {
        db.createObjectStore(ROM_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open ROM storage."));
    request.onblocked = () =>
      reject(new Error("ROM storage is blocked by another browser tab."));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("ROM storage request failed."));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("ROM storage transaction failed."));
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("ROM storage transaction was aborted."),
      );
  });
}

export class IndexedDbBackend implements StorageBackend {
  readonly persistent = true;

  async listFiles(): Promise<LibraryFile[]> {
    const db = await openDatabase();
    try {
      return await requestValue(
        db
          .transaction("fileMetadata", "readonly")
          .objectStore("fileMetadata")
          .getAll(),
      );
    } finally {
      db.close();
    }
  }
  async getFile(id: string): Promise<StoredFile | null> {
    const db = await openDatabase();
    try {
      return (
        (await requestValue<StoredFile | undefined>(
          db.transaction("files", "readonly").objectStore("files").get(id),
        )) ?? null
      );
    } finally {
      db.close();
    }
  }
  async putFiles(files: readonly StoredFile[]): Promise<void> {
    const db = await openDatabase();
    try {
      const tx = db.transaction(["files", "fileMetadata"], "readwrite");
      const done = waitForTransaction(tx);
      for (const file of files) {
        tx.objectStore("files").put(file);
        tx.objectStore("fileMetadata").put(fileMetadata(file));
      }
      await done;
    } finally {
      db.close();
    }
  }
  async deleteFile(id: string): Promise<void> {
    const db = await openDatabase();
    try {
      const tx = db.transaction(["files", "fileMetadata"], "readwrite");
      const done = waitForTransaction(tx);
      tx.objectStore("files").delete(id);
      tx.objectStore("fileMetadata").delete(id);
      await done;
    } finally {
      db.close();
    }
  }

  async loadRom(): Promise<RomRecord | null> {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(ROM_STORE, "readonly");
      const stored = await requestValue<PersistedRomRecord | undefined>(
        transaction.objectStore(ROM_STORE).get(SELECTED_ROM_KEY),
      );
      if (!stored) return null;
      return validateRomRecord({
        name: stored.name,
        bytes: new Uint8Array(stored.bytes),
        updatedAt: stored.updatedAt,
      });
    } finally {
      db.close();
    }
  }

  async saveRom(record: RomRecord): Promise<void> {
    const validated = validateRomRecord(record);
    const db = await openDatabase();
    try {
      const transaction = db.transaction(ROM_STORE, "readwrite");
      const copy = cloneRomRecord(validated);
      const buffer = new ArrayBuffer(copy.bytes.byteLength);
      new Uint8Array(buffer).set(copy.bytes);
      const persisted: PersistedRomRecord = {
        key: SELECTED_ROM_KEY,
        name: copy.name,
        bytes: buffer,
        updatedAt: copy.updatedAt ?? Date.now(),
      };
      transaction.objectStore(ROM_STORE).put(persisted);
      await waitForTransaction(transaction);
    } finally {
      db.close();
    }
  }
}

/**
 * Select IndexedDB when the browser exposes it. The fallback deliberately
 * reports `persistent: false`; silently pretending an in-memory save is
 * durable would make a reload lose the selected ROM without telling the user.
 */
export function openDefaultBackend(): StorageBackend {
  return typeof globalThis.indexedDB === "undefined"
    ? new MemoryBackend()
    : new IndexedDbBackend();
}
