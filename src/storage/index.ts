export { IndexedDbBackend, openDefaultBackend } from "./indexeddb";
export { MemoryBackend } from "./memory";
export {
  cloneRomRecord,
  ROM_SIZE,
  type RomRecord,
  type RomSlot,
  type StorageBackend,
  validateRomBytes,
  validateRomRecord,
} from "./types";
