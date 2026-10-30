import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { MemoryBackend } from "../storage/memory";
import { createAppStore } from "../store";
import { makeFakeLoop, makeFakeMachine } from "../test/fakes";

const record = { name: "48.rom", bytes: new Uint8Array(16384) };
const deps = {
  machineFactory: () => makeFakeMachine(),
  hostLoopFactory: () => makeFakeLoop(),
};
it("persists first-run firmware and restores paused without fetching again", async () => {
  const backend = new MemoryBackend({ persistent: true });
  const loadBundledRom = vi.fn(async () => record);
  const store = await createAppStore({ ...deps, backend, loadBundledRom });
  expect(loadBundledRom).toHaveBeenCalledTimes(1);
  expect((await backend.loadRom())?.bytes).toEqual(record.bytes);
  expect(store.machine()).not.toBeNull();
  expect(store.isRunning()).toBe(false);
  store.dispose();
  await backend.saveRom({
    ...record,
    name: "custom.rom",
    bytes: new Uint8Array(16384).fill(7),
  });
  const fresh = await createAppStore({ ...deps, backend, loadBundledRom });
  expect(loadBundledRom).toHaveBeenCalledTimes(1);
  expect(fresh.rom()?.name).toBe("custom.rom");
  expect(fresh.rom()?.bytes[0]).toBe(7);
  fresh.dispose();
});
it("keeps the selector usable after a bundled download failure", async () => {
  const backend = new MemoryBackend();
  const store = await createAppStore({
    ...deps,
    backend,
    loadBundledRom: async () => {
      throw new Error("Download failed");
    },
  });
  expect(store.error()).toBe("Download failed");
  await store.importRom(new File([record.bytes], "replacement.rom"));
  expect(store.rom()?.name).toBe("replacement.rom");
  expect(store.error()).toBeNull();
  store.dispose();
});
it("retains active bundled ROM when persistence fails", async () => {
  const backend = new MemoryBackend();
  vi.spyOn(backend, "saveRom").mockRejectedValue(new Error("Quota exceeded"));
  const store = await createAppStore({
    ...deps,
    backend,
    loadBundledRom: async () => record,
  });
  expect(store.machine()).not.toBeNull();
  expect(store.storage().state).toBe("error");
  expect(store.storage().message).toContain("session-only");
  store.dispose();
});
it("validates downloaded bytes and rejects unsuccessful responses", async () => {
  const { loadBundledRom } =
    await vi.importActual<typeof import("./bundledRom")>("./bundledRom");
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => record.bytes.buffer,
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    expect((await loadBundledRom()).bytes).toEqual(record.bytes);
    expect(fetcher).toHaveBeenCalledWith(
      `${import.meta.env.BASE_URL}roms/48.rom`,
    );
    fetcher.mockResolvedValue({ ok: false, status: 404 });
    await expect(loadBundledRom()).rejects.toThrow("404");
    fetcher.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(10),
    });
    await expect(loadBundledRom()).rejects.toThrow("exactly 16384");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("ships the unmodified reference ROM", () => {
  const bytes = readFileSync("public/roms/48.rom");
  expect(bytes.length).toBe(16384);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "d55daa439b673b0e3f5897f99ac37ecb45f974d1862b4dadb85dec34af99cb42",
  );
});
