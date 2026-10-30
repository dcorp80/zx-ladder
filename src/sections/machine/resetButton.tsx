import { createSignal, onCleanup, onMount } from "solid-js";
import { useStore } from "../../store";

export function ResetButton() {
  const store = useStore();
  const [pressed, setPressed] = createSignal(false);
  let pointer: number | undefined;
  const keys = new Set<string>();
  const update = () => {
    const held = pointer !== undefined || keys.size > 0;
    setPressed(held);
    store.setReset(held);
  };
  const release = () => {
    pointer = undefined;
    keys.clear();
    update();
  };
  onMount(() => window.addEventListener("blur", release));
  onCleanup(() => {
    window.removeEventListener("blur", release);
    release();
  });
  return (
    <button
      type="button"
      class="btn"
      aria-pressed={pressed()}
      disabled={!store.machine()}
      title="Hold CPU reset (minimum six half-cycles)"
      style={{ "touch-action": "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer !== undefined) return;
        pointer = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update();
      }}
      onPointerUp={(event) => {
        if (event.pointerId !== pointer) return;
        pointer = undefined;
        update();
        if (!pressed()) store.focusScreen();
      }}
      onPointerCancel={release}
      onLostPointerCapture={() => {
        pointer = undefined;
        update();
      }}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        keys.add(event.key);
        update();
      }}
      onKeyUp={(event) => {
        if (!keys.delete(event.key)) return;
        event.preventDefault();
        update();
        if (!pressed()) store.focusScreen();
      }}
      onBlur={release}
      onClick={(event) => {
        // Assistive technologies can activate a button without press events.
        if (event.detail === 0 && !pressed()) {
          store.setReset(true);
          store.setReset(false);
          store.focusScreen();
        }
      }}
    >
      Reset
    </button>
  );
}
