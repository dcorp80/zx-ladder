import { createMemo, Index, Show } from "solid-js";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";

export function TapeSection() {
  const store = useStore();
  const catalog = createMemo(() => store.tape()?.catalog ?? []);
  const mountedName = createMemo(() => store.tape()?.name);
  const headerRun = createMemo(() => {
    const runnable = catalog().filter((block) => block.runnable);
    return runnable.length === 1 ? runnable[0] : undefined;
  });
  const cursor = () => store.tape()?.cursor ?? 0;
  return (
    <SectionFrame
      title="Tape"
      subtitle={mountedName() ?? "TAP / TZX · flash loading"}
      actions={
        <Show when={headerRun()}>
          {(block) => (
            <button
              class="btn"
              type="button"
              aria-label="Run tape"
              title="Reset and run this BASIC program"
              disabled={store.filesBusy()}
              onClick={() => void store.runTape(block().index)}
            >
              Run
            </button>
          )}
        </Show>
      }
    >
      <div class="media-content">
        <Show
          when={store.tape()?.name}
          fallback={
            <p class="media-empty">
              No tape mounted. Mount or Load a TAP or TZX image from Files.
            </p>
          }
        >
          <div class="media-actions">
            <button
              class="btn"
              type="button"
              disabled={store.filesBusy()}
              onClick={() => void store.seekTape(0)}
            >
              Rewind
            </button>
            <button
              class="btn"
              type="button"
              disabled={store.filesBusy()}
              onClick={() => void store.ejectTape()}
            >
              Eject
            </button>
          </div>
          <p class="media-status" role="status">
            {cursor() < catalog().length
              ? `Next block: ${cursor() + 1} of ${catalog().length}`
              : "End of tape"}
            {" · "}
            {store.tape()?.status}
          </p>
          <p>
            Enter <code>LOAD ""</code> in BASIC to read from the selected
            position. Rewind to load again.
          </p>
          <div class="media-catalog">
            <table>
              <caption>Flash-load blocks in playback order</caption>
              <thead>
                <tr>
                  <th>Block</th>
                  <th>File</th>
                  <th>Type</th>
                  <th>Bytes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <Index each={catalog()}>
                  {(block) => (
                    <tr
                      aria-current={
                        store.tape()?.cursor === block().index
                          ? "step"
                          : undefined
                      }
                    >
                      <td>
                        {block().index + 1}
                        {store.tape()?.cursor === block().index ? " →" : ""}
                      </td>
                      <td>{block().name ?? "—"}</td>
                      <td>
                        {block().type} · flag {block().flag}
                        <Show when={!block().checksumValid}>
                          <span class="media-warning"> · Checksum error</span>
                        </Show>
                      </td>
                      <td>{block().bytes}</td>
                      <td>
                        <div class="media-actions">
                          <button
                            class="btn"
                            type="button"
                            aria-label={`Select block ${block().index + 1}`}
                            disabled={store.filesBusy()}
                            onClick={() => void store.seekTape(block().index)}
                          >
                            Select
                          </button>
                          <Show when={block().runnable}>
                            <button
                              class="btn"
                              type="button"
                              aria-label={`Run block ${block().index + 1}`}
                              title="Reset and run this BASIC program"
                              disabled={store.filesBusy()}
                              onClick={() => void store.runTape(block().index)}
                            >
                              Run
                            </button>
                          </Show>
                        </div>
                      </td>
                    </tr>
                  )}
                </Index>
              </tbody>
            </table>
          </div>
        </Show>
        <p class="muted">
          TZX lists the resolved data blocks used by flash loading. Pulse
          playback and resuming beyond TZX stop markers are not available yet.
        </p>
      </div>
    </SectionFrame>
  );
}

export const tapeSection = {
  id: "tape",
  title: "Tape",
  Body: TapeSection,
  defaultFolded: false,
};
