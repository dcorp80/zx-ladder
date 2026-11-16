import { type Component, For } from "solid-js";
import { useStore } from "../../store";

export const RomControls: Component = () => {
  const store = useStore();

  const chooseFile = (input: HTMLInputElement, slot: 0 | 1) => {
    const file = input.files?.[0];
    if (!file) return;
    void store.importRom(file, slot).finally(() => {
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
        <div class="rom-slots">
          <For each={[0, 1] as const}>
            {(slot) => (
              <fieldset class="rom-slot">
                <legend>ROM{slot}</legend>
                <span
                  class="rom-name"
                  classList={{ muted: !store.rom()?.pageNames?.[slot] }}
                  title={store.rom()?.pageNames?.[slot] ?? "Empty"}
                >
                  {store.rom()?.pageNames?.[slot] ?? "Empty"}
                </span>
                <div class="rom-picker-row">
                  <button
                    type="button"
                    class="btn"
                    disabled={store.filesBusy()}
                    onClick={() =>
                      void (slot === 0
                        ? store.useBundled128Rom()
                        : store.useBundled48Rom())
                    }
                  >
                    Use bundled {slot === 0 ? "128K" : "48K"} ROM
                  </button>
                  <label class="file-picker btn btn-accent">
                    <span>Choose ROM{slot} file</span>
                    <input
                      type="file"
                      aria-label={`Choose ROM${slot} file`}
                      accept=".rom,application/octet-stream"
                      disabled={store.filesBusy()}
                      onChange={(event) =>
                        chooseFile(event.currentTarget, slot)
                      }
                    />
                  </label>
                </div>
                <p class="rom-help">
                  {slot === 0
                    ? "16 KiB replaces ROM0 only; 32 KiB replaces both slots."
                    : "16 or 32 KiB replaces ROM1 only, using the first 16 KiB. For 48K startup, enable 48K mode."}
                </p>
              </fieldset>
            )}
          </For>
        </div>
        <p class="rom-help">
          Replacing a ROM cold boots the machine and clears RAM. Running or
          paused state is retained; 48K mode is unchanged.
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
