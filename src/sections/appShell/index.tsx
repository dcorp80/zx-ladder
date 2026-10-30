import type { Component } from "solid-js";
import { useStore } from "../../store";

/** Compatibility wrapper for callers that used the copied explorer shell. */
export const AppShell: Component = () => {
  const store = useStore();
  return (
    <header class="app-header">
      <div>
        <p class="eyebrow">ZX LADDER</p>
        <h1>Hardware-like ZX Spectrum emulator</h1>
      </div>
      <div class="header-meta">
        <span title={`Build ${__BUILD_SHA__}`}>v{__APP_VERSION__}</span>
        <span>{store.videoPreset().label}</span>
        <span>{store.turbo() ? "7 MHz CPU" : "3.5 MHz CPU"}</span>
      </div>
    </header>
  );
};

export const appShell = {
  id: "appShell",
  title: "ZX Ladder",
  Header: AppShell,
  Body: AppShell,
  defaultFolded: false,
};
