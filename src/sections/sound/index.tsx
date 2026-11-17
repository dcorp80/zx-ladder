import { type Component, For } from "solid-js";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";

export const SoundSection: Component = () => {
  const store = useStore();
  return (
    <SectionFrame
      title="Sound"
      subtitle={
        [store.soundEnabled() && "Beeper", store.ayEnabled() && "AY"]
          .filter(Boolean)
          .join(" · ") || "No sources"
      }
      defaultFolded={false}
      actions={
        <div class="sound-header-controls">
          <label class="setting-row setting-check">
            <input
              type="checkbox"
              checked={store.muted()}
              onChange={(event) => store.setMuted(event.currentTarget.checked)}
            />
            <span>Mute</span>
          </label>
          <label class="sound-master-volume">
            <span>Volume {Math.round(store.masterVolume() * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              aria-label={`Master volume ${Math.round(store.masterVolume() * 100)}%`}
              value={store.masterVolume()}
              onInput={(event) =>
                store.setMasterVolume(Number(event.currentTarget.value))
              }
            />
          </label>
        </div>
      }
    >
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
        <span>Beeper volume {Math.round(store.volume() * 100)}%</span>
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
      <label class="setting-row setting-check">
        <input
          type="checkbox"
          checked={store.ayEnabled()}
          onChange={(e) => store.setAyEnabled(e.currentTarget.checked)}
        />
        <span>AY enabled</span>
      </label>
      <div class="setting-row" role="radiogroup" aria-label="AY stereo">
        <For each={["ABC", "ACB", "Mono"] as const}>
          {(mode) => (
            <label>
              <input
                type="radio"
                name="ay-stereo"
                value={mode}
                checked={store.ayStereo() === mode}
                onChange={() => store.setAyStereo(mode)}
              />{" "}
              {mode}
            </label>
          )}
        </For>
      </div>
      <label class="setting-row">
        <span>AY volume {Math.round(store.ayVolume() * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={store.ayVolume()}
          onInput={(e) => store.setAyVolume(Number(e.currentTarget.value))}
        />
      </label>
      <label class="setting-row">
        <span>Middle channel {Math.round(store.ayMiddle() * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          disabled={store.ayStereo() === "Mono"}
          value={store.ayMiddle()}
          onInput={(e) => store.setAyMiddle(Number(e.currentTarget.value))}
        />
      </label>
      <p class="machine-note">
        AY works in both 48K and 128K modes. Middle channel sets its
        contribution to each speaker.
      </p>
      <p class="machine-note">
        {store.muted() || store.masterVolume() === 0
          ? "Muted"
          : !store.soundEnabled() && !store.ayEnabled()
            ? "No sources enabled"
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
