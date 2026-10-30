import type { Component } from "solid-js";
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
      subtitle="48K · no contention"
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
          <div>
            <dt>Position</dt>
            <dd>{store.status().framePosition.toLocaleString()}</dd>
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
