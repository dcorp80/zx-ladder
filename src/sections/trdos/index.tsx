import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  Show,
} from "solid-js";
import type { DiskDrive } from "../../devices/betaDisk";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";

export function TrdosSection() {
  const store = useStore();
  const [open, setOpen] = createSignal(0);
  const mountedIds = createMemo(() =>
    store
      .disks()
      ?.map((disk) => disk.id)
      .join("\n"),
  );
  const needsRom = createMemo(() =>
    store.disks()?.some((disk) => disk.romRequired),
  );
  createEffect(
    on([mountedIds, store.diskChangePending, needsRom], () => {
      if (
        store.disks()?.some((disk) => disk.id) ||
        store.diskChangePending() ||
        needsRom()
      )
        setOpen((n) => n + 1);
    }),
  );
  let input!: HTMLInputElement;
  const drives: readonly DiskDrive[] = [0, 1];
  return (
    <SectionFrame
      title="TR-DOS"
      subtitle="Beta Disk · drives A / B"
      openRequest={open()}
    >
      <div class="media-content">
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
        <div class="media-actions">
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
        </div>
        <p class="media-status" role="status">
          {store.dosRom()?.name ?? "No TR-DOS ROM"} · {store.dosRomStatus()}
        </p>
        <Show when={needsRom()}>
          <div class="media-notice">
            <p role="alert">You need to provide TR-DOS ROM</p>
            <p>
              Choose a ROM, then press Retry. If it cannot continue, reset and
              load again.
            </p>
            <div class="media-actions">
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
              <button
                class="btn"
                type="button"
                onClick={() => store.coldBoot()}
              >
                Cold boot
              </button>
            </div>
          </div>
        </Show>
        <div class="disk-drives">
          <For each={drives}>
            {(drive) => {
              const label = drive === 0 ? "Drive A" : "Drive B";
              const disk = () => store.disks()?.[drive];
              return (
                <section
                  class="disk-drive"
                  classList={{
                    "disk-drive-a": drive === 0,
                    "disk-drive-b": drive === 1,
                  }}
                  aria-label={label}
                >
                  <h3 class="media-heading">{label}</h3>
                  <Show
                    when={disk()?.id}
                    fallback={
                      <p class="media-empty">
                        No disk mounted. Mount a TRD or SCL image from Files.
                      </p>
                    }
                  >
                    <p class="media-name">{disk()?.name}</p>
                    <div class="media-actions">
                      <button
                        class="btn"
                        type="button"
                        disabled={store.filesBusy()}
                        onClick={() => void store.ejectDisk(drive)}
                      >
                        Eject
                      </button>
                      <button
                        class="btn"
                        type="button"
                        disabled={store.filesBusy()}
                        onClick={() => void store.downloadDisk(drive)}
                      >
                        Download TRD
                      </button>
                    </div>
                    <p class="media-status" role="status">
                      {disk()?.catalog.length ?? 0}{" "}
                      {disk()?.catalog.length === 1 ? "file" : "files"}
                      {disk()?.dirty
                        ? " · Modified — download to keep changes"
                        : ""}
                    </p>
                    <div class="media-catalog">
                      <table>
                        <caption>{label} catalog</caption>
                        <thead>
                          <tr>
                            <th>File</th>
                            <th>Type</th>
                            <th>Bytes</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          <Index each={disk()?.catalog}>
                            {(file) => (
                              <tr>
                                <td>
                                  {file().name}.{file().ext}
                                </td>
                                <td>
                                  {file().ext === "B"
                                    ? "BASIC"
                                    : file().ext === "C"
                                      ? "CODE"
                                      : file().ext}
                                </td>
                                <td>
                                  {file().ext === "B"
                                    ? file().parameter
                                    : file().length}
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
                                      title={
                                        !store.dosRom()
                                          ? file().warning
                                          : undefined
                                      }
                                      onClick={() =>
                                        void store.runDisk(file().index, drive)
                                      }
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
                    </div>
                  </Show>
                </section>
              );
            }}
          </For>
        </div>
        <Show when={store.diskChangePending()}>
          <div
            class="media-notice"
            role="dialog"
            aria-label="Keep modified disk"
            aria-modal="true"
          >
            <p>
              Drive {store.diskChangePendingDrive() === 1 ? "B" : "A"} has
              changes. Download them before continuing?
            </p>
            <div class="media-actions">
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
          </div>
        </Show>
      </div>
    </SectionFrame>
  );
}
export const trdosSection = {
  id: "trdos",
  title: "TR-DOS",
  Body: TrdosSection,
  defaultFolded: false,
};
