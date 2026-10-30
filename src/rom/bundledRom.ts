import { type RomRecord, validateRomBytes } from "../storage/types";

/** The firmware is a separately licensed static asset, not application code. */
export async function loadBundledRom(): Promise<RomRecord> {
  const response = await fetch(`${import.meta.env.BASE_URL}roms/48.rom`);
  if (!response.ok)
    throw new Error(
      `Bundled ROM download failed (${response.status}). Choose a ROM file to continue.`,
    );
  return {
    name: "48.rom",
    bytes: validateRomBytes(await response.arrayBuffer()),
    updatedAt: Date.now(),
  };
}
