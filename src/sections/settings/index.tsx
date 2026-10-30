import type { Component } from "solid-js";
import { type Theme, useStore } from "../../store";
import { SectionFrame } from "../frame";

const themes: Theme[] = ["system", "light", "dark"];

export const SettingsSection: Component = () => {
  const store = useStore();
  return (
    <SectionFrame title="Settings" subtitle="Appearance" defaultFolded={false}>
      <div class="settings-grid">
        <div class="setting-row theme-setting">
          <span>Theme</span>
          <fieldset class="theme-toggle" aria-label="Theme">
            {themes.map((theme) => (
              <button
                type="button"
                class="theme-button"
                classList={{ "is-selected": store.theme() === theme }}
                aria-pressed={store.theme() === theme}
                onClick={() => store.setTheme(theme)}
              >
                {theme[0].toUpperCase() + theme.slice(1)}
              </button>
            ))}
          </fieldset>
        </div>
      </div>
    </SectionFrame>
  );
};

export const settingsSection = {
  id: "settings",
  title: "Settings",
  Body: SettingsSection,
  defaultFolded: false,
};
