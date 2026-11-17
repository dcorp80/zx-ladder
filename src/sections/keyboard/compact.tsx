/** biome-ignore-all lint/a11y/noNoninteractiveTabindex: The keyboard surface owns keyboard focus. */
import { createSignal, For, onCleanup } from "solid-js";
import type { SpectrumKey } from "../../devices/keyboard";
import { MACBOOK_ISO_KEYS } from "../../input/keyboardLayout";
import { useStore } from "../../store";

const keys: SpectrumKey[] = [
  ..."1234567890",
  ..."QWERTYUIOP",
  ..."ASDFGHJKL",
  "ENTER",
  "CAPS_SHIFT",
  ..."ZXCVBNM",
  "SYMBOL_SHIFT",
  "SPACE",
] as SpectrumKey[];
const modifiers = ["CS", "SS", "Extended"] as const;
type Modifier = (typeof modifiers)[number];
type Mode = "Normal" | Modifier | "Extended + SS";
export function CompactKeyboard() {
  const store = useStore();
  const [mode, setMode] = createSignal<Mode>("Normal");
  let surface!: HTMLDivElement;
  const extended = () => mode() === "Extended" || mode() === "Extended + SS";
  const selected = (modifier: Modifier) =>
    modifier === "Extended"
      ? extended()
      : modifier === "SS"
        ? mode() === "SS" || mode() === "Extended + SS"
        : mode() === "CS";
  const toggle = (modifier: Modifier) => {
    setMode((current) => {
      if (modifier === "Extended") return extended() ? "Normal" : "Extended";
      if (modifier === "CS")
        return current === "CS"
          ? "Normal"
          : current === "SS"
            ? "Extended"
            : "CS";
      return current === "SS"
        ? "Normal"
        : current === "CS"
          ? "Extended"
          : current === "Extended"
            ? "Extended + SS"
            : current === "Extended + SS"
              ? "Extended"
              : "SS";
    });
    surface.focus({ preventScroll: true });
  };
  const sources = new Set<number>();
  const release = (id: number) => {
    store.machine()?.keyboard.release(`compact:${id}`);
    sources.delete(id);
  };
  onCleanup(() => {
    for (const id of sources) release(id);
  });
  const pressed = (key: SpectrumKey) => {
    store.keyboardVersion();
    return store.machine()?.keyboard.isPressed(key) ?? false;
  };
  return (
    <div
      ref={surface}
      class="compact-keyboard"
      role="application"
      aria-label="Compact Spectrum keyboard"
      tabIndex={0}
      data-emulator-input="true"
    >
      <fieldset class="compact-modes" aria-label="Keyboard modifiers">
        <For each={modifiers}>
          {(item) => (
            <button
              type="button"
              tabIndex={-1}
              aria-pressed={selected(item)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                surface.focus({ preventScroll: true });
              }}
              onClick={() => toggle(item)}
            >
              {item}
            </button>
          )}
        </For>
      </fieldset>
      <div class="compact-keys">
        <For each={keys}>
          {(key) => {
            const cap = MACBOOK_ISO_KEYS.find(
              (cap) => cap.keys.length === 1 && cap.keys[0] === key,
            );
            const label =
              key === "CAPS_SHIFT"
                ? "CS"
                : key === "SYMBOL_SHIFT"
                  ? "SS"
                  : key === "ENTER"
                    ? "Enter"
                    : key === "SPACE"
                      ? "Space"
                      : key;
            const legend = () =>
              mode() === "Extended + SS"
                ? cap?.footer !== cap?.caption
                  ? cap?.footer
                  : ""
                : mode() === "Extended"
                  ? cap?.extra
                  : mode() === "SS"
                    ? cap?.symbol
                    : mode() === "CS"
                      ? /^[A-Z]$/.test(key)
                        ? key
                        : cap?.keyword
                      : cap?.keyword;
            return (
              <button
                type="button"
                tabIndex={-1}
                class="spectrum-key"
                classList={{ "is-pressed": pressed(key) }}
                aria-label={label}
                aria-pressed={pressed(key)}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  surface.focus({ preventScroll: true });
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const keyboard = store.machine()?.keyboard;
                  if (!keyboard) return;
                  sources.add(event.pointerId);
                  const source = `compact:${event.pointerId}`;
                  if (
                    extended() &&
                    key !== "CAPS_SHIFT" &&
                    key !== "SYMBOL_SHIFT"
                  )
                    keyboard.pressExtended(
                      source,
                      key,
                      mode() === "Extended + SS",
                    );
                  else
                    keyboard.press(source, [
                      ...(mode() === "CS" ? ["CAPS_SHIFT" as const] : []),
                      ...(mode() === "SS" ? ["SYMBOL_SHIFT" as const] : []),
                      key,
                    ]);
                }}
                onPointerUp={(event) => release(event.pointerId)}
                onPointerCancel={(event) => release(event.pointerId)}
                onLostPointerCapture={(event) => release(event.pointerId)}
                onClick={(event) => event.preventDefault()}
              >
                <span class="key-main">{label}</span>
                <span class="key-keyword">{legend()}</span>
              </button>
            );
          }}
        </For>
      </div>
      <p class="machine-note">
        Tap an active modifier to turn it off. CS + SS selects Extended and
        clears both shifts; then tap SS for shifted Extended keys. Extended
        enters E mode before the next key; hold briefly. Turning it off clears
        modifiers.
      </p>
    </div>
  );
}
