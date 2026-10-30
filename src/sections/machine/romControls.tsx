import { type Component, Show } from "solid-js";
import { ROM_SIZE } from "../../storage/types";
import { useStore } from "../../store";

export const RomControls: Component = () => {
  const store = useStore();
  let input!: HTMLInputElement;

  const chooseFile = () => {
    const file = input.files?.[0];
    if (!file) return;
    void store.importRom(file).finally(() => {
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
          The file must be exactly {ROM_SIZE.toLocaleString()} bytes. A larger
          or smaller file is rejected without replacing the active ROM.
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
