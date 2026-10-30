import { expect, it } from "vitest";
import { KeyboardDevice } from "../devices/keyboard";
import { attachKeyboardInput } from "./keyboardInput";

it("routes raw keys only to focused input surfaces and releases on configuration focus", () => {
  const k = new KeyboardDevice();
  const screen = document.createElement("canvas"),
    keyboard = document.createElement("div"),
    config = document.createElement("input");
  for (const el of [screen, keyboard]) {
    el.tabIndex = 0;
    el.dataset.emulatorInput = "true";
  }
  document.body.append(screen, keyboard, config);
  const detach = attachKeyboardInput(() => k);
  const event = (
    type: string,
    code: string,
    extras: KeyboardEventInit = {},
  ) => {
    const e = new KeyboardEvent(type, {
      code,
      bubbles: true,
      cancelable: true,
      ...extras,
    });
    document.activeElement?.dispatchEvent(e);
    return e;
  };
  try {
    screen.focus();
    expect(event("keydown", "KeyA").defaultPrevented).toBe(true);
    event("keydown", "KeyA", { repeat: true });
    expect(k.isPressed("A")).toBe(true);
    keyboard.focus();
    expect(k.isPressed("A")).toBe(true);
    event("keyup", "KeyA");
    expect(k.isPressed("A")).toBe(false);
    event("keydown", "AltLeft");
    event("keydown", "AltRight");
    event("keyup", "AltLeft");
    expect(k.isPressed("SYMBOL_SHIFT")).toBe(true);
    event("keydown", "Space");
    event("keydown", "Enter");
    expect(k.isPressed("SPACE")).toBe(true);
    expect(k.isPressed("ENTER")).toBe(true);
    expect(event("keydown", "ShiftLeft").defaultPrevented).toBe(false);
    expect(k.isPressed("CAPS_SHIFT")).toBe(false);
    config.focus();
    expect(k.readRows(0)).toBe(31);
    expect(event("keydown", "KeyB").defaultPrevented).toBe(false);
    expect(k.isPressed("B")).toBe(false);
    screen.focus();
    event("keydown", "KeyA", { repeat: true });
    expect(k.isPressed("A")).toBe(false);
    event("keydown", "KeyA");
    window.dispatchEvent(new Event("blur"));
    expect(k.readRows(0)).toBe(31);
    event("keydown", "KeyA");
    event("keydown", "MetaLeft", { metaKey: true });
    expect(k.readRows(0)).toBe(31);
  } finally {
    detach();
    screen.remove();
    keyboard.remove();
    config.remove();
  }
});

it("holds and releases shared shortcut modifiers without stealing other inputs", () => {
  const k = new KeyboardDevice();
  const surface = document.createElement("div");
  surface.tabIndex = 0;
  surface.dataset.emulatorInput = "true";
  document.body.append(surface);
  const detach = attachKeyboardInput(() => k);
  const send = (type: string, code: string) => {
    const e = new KeyboardEvent(type, {
      code,
      bubbles: true,
      cancelable: true,
    });
    surface.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  };
  try {
    surface.focus();
    send("keydown", "Comma");
    send("keydown", "Period");
    expect(k.isPressed("N")).toBe(true);
    expect(k.isPressed("M")).toBe(true);
    send("keyup", "Comma");
    expect(k.isPressed("N")).toBe(false);
    expect(k.isPressed("SYMBOL_SHIFT")).toBe(true);
    send("keyup", "Period");
    expect(k.readRows(0)).toBe(31);
    send("keydown", "Backspace");
    expect(k.isPressed("CAPS_SHIFT")).toBe(true);
    expect(k.isPressed("0")).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(k.readRows(0)).toBe(31);
  } finally {
    detach();
    surface.remove();
  }
});

