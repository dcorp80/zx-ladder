import { type RomRecord, validateRomBytes } from "../storage/types";

/** The firmware is a separately licensed static asset, not application code. */
export async function loadBundledRom(
  name: "48.rom" | "128.rom" = "48.rom",
): Promise<RomRecord> {
  const response = await fetch(`${import.meta.env.BASE_URL}roms/${name}`);
  if (!response.ok)
    throw new Error(
      `Bundled ROM download failed (${response.status}). Choose a ROM file to continue.`,
    );
  return {
    name,
    bytes: validateRomBytes(await response.arrayBuffer()),
    updatedAt: Date.now(),
  };
}
