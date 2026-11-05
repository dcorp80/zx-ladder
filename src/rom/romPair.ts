import { validateRomBytes } from "../storage/types";
/** Normalize a 128K firmware input before persisting or sending to the worker. */
export async function complete128Rom(
  bytes: Uint8Array,
  load48: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const source = validateRomBytes(bytes);
  if (source.length === 32768) return source;
  const rom48 = await load48();
  if (rom48.length !== 16384)
    throw new Error("The fallback 48K ROM must be exactly 16384 bytes.");
  const pair = new Uint8Array(32768);
  pair.set(source);
  pair.set(rom48, 16384);
  return pair;
}
