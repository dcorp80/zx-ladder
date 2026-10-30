import { createSignal, For, Show } from "solid-js";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";
export function FilesSection() {
  const store = useStore();
  let input!: HTMLInputElement;
  const [replacements, setReplacements] = createSignal<string[]>([]);
  const groups = () => [...new Set(store.files().map((f) => f.group))];
  const collisions = () =>
    store
      .pendingImport()
      ?.files.filter((f) => store.files().some((old) => old.id === f.id)) ?? [];
  return (
    <SectionFrame
      title="Files"
      subtitle="TAP / TZX library · flash loading"
      actions={
        <>
          <input
            ref={input}
            hidden
            type="file"
            multiple
            accept=".tap,.tzx,.zip"
            aria-label="Add TAP, TZX or ZIP files"
            onChange={(e) => {
              void store.importFiles(Array.from(e.currentTarget.files ?? []));
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            class="btn"
            disabled={store.filesBusy() || !!store.pendingImport()}
            onClick={() => input.click()}
          >
            Add…
          </button>
        </>
      }
    >
      <p class="file-status" role="status">
        {store.filesBusy() ? "Working…" : store.filesMessage()}
      </p>
      <Show when={store.pendingImport()}>
        <fieldset class="file-confirm" aria-label="Confirm file replacements">
          <p>
            These files already exist. Select files to replace; unchecked files
            will be skipped.
          </p>
          <For each={collisions()}>
            {(file) => (
              <label>
                <input
                  type="checkbox"
                  checked={replacements().includes(file.id)}
                  onChange={(e) =>
                    setReplacements((ids) =>
                      e.currentTarget.checked
                        ? [...ids, file.id]
                        : ids.filter((id) => id !== file.id),
                    )
                  }
                />
                {file.group ? `${file.group} / ` : ""}
                {file.name}
              </label>
            )}
          </For>
          <div class="file-actions">
            <button
              type="button"
              class="btn"
              disabled={store.filesBusy()}
              onClick={() => {
                void store.confirmImport(replacements());
                setReplacements([]);
              }}
            >
              Import selected
            </button>
            <button
              type="button"
              class="btn"
              disabled={store.filesBusy()}
              onClick={() => {
                store.cancelImport();
                setReplacements([]);
              }}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      </Show>
      <Show
        when={store.files().length}
        fallback={
          <p>Add or drop TAP, TZX and ZIP files anywhere in the emulator.</p>
        }
      >
        <For each={groups()}>
          {(group) => (
            <div class="file-group">
              <Show when={group || groups().length > 1}>
                <h3>{group ?? "Individual files"}</h3>
              </Show>
              <For each={store.files().filter((f) => f.group === group)}>
                {(file) => (
                  <div class="file-row">
                    <div class="file-name">
                      <strong>{file.name}</strong>
                      <small>
                        {file.size < 1024
                          ? `${file.size} bytes`
                          : `${(file.size / 1024).toFixed(1)} KiB`}
                        {file.warning ? ` · ${file.warning}` : ""}
                      </small>
                    </div>
                    <div class="file-actions">
                      <button
                        type="button"
                        class="btn"
                        disabled={store.filesBusy() || !store.machine()}
                        onClick={() => void store.loadFile(file.id)}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        class="btn"
                        disabled={store.filesBusy() || !!store.pendingImport()}
                        onClick={() => void store.deleteFile(file.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </Show>
      <p class="muted">
        Flash loading supports the standard 48K ROM loader. Custom tape loaders
        need pulse playback, which is not available yet.
      </p>
      <p class="file-status" role="status">
        {(() => {
          store.frameVersion();
          return store.machine()?.tape?.status ?? "";
        })()}
      </p>
    </SectionFrame>
  );
}
export const filesSection = {
  id: "files",
  title: "Files",
  Body: FilesSection,
  defaultFolded: false,
};
