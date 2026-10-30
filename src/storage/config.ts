import { PENTAGON_VIDEO_PRESET, VIDEO_PRESETS } from "../devices/videoPresets";
import { isKeyboardLayout, KEYBOARD_PROFILE_ID } from "../input/keyboardLayout";

export type Theme = "light" | "dark" | "system";
export const CONFIG_KEY = "zx-ladder:config";
export const THEME_KEY = "zx-ladder:theme";
export interface AppConfig {
  version: 1;
  videoPreset: string;
  turbo: boolean;
  freeRun: boolean;
  showBorder: boolean;
  lateInt: boolean;
  keyboardColor: "theme" | "light" | "dark";
  soundEnabled: boolean;
  volume: number;
  theme: Theme;
  keyboardLayout: string;
  keyboardProfile: string;
}
export function sanitizeTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
export function sanitizeConfig(value: unknown): AppConfig {
  const config =
    value &&
    typeof value === "object" &&
    "version" in value &&
    value.version === 1
      ? (value as Partial<AppConfig>)
      : {};
  return {
    version: 1,
    videoPreset:
      VIDEO_PRESETS.find((p) => p.id === config.videoPreset)?.id ??
      PENTAGON_VIDEO_PRESET.id,
    turbo: typeof config.turbo === "boolean" ? config.turbo : false,
    freeRun: typeof config.freeRun === "boolean" ? config.freeRun : false,
    showBorder:
      typeof config.showBorder === "boolean" ? config.showBorder : true,
    // Experimental timing is parked; discard previously persisted opt-ins.
    lateInt: false,
    keyboardColor:
      config.keyboardColor === "light" || config.keyboardColor === "dark"
        ? config.keyboardColor
        : "theme",
    soundEnabled:
      typeof config.soundEnabled === "boolean" ? config.soundEnabled : true,
    volume:
      typeof config.volume === "number" && Number.isFinite(config.volume)
        ? Math.max(0, Math.min(1, config.volume))
        : 0.2,
    theme: sanitizeTheme(config.theme),
    keyboardLayout: isKeyboardLayout(config.keyboardLayout)
      ? config.keyboardLayout
      : "auto",
    keyboardProfile: KEYBOARD_PROFILE_ID,
  };
}
export function loadConfig(): AppConfig {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored !== null) return sanitizeConfig(JSON.parse(stored));
    // Keep the theme chosen before configuration persistence was introduced.
    return {
      ...sanitizeConfig(null),
      theme: sanitizeTheme(localStorage.getItem(THEME_KEY)),
    };
  } catch {
    return sanitizeConfig(null);
  }
}
export function saveConfig(config: AppConfig): void {
  const clean = sanitizeConfig(config);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
  // Synchronous cache used by index.html before the first paint.
  localStorage.setItem(THEME_KEY, clean.theme);
}
export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined")
    document.documentElement.setAttribute("data-theme", theme);
}
