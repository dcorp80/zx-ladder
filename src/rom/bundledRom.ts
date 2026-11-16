import { ROM_SIZE, type RomRecord, validateRomBytes } from "../storage/types";

/** The firmware is a separately licensed static asset, not application code. */
export async function loadBundledRom(
  name: "48.rom" | "128.rom" = "128.rom",
): Promise<RomRecord> {
  const response = await fetch(`${import.meta.env.BASE_URL}roms/${name}`);
  if (!response.ok)
    throw new Error(
      `Bundled ROM download failed (${response.status}). Choose a ROM file to continue.`,
    );
  const bytes = validateRomBytes(await response.arrayBuffer());
  const expectedSize = name === "128.rom" ? ROM_SIZE * 2 : ROM_SIZE;
  if (bytes.length !== expectedSize)
    throw new Error(`Bundled ${name} must be exactly ${expectedSize} bytes.`);
  return {
    name,
    bytes,
    updatedAt: Date.now(),
  };
}
