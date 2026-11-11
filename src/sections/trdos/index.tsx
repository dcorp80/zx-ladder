import {
  createEffect,
  createMemo,
  createSignal,
  Index,
  on,
  Show,
} from "solid-js";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";
export function TrdosSection() {
  const store = useStore();
  const [open, setOpen] = createSignal(0);
  const mountedId = createMemo(() => store.disk()?.id);
  const needsRom = createMemo(() => store.disk()?.romRequired);
  createEffect(
    on([mountedId, store.diskChangePending, needsRom], () => {
      if (store.disk()?.id || store.diskChangePending() || needsRom())
        setOpen((n) => n + 1);
    }),
  );
  let input!: HTMLInputElement;
  return (
    <SectionFrame
      title="TR-DOS"
      subtitle="Beta Disk · drive A"
      openRequest={open()}
    >
      <input
        ref={input}
        hidden
        type="file"
        accept=".rom,.bin"
        aria-label="Select TR-DOS ROM"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void store.importDosRom(file);
          e.currentTarget.value = "";
        }}
      />
      <button
        class="btn"
        type="button"
        disabled={store.filesBusy()}
        onClick={() => input.click()}
      >
        Select ROM…
      </button>
      <Show when={store.dosRom()}>
        <button
          class="btn"
          type="button"
          disabled={store.filesBusy()}
          onClick={() => void store.removeDosRom()}
        >
          Remove ROM
        </button>
      </Show>
      <p role="status">
        {store.dosRom()?.name ?? "No TR-DOS ROM"} · {store.dosRomStatus()}
      </p>
      <Show when={store.disk()?.romRequired}>
        <p role="alert">You need to provide TR-DOS ROM</p>
        <p>
          Choose a ROM, then press Run to retry. If it cannot continue, reset
          and load again.
        </p>
        <button class="btn" type="button" onClick={() => input.click()}>
          Provide ROM…
        </button>
        <button class="btn" type="button" onClick={() => store.run()}>
          Retry
        </button>
        <button
          class="btn"
          type="button"
          onClick={() => {
            store.setReset(true);
            store.setReset(false);
            store.run();
          }}
        >
          Reset
        </button>
        <button class="btn" type="button" onClick={() => store.coldBoot()}>
          Cold boot
        </button>
      </Show>
      <Show
        when={store.disk()?.id}
        fallback={<p>No disk mounted. Load a TRD or SCL image from Files.</p>}
      >
        <p>
          {store.disk()?.name}{" "}
          {store.disk()?.dirty ? "· Modified — download to keep changes" : ""}
        </p>
        <button
          class="btn"
          type="button"
          disabled={store.filesBusy()}
          onClick={() => void store.ejectDisk()}
        >
          Eject
        </button>
        <button
          class="btn"
          type="button"
          disabled={store.filesBusy()}
          onClick={() => void store.downloadDisk()}
        >
          Download TRD
        </button>
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Bytes</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <Index each={store.disk()?.catalog}>
              {(file) => (
                <tr>
                  <td>
                    {file().name}.{file().ext}
                  </td>
                  <td>
                    {file().ext === "B" ? file().parameter : file().length}
                  </td>
                  <td>
                    <Show when={file().ext === "B"}>
                      <button
                        class="btn"
                        type="button"
                        disabled={
                          store.filesBusy() ||
                          (!store.dosRom() && !!file().warning)
                        }
                        title={!store.dosRom() ? file().warning : undefined}
                        onClick={() => void store.runDisk(file().index)}
                      >
                        Run
                      </button>
                    </Show>
                  </td>
                </tr>
              )}
            </Index>
          </tbody>
        </table>
      </Show>
      <Show when={store.diskChangePending()}>
        <div role="dialog" aria-label="Keep modified disk" aria-modal="true">
          <p>This disk has changes. Download them before continuing?</p>
          <button
            class="btn"
            type="button"
            onClick={() => store.resolveDiskChange("download")}
          >
            Download
          </button>
          <button
            class="btn"
            type="button"
            onClick={() => store.resolveDiskChange("discard")}
          >
            Discard
          </button>
          <button
            class="btn"
            type="button"
            onClick={() => store.resolveDiskChange("cancel")}
          >
            Cancel
          </button>
        </div>
      </Show>
    </SectionFrame>
  );
}
export const trdosSection = {
  id: "trdos",
  title: "TR-DOS",
  Body: TrdosSection,
  defaultFolded: false,
};
