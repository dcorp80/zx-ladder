import { afterEach, expect, it, vi } from "vitest";
import { createAppStore } from "../store";
import { makeFakeLoop } from "../test/fakes";
import { CONFIG_KEY, loadConfig, sanitizeConfig, THEME_KEY } from "./config";
import { MemoryBackend } from "./memory";

afterEach(() => vi.restoreAllMocks());

it("restores configuration and the saved ROM paused", async () => {
  const backend = new MemoryBackend({ persistent: true });
  const deps = { backend, hostLoopFactory: () => makeFakeLoop() };
  const first = await createAppStore(deps);
  expect(first.theme()).toBe("system");
  first.setVideoPreset("lviv");
  first.setTurbo(true);
  first.setFreeRun(true);
  first.setShowBorder(false);
  first.setTheme("dark");
  first.setKeyboardLayout("pc-full-size");
  await first.importRom(new File([new Uint8Array(16384)], "saved.rom"));
  first.dispose();
  const fresh = await createAppStore(deps);
  try {
    expect(fresh.videoPreset().id).toBe("lviv");
    expect(fresh.machine()?.height).toBe(312);
    expect(fresh.machine()?.cpu7).toBe(true);
    expect(fresh.freeRun()).toBe(true);
    expect(fresh.showBorder()).toBe(false);
    expect(fresh.theme()).toBe("dark");
    expect(fresh.keyboardLayout()).toBe("pc-full-size");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(fresh.isRunning()).toBe(false);
    fresh.setTheme("system");
    expect(document.documentElement.dataset.theme).toBe("system");
    expect(loadConfig().theme).toBe("system");
    expect(localStorage.getItem(THEME_KEY)).toBe("system");
  } finally {
    fresh.dispose();
  }
});

it("validates persisted fields, malformed JSON, and future configuration versions", () => {
  const defaults = sanitizeConfig(null);
  expect(defaults.theme).toBe("system");
  expect(
    sanitizeConfig({
      version: 1,
      videoPreset: "unknown",
      turbo: "true",
      freeRun: 1,
      showBorder: null,
      theme: "blue",
    }),
  ).toEqual(defaults);
  expect(sanitizeConfig({ version: 2, turbo: true })).toEqual(defaults);
  localStorage.setItem(CONFIG_KEY, "{broken");
  expect(loadConfig()).toEqual(defaults);
  localStorage.removeItem(CONFIG_KEY);
  localStorage.setItem(THEME_KEY, "light");
  expect(loadConfig().theme).toBe("light");
});

it("keeps configuration changes active when saving is unavailable", async () => {
  const store = await createAppStore({ backend: new MemoryBackend() });
  try {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    store.setTheme("dark");
    store.setFreeRun(true);
    expect(store.theme()).toBe("dark");
    expect(store.freeRun()).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(store.error()).toContain("session only");
  } finally {
    store.dispose();
  }
});

it("keeps experimental Late INT off including persisted opt-ins", async () => {
  expect(sanitizeConfig(null).lateInt).toBe(false);
  expect(sanitizeConfig({ version: 1, videoPreset: "lviv" }).lateInt).toBe(
    false,
  );
  expect(
    sanitizeConfig({ version: 1, videoPreset: "lviv", lateInt: true }).lateInt,
  ).toBe(false);
  const store = await createAppStore({ backend: new MemoryBackend() });
  try {
    store.setVideoPreset("lviv");
    expect(store.lateInt()).toBe(false);
    store.setLateInt(false);
    expect(loadConfig().lateInt).toBe(false);
    store.setVideoPreset("pentagon");
    expect(store.lateInt()).toBe(false);
    store.setLateInt(true);
    expect(loadConfig().lateInt).toBe(false);
  } finally {
    store.dispose();
  }
});

it("persists sound preferences and bounds volume", async () => {
  expect(sanitizeConfig(null).soundEnabled).toBe(true);
  expect(sanitizeConfig(null).volume).toBe(0.2);
  expect(sanitizeConfig({ version: 1, volume: 99 }).volume).toBe(1);
  expect(sanitizeConfig({ version: 1, volume: -1 }).volume).toBe(0);
  expect(sanitizeConfig({ version: 1, volume: NaN }).volume).toBe(0.2);
  const store = await createAppStore({ backend: new MemoryBackend() });
  try {
    store.setSoundEnabled(false);
    store.setVolume(0.23);
    expect(loadConfig().soundEnabled).toBe(false);
    expect(loadConfig().volume).toBe(0.23);
  } finally {
    store.dispose();
  }
});

it("persists keyboard color independently of the page theme", async () => {
  const store = await createAppStore({ backend: new MemoryBackend() });
  try {
    store.setTheme("dark");
    store.setKeyboardColor("light");
    expect(loadConfig().keyboardColor).toBe("light");
    expect(loadConfig().theme).toBe("dark");
    expect(
      sanitizeConfig({ version: 1, keyboardColor: "unknown" }).keyboardColor,
    ).toBe("theme");
  } finally {
    store.dispose();
  }
});
