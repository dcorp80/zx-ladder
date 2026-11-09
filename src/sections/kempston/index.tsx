import { For, Show } from "solid-js";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";

export function KempstonSection() {
  const store = useStore();
  const hid = store.kempston;
  return (
    <SectionFrame
      title="Kempston"
      subtitle="Mouse and joystick"
      defaultFolded={false}
    >
      <fieldset class="kempston-group">
        <legend>Mouse</legend>
        <label class="setting-row">
          <span>Enable mouse</span>
          <input
            type="checkbox"
            checked={hid.settings().mouseEnabled}
            onChange={(e) =>
              hid.configure({ mouseEnabled: e.currentTarget.checked })
            }
          />
        </label>
        <label class="setting-row">
          <span>Swap left/right buttons</span>
          <input
            type="checkbox"
            checked={hid.settings().swapButtons}
            onChange={(e) =>
              hid.configure({ swapButtons: e.currentTarget.checked })
            }
          />
        </label>
        <Show when={store.mouseAccessed()}>
          <p class="machine-note">Program accessed Kempston mouse</p>
        </Show>
        <div class="kempston-actions">
          <button
            type="button"
            class="btn"
            disabled={!store.machine()}
            onClick={() => void hid.capture()}
          >
            Capture mouse
          </button>
          <span role="status">{hid.captureStatus()}</span>
        </div>
        <p class="machine-note">
          With mouse enabled, clicking the screen captures only after the
          program reads a mouse port. Reset and Cold boot clear this permission.
          Capture mouse is always available. Use the browser’s standard release
          gesture (usually Escape). Programs with mouse support draw their own
          cursor.
        </p>
      </fieldset>
      <fieldset class="kempston-group">
        <legend>Joystick</legend>
        <label class="setting-row">
          <span>Keyboard fire key</span>
          <select
            value={hid.settings().fireKey}
            onChange={(e) =>
              hid.configure({
                fireKey: e.currentTarget.value as "Space" | "Enter" | "Digit0",
              })
            }
          >
            <option value="Space">Space</option>
            <option value="Enter">Enter</option>
            <option value="Digit0">0</option>
          </select>
        </label>
        <label class="setting-row">
          <span>Suppress Spectrum key</span>
          <input
            type="checkbox"
            checked={hid.settings().suppressKey}
            onChange={(e) =>
              hid.configure({ suppressKey: e.currentTarget.checked })
            }
          />
        </label>
        <p class="machine-note">
          Fire settings apply to Sinclair and Kempston keyboard modes. Turn
          suppression off to also send the key’s normal Spectrum input. Cursor
          mode keeps normal typing.
        </p>
        <p role="status">
          Kempston source:{" "}
          {hid.mode() === "Kempston"
            ? "Keyboard"
            : hid.settings().gamepadEnabled && hid.pads().length
              ? "Gamepad"
              : "None"}
        </p>
        <Show when={hid.pads().length > 0}>
          <label class="setting-row">
            <span>Enable gamepad</span>
            <input
              type="checkbox"
              checked={hid.settings().gamepadEnabled}
              onChange={(e) =>
                hid.configure({ gamepadEnabled: e.currentTarget.checked })
              }
            />
          </label>
          <Show
            when={hid.pads().length > 1}
            fallback={<p class="machine-note">{hid.pads()[0]?.id}</p>}
          >
            <label class="setting-row">
              <span>Gamepad</span>
              <select
                value={hid.selected()}
                onChange={(e) => hid.selectPad(Number(e.currentTarget.value))}
              >
                <For each={hid.pads()}>
                  {(pad) => (
                    <option value={pad.index}>
                      {pad.id} ({pad.index + 1})
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
          <p class="machine-note">
            D-pad or left stick moves · Primary button fires. Click the screen
            or keyboard to play.
          </p>
          <Show when={hid.mode() === "Kempston"}>
            <p>Keyboard controls Kempston</p>
            <button
              type="button"
              class="btn"
              disabled={!hid.settings().gamepadEnabled}
              onClick={() => {
                hid.useGamepad();
                store.focusScreen();
              }}
            >
              Use gamepad
            </button>
          </Show>
        </Show>
      </fieldset>
      <p class="machine-note">
        Kempston joystick and mouse ports are inaccessible while DOS is active.
      </p>
    </SectionFrame>
  );
}
export const kempstonSection = {
  id: "kempston",
  title: "Kempston",
  Body: KempstonSection,
  defaultFolded: false,
};
