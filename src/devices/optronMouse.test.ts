import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sclToTrd } from "../files/scl";
import { extractZip } from "../files/zip";
import { createMachine } from "../machine/machine";
import { DEFAULT_KEMPSTON } from "./kempston";

// The magazine is supplied locally, never copied into the repository.
const archive = process.env.OPTRON_ARCHIVE;
it.skipIf(!archive)(
  "OPTRON 4.1 detects the mouse and updates its cursor from movement",
  async () => {
    if (!archive) throw new Error("Set OPTRON_ARCHIVE to the local ZIP path.");
    const files = await extractZip(new Uint8Array(readFileSync(archive)));
    const scl = files.find((file) => /optron41\.scl$/i.test(file.name));
    if (!scl) throw new Error("OPTRON41.SCL is missing from the archive.");
    const m = createMachine({
      rom: new Uint8Array(readFileSync("public/roms/128.rom")),
    });
    m.kempstonInput({
      action: "settings",
      settings: { ...DEFAULT_KEMPSTON, mouseEnabled: true },
    });
    m.mountDisk(sclToTrd(scl.bytes), "optron", "OPTRON41.SCL", false);
    m.runDisk(0);
    for (let frame = 0; frame <= 500; frame++) {
      m.advanceFrame();
      if (frame === 400) m.keyboard.press("skip-intro", "SPACE");
      if (frame === 405) m.keyboard.release("skip-intro");
    }
    // Self-modified AND operands in the two axis handlers.
    expect(m.memory.read(0x6bf2)).toBe(255);
    expect(m.memory.read(0x6c17)).toBe(255);
    const x = m.memory.read(0x6f1c);
    const y = m.memory.read(0x6f1d);
    m.kempstonInput({ action: "motion", dx: 20, dy: 10 });
    for (let frame = 0; frame < 149; frame++) m.advanceFrame();
    expect(m.memory.read(0x6f1c)).toBe(x + 20);
    expect(m.memory.read(0x6f1d)).toBe(y + 10);
  },
  30000,
);
