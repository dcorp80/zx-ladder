import { type Component, createSignal, Show } from "solid-js";
import { useStore } from "../../store";

export const RomControls: Component = () => {
  const store = useStore();
  let input!: HTMLInputElement;
  const [as128, setAs128] = createSignal(false);

  const chooseFile = () => {
    const file = input.files?.[0];
    if (!file) return;
    void store.importRom(file, as128()).finally(() => {
      input.value = "";
    });
  };

  return (
    <div class="rom-controls">
      <div class="rom-controls-heading">
        <h3>ROM</h3>
        <span
          class="status-pill"
          classList={{
            "is-warning":
              store.storage().state === "error" || !store.storage().persistent,
          }}
        >
          {store.storage().state === "error"
            ? "persistence failed"
            : store.storage().persistent
              ? "persistent"
              : "session-only"}
        </span>
      </div>
      <div class="rom-layout">
        <div class="rom-picker-row">
          <select
            aria-label="ROM file role"
            value={as128() ? "128" : "48"}
            onChange={(event) => setAs128(event.currentTarget.value === "128")}
          >
            <option value="48">48K ROM / complete ROM pair</option>
            <option value="128">128K ROM (add 48K part if needed)</option>
          </select>
          <button
            type="button"
            class="btn"
            onClick={() => void store.useBundled128Rom()}
          >
            Use bundled 128K ROM
          </button>
          <label class="file-picker btn btn-accent">
            <span>Choose ROM file</span>
            <input
              ref={input}
              type="file"
              accept=".rom,application/octet-stream"
              onChange={chooseFile}
            />
          </label>
          <Show
            when={store.rom()}
            fallback={<span class="muted">No ROM selected</span>}
          >
            {(selected) => (
              <span class="rom-name" title={selected().name}>
                {selected().name}
              </span>
            )}
          </Show>
        </div>
        <p class="rom-help">
          Choose a 16 KiB ROM or a 32 KiB ROM pair. For a 16 KiB 128K ROM, the
          bundled 48K ROM supplies the second page. Selecting a ROM cold boots
          the machine.
        </p>
        <p
          class="storage-message"
          classList={{
            "is-error": store.storage().state === "error",
            "is-warning": store.storage().state === "session-only",
          }}
          role="status"
        >
          {store.storage().message}
        </p>
      </div>
    </div>
  );
};
