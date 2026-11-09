/** biome-ignore-all lint/a11y/noNoninteractiveTabindex: The keyboard surface intentionally owns physical keyboard input; individual keycaps are not focus targets. */

import { For, onCleanup } from "solid-js";
import { CURSOR_MODES } from "../../input/kempstonInput";
import {
  KEYBOARD_LAYOUTS,
  keyboardLayout,
  type MACBOOK_ISO_KEYS,
  PC_LAYOUT_ID,
  pressHostKey,
  SHIFT_CODES,
} from "../../input/keyboardLayout";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";
import { CompactKeyboard } from "./compact";

function KeyboardSurface() {
  const store = useStore();
  const layout = () => keyboardLayout(store.keyboardLayout());
  let surface!: HTMLDivElement;
  const release = (pointerId: number) => {
    store.kempston.release(`pointer:${pointerId}`);
    store.machine()?.keyboard.release(`pointer:${pointerId}`);
  };
  onCleanup(() => {
    store.kempston.clearKeys();
    store.machine()?.keyboard.releaseAll();
  });
  const held = (
    code: string,
    keys: (typeof MACBOOK_ISO_KEYS)[number]["keys"],
  ) => {
    store.keyboardVersion();
    const arrowBit = (
      { ArrowLeft: 2, ArrowRight: 1, ArrowDown: 4, ArrowUp: 8 } as Record<
        string,
        number
      >
    )[code];
    if (arrowBit && store.kempston.mode() !== "Cursor")
      return {
        pressed: !!(store.kempston.heldBits() & arrowBit),
        physical: store.kempston.owns(`host:${code}`),
      };
    const keyboard = store.machine()?.keyboard;
    return {
      pressed:
        store.kempston.owns(`host:${code}`) ||
        (keyboard?.hasSource(`host:${code}`) ?? false) ||
        keys.every((key) => keyboard?.isPressed(key) ?? false),
      physical:
        store.kempston.owns(`host:${code}`) ||
        (keyboard?.hasSource(`host:${code}`) ?? false),
    };
  };
  return (
    <div class="keyboard-scroll">
      <div
        ref={surface}
        class="keyboard-surface"
        classList={{ "keyboard-pc": layout().id === PC_LAYOUT_ID }}
        style={{
          "aspect-ratio": `${layout().width} / ${layout().height * (layout().id === PC_LAYOUT_ID ? 1.65 : 1)}`,
          "min-width": layout().id === PC_LAYOUT_ID ? "1000px" : "760px",
        }}
        role="application"
        aria-label="Spectrum keyboard input"
        aria-describedby="keyboard-help"
        tabIndex={0}
        data-emulator-input="true"
        onPointerDown={(event) => {
          event.preventDefault();
          surface.focus({ preventScroll: true });
        }}
      >
        <For each={layout().keys}>
          {(cap) => (
            <button
              type="button"
              tabIndex={-1}
              class="spectrum-key"
              classList={{
                "is-pressed": held(cap.code, cap.keys).pressed,
                "is-physical": held(cap.code, cap.keys).physical,
                "iso-return": cap.code === "Enter",
                "is-combined": cap.combined,
              }}
              style={{
                left: `${(cap.x / layout().width) * 100}%`,
                top: `${(cap.y / layout().height) * 100}%`,
                width: `${(cap.width / layout().width) * 100}%`,
                height: `${(cap.height / layout().height) * 100}%`,
              }}
              aria-label={`${cap.caption}: ${store.kempston.caption(cap.code) ?? cap.chord}${cap.keyword ? `, ${cap.keyword}` : ""}`}
              aria-pressed={held(cap.code, cap.keys).pressed}
              title={`${cap.caption} → ${store.kempston.caption(cap.code) ?? cap.chord}${SHIFT_CODES[cap.code] ? ` · Host Shift: ${SHIFT_CODES[cap.code]}` : ""}${cap.extra ? ` · Extended: ${cap.extra}` : ""}`}
              onFocus={() => surface.focus({ preventScroll: true })}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                surface.focus({ preventScroll: true });
                event.currentTarget.setPointerCapture(event.pointerId);
                if (
                  store.kempston.press(`pointer:${event.pointerId}`, cap.code)
                )
                  return;
                const keyboard = store.machine()?.keyboard;
                if (keyboard)
                  pressHostKey(
                    keyboard,
                    `pointer:${event.pointerId}`,
                    cap.code,
                    event.shiftKey,
                    "",
                    layout().id,
                  );
              }}
              onPointerUp={(event) => release(event.pointerId)}
              onPointerCancel={(event) => release(event.pointerId)}
              onLostPointerCapture={(event) => release(event.pointerId)}
              onClick={(event) => event.preventDefault()}
            >
              <span class="key-extra">{cap.extra}</span>
              <span class="key-main">{cap.label}</span>
              <span class="key-keyword">
                {store.kempston.caption(cap.code) ?? cap.keyword}
              </span>
              <span
                class="key-symbol"
                title={
                  cap.combined && SHIFT_CODES[cap.code]
                    ? "Host Shift"
                    : "Symbol Shift"
                }
              >
                {cap.symbol}
              </span>
              <span
                class="key-host"
                title={
                  cap.footer !== cap.caption
                    ? "Extended mode + Shift"
                    : undefined
                }
              >
                {cap.footer}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
export function KeyboardSection() {
  const store = useStore();
  return (
    <SectionFrame
      title="Keyboard"
      subtitle={`${keyboardLayout(store.keyboardLayout()).label} · Spectrum legends`}
      defaultFolded={false}
    >
      <div class="keyboard-toolbar">
        <label>
          Keyboard layout{" "}
          <select
            value={store.keyboardLayout()}
            onChange={(event) =>
              store.setKeyboardLayout(event.currentTarget.value)
            }
          >
            <option value="auto">
              Automatic · {keyboardLayout("auto").label}
            </option>
            <For each={KEYBOARD_LAYOUTS}>
              {(layout) => <option value={layout.id}>{layout.label}</option>}
            </For>
          </select>
        </label>
        <span class="muted">
          Control = Caps Shift · Alt / Option = Symbol Shift
        </span>
      </div>
      <label class="setting-row">
        <span>Keyboard color</span>
        <select
          value={store.keyboardColor()}
          onChange={(event) =>
            store.setKeyboardColor(
              event.currentTarget.value as "theme" | "light" | "dark",
            )
          }
        >
          <option value="theme">Follow theme</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <div class="keyboard-colors" data-keyboard-color={store.keyboardColor()}>
        <div class="desktop-keyboard">
          <KeyboardSurface />
        </div>
        <CompactKeyboard />
        <fieldset class="cursor-modes" aria-label="Cursor key mode">
          <legend>Cursor keys</legend>
          <For each={CURSOR_MODES}>
            {(mode) => (
              <label>
                <input
                  type="radio"
                  name="cursor-mode"
                  checked={store.kempston.mode() === mode}
                  onChange={() => store.kempston.setMode(mode)}
                />
                <span>
                  {mode}
                  {mode === "Sinclair I"
                    ? " (67890)"
                    : mode === "Sinclair II"
                      ? " (12345)"
                      : ""}
                </span>
              </label>
            )}
          </For>
        </fieldset>
        <p class="machine-note">Reset and Cold restart restore Cursor mode.</p>
      </div>
      <p id="keyboard-help" class="machine-note">
        Click the screen or keyboard to type. Hold keys with mouse, touch, or
        your keyboard. Cursor mode keeps Space and Return as normal Spectrum
        keys. Ivory keys hold combinations: CS = Caps Shift, SS = Symbol Shift.
        Layout choices are saved.
      </p>
    </SectionFrame>
  );
}
export const keyboardSection = {
  id: "keyboard",
  title: "Keyboard",
  Body: KeyboardSection,
  defaultFolded: false,
};
