import type { KeyboardDevice } from "../devices/keyboard";
import {
  EXTENDED_CODES,
  HOST_KEYS,
  pressHostKey,
  shiftedCharacter,
} from "./keyboardLayout";

/** Owns only browser event routing; the hardware device owns the switch state. */
export function attachKeyboardInput(
  getKeyboard: () => KeyboardDevice | undefined,
  doc: Document = document,
  getLayout: () => string = () => "macbook-pro-iso",
): () => void {
  const win = doc.defaultView;
  const ownsFocus = () =>
    doc.activeElement?.matches('[data-emulator-input="true"]') === true;
  const release = () => {
    const keyboard = getKeyboard();
    if (keyboard) {
      keyboard.capsSyncActive = false;
      keyboard.releaseAll();
    }
  };
  const observeCaps = (
    event: KeyboardEvent | PointerEvent,
    active: boolean,
  ) => {
    const keyboard = getKeyboard();
    if (!keyboard) return;
    keyboard.observeHostCapsLock(event.getModifierState("CapsLock"));
    keyboard.capsSyncActive = active;
  };
  const capsEvent = (event: KeyboardEvent): boolean => {
    const active = ownsFocus() && !event.isComposing && !event.metaKey;
    observeCaps(event, active);
    if (event.code !== "CapsLock" && event.key !== "CapsLock") return false;
    if (active) event.preventDefault();
    return true;
  };
  const pointer = (event: PointerEvent) => {
    const target = event.target;
    observeCaps(
      event,
      target instanceof Element &&
        target.closest('[data-emulator-input="true"]') !== null,
    );
  };
  const down = (event: KeyboardEvent) => {
    if (
      event.metaKey ||
      event.code === "MetaLeft" ||
      event.code === "MetaRight"
    ) {
      release();
      return;
    }
    if (capsEvent(event)) return;
    if (!ownsFocus() || event.isComposing) return;
    if (event.code === "Escape") {
      release();
      (doc.activeElement as HTMLElement)?.blur();
      return;
    }
    const key =
      HOST_KEYS[event.code] ||
      EXTENDED_CODES[event.code] ||
      (event.shiftKey && shiftedCharacter(event.code, event.key));
    const keyboard = getKeyboard();
    if (!key || !keyboard) return;
    event.preventDefault();
    // A repeated event after focus loss must not acquire a key again.
    if (!event.repeat)
      pressHostKey(
        keyboard,
        `host:${event.code}`,
        event.code,
        event.shiftKey,
        event.key,
        getLayout(),
      );
  };
  const up = (event: KeyboardEvent) => {
    if (capsEvent(event)) return;
    const keyboard = getKeyboard();
    if (!keyboard?.hasSource(`host:${event.code}`)) return;
    keyboard.release(`host:${event.code}`);
    if (ownsFocus()) event.preventDefault();
  };
  const focusIn = () => {
    if (!ownsFocus()) release();
    else {
      const keyboard = getKeyboard();
      if (keyboard) keyboard.capsSyncActive = true;
    }
  };
  const focusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (
      !(next instanceof Element) ||
      !next.matches('[data-emulator-input="true"]')
    )
      release();
  };
  const visibility = () => {
    if (doc.hidden) release();
  };
  doc.addEventListener("pointerdown", pointer, true);
  doc.addEventListener("keydown", down);
  doc.addEventListener("keyup", up);
  doc.addEventListener("focusin", focusIn);
  doc.addEventListener("focusout", focusOut);
  doc.addEventListener("visibilitychange", visibility);
  doc.addEventListener("compositionstart", release);
  win?.addEventListener("blur", release);
  return () => {
    release();
    doc.removeEventListener("pointerdown", pointer, true);
    doc.removeEventListener("keydown", down);
    doc.removeEventListener("keyup", up);
    doc.removeEventListener("focusin", focusIn);
    doc.removeEventListener("focusout", focusOut);
    doc.removeEventListener("visibilitychange", visibility);
    doc.removeEventListener("compositionstart", release);
    win?.removeEventListener("blur", release);
  };
}
