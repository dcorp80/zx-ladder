import type { Component } from "solid-js";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";

export const SoundSection: Component = () => {
  const store = useStore();
  return (
    <SectionFrame title="Sound" subtitle="Beeper" defaultFolded={false}>
      <label class="setting-row setting-check">
        <input
          type="checkbox"
          checked={store.soundEnabled()}
          onChange={(event) =>
            store.setSoundEnabled(event.currentTarget.checked)
          }
        />
        <span>Beeper</span>
      </label>
      <label class="setting-row">
        <span>Volume {Math.round(store.volume() * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={store.volume()}
          onInput={(event) =>
            store.setVolume(Number(event.currentTarget.value))
          }
        />
      </label>
      <p class="machine-note">
        {!store.soundEnabled()
          ? "Muted"
          : store.freeRun()
            ? "Muted during free run"
            : !store.isRunning()
              ? "Paused"
              : store.audioStatus()}
      </p>
    </SectionFrame>
  );
};

export const soundSection = {
  id: "sound",
  title: "Sound",
  Body: SoundSection,
  defaultFolded: false,
};