it("maps shifted symbols by host character and keeps the original chord until keyup", () => {
  const k = new KeyboardDevice();
  const surface = document.createElement("div");
  surface.tabIndex = 0;
  surface.dataset.emulatorInput = "true";
  document.body.append(surface);
  const detach = attachKeyboardInput(() => k);
  const send = (
    type: string,
    code: string,
    key: string,
    shiftKey: boolean,
    repeat = false,
  ) =>
    surface.dispatchEvent(
      new KeyboardEvent(type, {
        code,
        key,
        shiftKey,
        repeat,
        bubbles: true,
        cancelable: true,
      }),
    );
  const cases = [
    ["Comma", "<", "R"],
    ["Period", ">", "T"],
    ["Slash", "?", "C"],
    ["Semicolon", ":", "Z"],
    ["Quote", '"', "P"],
    ["Minus", "_", "0"],
    ["Equal", "+", "K"],
    ["Digit1", "!", "1"],
    ["Digit2", "@", "2"],
    ["Digit3", "#", "3"],
    ["Digit4", "$", "4"],
    ["Digit5", "%", "5"],
    ["Digit6", "^", "H"],
    ["Digit7", "&", "6"],
    ["Digit8", "*", "B"],
    ["Digit9", "(", "8"],
    ["Digit0", ")", "9"],
    // UK-style Shift+2 differs from the positional fallback.
    ["Digit2", '"', "P"],
  ] as const;
  try {
    surface.focus();
    for (const [code, character, key] of cases) {
      send("keydown", code, character, true);
      expect(k.isPressed("SYMBOL_SHIFT")).toBe(true);
      expect(k.isPressed(key)).toBe(true);
      // Shift release and subsequent repeats cannot change an owned chord.
      send("keyup", "ShiftLeft", "Shift", false);
      send("keydown", code, "unshifted", false, true);
      expect(k.isPressed(key)).toBe(true);
      send("keyup", code, "unshifted", false);
      expect(k.readRows(0)).toBe(31);
    }
    send("keydown", "AltLeft", "Alt", false);
    send("keydown", "Comma", "<", true);
    send("keydown", "Period", ">", true);
    send("keyup", "Comma", ",", false);
    expect(k.isPressed("T")).toBe(true);
    send("keyup", "Period", ".", false);
    expect(k.isPressed("SYMBOL_SHIFT")).toBe(true);
    send("keyup", "AltLeft", "Alt", false);
    for (const [code, character, shift, letter] of [
      ["Backslash", "|", true, "S"],
      ["IntlBackslash", "~", true, "A"],
      ["IntlBackslash", "`", false, "A"],
      ["Backquote", "~", true, "A"],
      ["BracketLeft", "[", false, "Y"],
      ["BracketRight", "]", false, "U"],
      ["BracketLeft", "{", true, "F"],
      ["BracketRight", "}", true, "G"],
      ["IntlBackslash", "\\", false, "D"],
    ] as const) {
      send("keydown", code, character, shift);
      expect(k.isPressed("CAPS_SHIFT")).toBe(true);
      expect(k.isPressed(letter)).toBe(false);
      k.advanceFrame();
      expect(k.isPressed("CAPS_SHIFT")).toBe(true);
      k.advanceFrame();
      expect(k.isPressed("CAPS_SHIFT")).toBe(false);
      expect(k.isPressed("SYMBOL_SHIFT")).toBe(true);
      expect(k.isPressed(letter)).toBe(true);
      send("keyup", code, "\\", false);
      expect(k.readRows(0)).toBe(31);
    }
    send("keydown", "IntlBackslash", "|", true);
    send("keyup", "IntlBackslash", "\\", false);
    k.advanceFrame();
    k.advanceFrame();
    expect(k.readRows(0)).toBe(31);
    send("keydown", "Backslash", "|", true);
    window.dispatchEvent(new Event("blur"));
    k.advanceFrame();
    k.advanceFrame();
    expect(k.readRows(0)).toBe(31);
  } finally {
    detach();
    surface.remove();
  }
});

it("observes host Caps Lock state on both edges and ordinary keys without injecting chords", () => {
  const k = new KeyboardDevice();
  const surface = document.createElement("div");
  const config = document.createElement("input");
  surface.tabIndex = 0;
  surface.dataset.emulatorInput = "true";
  document.body.append(surface, config);
  const detach = attachKeyboardInput(() => k);
  const send = (type: string, state: boolean, code = "CapsLock") =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent(type, {
        code,
        key: code,
        modifierCapsLock: state,
        bubbles: true,
        cancelable: true,
      }),
    );
  try {
    surface.focus();
    // First event can be a letter with Caps already enabled before startup.
    send("keydown", true, "KeyA");
    expect(k.desiredCapsLock).toBe(true);
    expect(k.capsSyncActive).toBe(true);
    expect(k.isPressed("A")).toBe(true);
    expect(k.isPressed("CAPS_SHIFT")).toBe(false);
    send("keyup", true, "KeyA");
    send("keydown", true);
    send("keyup", true);
    expect(k.desiredCapsLock).toBe(true);
    expect(k.hasInputSources).toBe(false);
    send("keyup", false); // Hosts that report unlock only on keyup.
    expect(k.desiredCapsLock).toBe(false);
    k.romCapsLock = false;
    k.toggleCapsLockTarget(); // On-screen choice survives unchanged host reports.
    send("keydown", false, "KeyB");
    expect(k.desiredCapsLock).toBe(true);
    send("keyup", false, "KeyB");
    config.focus();
    send("keydown", true);
    expect(k.hostCapsLock).toBe(true);
    expect(k.capsSyncActive).toBe(false);
    expect(k.hasInputSources).toBe(false);
    surface.focus();
    expect(k.capsSyncActive).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(k.capsSyncActive).toBe(false);
  } finally {
    detach();
    surface.remove();
    config.remove();
  }
});
