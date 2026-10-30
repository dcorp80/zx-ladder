import { expect, it } from "vitest";
import { KeyboardDevice } from "../devices/keyboard";
import {
  KEYBOARD_LAYOUT_ID,
  KEYBOARD_LAYOUTS,
  keyboardLayout,
  PC_LAYOUT_ID,
  pressHostKey,
} from "./keyboardLayout";

it("keeps both geometries in bounds with distinct numpad and main-key codes", () => {
  for (const layout of KEYBOARD_LAYOUTS) {
    expect(new Set(layout.keys.map((k) => k.code)).size).toBe(
      layout.keys.length,
    );
    for (const key of layout.keys) {
      expect(key.x).toBeGreaterThanOrEqual(0);
      expect(key.y).toBeGreaterThanOrEqual(0);
      expect(key.x + key.width).toBeLessThanOrEqual(layout.width);
      expect(key.y + key.height).toBeLessThanOrEqual(layout.height);
    }
  }
  expect(keyboardLayout("auto", "MacIntel").id).toBe(KEYBOARD_LAYOUT_ID);
  expect(keyboardLayout("auto", "Win32").id).toBe(PC_LAYOUT_ID);
  expect(keyboardLayout(KEYBOARD_LAYOUT_ID, "Linux").id).toBe(
    KEYBOARD_LAYOUT_ID,
  );
});

it("maps numpad independently of Num Lock and Shift, with shared-key ownership", () => {
  const k = new KeyboardDevice();
  for (let digit = 0; digit < 10; digit++) {
    pressHostKey(k, "num", `Numpad${digit}`, true, "End", PC_LAYOUT_ID);
    expect(k.isPressed(String(digit) as "0")).toBe(true);
    expect(k.isPressed("SYMBOL_SHIFT")).toBe(false);
    k.release("num");
  }
  const operators = {
    NumpadAdd: "K",
    NumpadSubtract: "J",
    NumpadMultiply: "B",
    NumpadDivide: "V",
    NumpadDecimal: "M",
  } as const;
  for (const [code, key] of Object.entries(operators)) {
    pressHostKey(k, "num", code, false, "", PC_LAYOUT_ID);
    expect(k.isPressed(key)).toBe(true);
    expect(k.isPressed("SYMBOL_SHIFT")).toBe(true);
    k.release("num");
  }
  pressHostKey(k, "main", "Enter", false);
  pressHostKey(k, "num", "NumpadEnter", false);
  k.release("num");
  expect(k.isPressed("ENTER")).toBe(true);
  k.release("main");
  expect(k.readRows(0)).toBe(31);
});

it("uses PC apostrophe and Mac double quote without changing held-source release", () => {
  const k = new KeyboardDevice();
  pressHostKey(k, "key", "Quote", false, "'", PC_LAYOUT_ID);
  expect(k.isPressed("7")).toBe(true);
  k.release("key");
  pressHostKey(k, "key", "Quote", true, '"', PC_LAYOUT_ID);
  expect(k.isPressed("P")).toBe(true);
  k.release("key");
  pressHostKey(k, "key", "Quote", false, "", KEYBOARD_LAYOUT_ID);
  expect(k.isPressed("P")).toBe(true);
});
