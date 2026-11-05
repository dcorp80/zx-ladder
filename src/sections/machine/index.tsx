import type { Component } from "solid-js";
import { CPU_LOAD_SAMPLE_FRAMES } from "../../machine/config";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";
import { ResetButton } from "./resetButton";
import { RomControls } from "./romControls";

function hex(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

export const MachineSection: Component = () => {
  const store = useStore();
  return (
    <SectionFrame
      title="Machine"
      subtitle={`${store.rom()?.bytes.length === 32768 ? "128K" : "48K"} · no contention`}
      defaultFolded={false}
      actions={
        <span
          class="status-pill"
          classList={{ "is-running": store.isRunning() }}
        >
          {store.isRunning() ? "running" : "paused"}
        </span>
      }
    >
      <div class="machine-controls">
        <div class="control-row control-row-primary">
          <button
            type="button"
            class="btn btn-accent"
            onClick={() => (store.isRunning() ? store.pause() : store.run())}
            disabled={!store.machine()}
          >
            {store.isRunning() ? "Pause" : "Run"}
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => store.stepFrame()}
            disabled={!store.machine() || store.isRunning()}
          >
            Step frame
          </button>
          <ResetButton />
          <button
            type="button"
            class="btn btn-danger"
            onClick={() => store.coldBoot()}
            disabled={!store.rom() || store.isRunning()}
          >
            Cold boot
          </button>
        </div>
        <div class="control-row">
          <label class="setting-row setting-check">
            <input
              type="checkbox"
              checked={store.freeRun()}
              onChange={(event) =>
                store.setFreeRun(event.currentTarget.checked)
              }
            />
            <span>Free run (maximum speed)</span>
          </label>
          <label class="setting-row setting-check">
            <input
              type="checkbox"
              checked={store.turbo()}
              title="Speed changes on the next nM1 low-to-high transition"
              onChange={(event) => store.setTurbo(event.currentTarget.checked)}
            />
            <span>Turbo CPU (7 MHz; video clock remains fixed)</span>
          </label>
        </div>
        <label class="setting-row setting-check">
          <input
            type="checkbox"
            checked={store.decodeFd()}
            title="FD also matches FFFD/BFFD sound ports; use standard 128K for the bundled 128K ROM."
            onChange={(event) => store.setDecodeFd(event.currentTarget.checked)}
          />
          <span>
            Decode paging port by low byte (FD instead of standard 128K
            decoding)
          </span>
        </label>
        <p class="muted">
          FD also matches FFFD/BFFD sound ports. Use standard 128K for the
          bundled 128K ROM.
        </p>
        <dl class="machine-status machine-meters" aria-live="polite">
          <div>
            <dt>Frames</dt>
            <dd>{store.status().frames.toLocaleString()}</dd>
          </div>
          <div>
            <dt>PC</dt>
            <dd>0x{hex(store.status().pc, 4)}</dd>
          </div>
          <div>
            <dt>Ticks</dt>
            <dd>{store.status().ticks.toLocaleString()}</dd>
          </div>
          <div
            title={`Emulated CPU activity: percentage of 7 MHz slots outside HALT averaged over ${CPU_LOAD_SAMPLE_FRAMES} frames; not host CPU usage.}`}
          >
            <dt>CPU load</dt>
            <dd>
              {store.status().cpuLoad === null
                ? "—"
                : `${store.status().cpuLoad?.toFixed(1)}%`}
            </dd>
          </div>
          <div>
            <dt>Position</dt>
            <dd>{store.status().framePosition.toLocaleString()}</dd>
          </div>
        </dl>
        <dl
          class="machine-status machine-meters"
          aria-label="Memory mapping"
          aria-live="polite"
        >
          <div title="RAM page mapped at C000–FFFF">
            <dt>RAM page</dt>
            <dd>{store.status().memoryMapping?.ramPage ?? "—"}</dd>
          </div>
          <div title="ROM page mapped at 0000–3FFF">
            <dt>ROM</dt>
            <dd>{store.status().memoryMapping?.romPage ?? "—"}</dd>
          </div>
          <div title="Physical RAM page used for the display">
            <dt>Screen page</dt>
            <dd>{store.status().memoryMapping?.screenPage ?? "—"}</dd>
          </div>
        </dl>
        <RomControls />
      </div>
    </SectionFrame>
  );
};

export const machineSection = {
  id: "machine",
  title: "Machine",
  Body: MachineSection,
  defaultFolded: false,
};
