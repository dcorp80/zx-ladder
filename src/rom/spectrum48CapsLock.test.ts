import { expect, it } from "vitest";
import { KeyboardDevice } from "../devices/keyboard";
import { BankedMemory } from "../devices/memory";
import { Spectrum48CapsLock } from "./spectrum48CapsLock";

function setup() {
  const rom = new Uint8Array(16384);
  rom.set([0x21, 0x6a, 0x5c, 0x3e, 8, 0xae, 0x77], 0x10dd);
  const memory = new BankedMemory(rom);
  const keyboard = new KeyboardDevice();
  const sync = new Spectrum48CapsLock(memory, keyboard);
  keyboard.observeHostCapsLock(true);
  keyboard.capsSyncActive = true;
  const frame = () => {
    sync.keyboardPoll();
    sync.advanceFrame();
  };
  return { memory, keyboard, sync, frame };
}

it("waits for ROM keyboard polling and reconciles FLAGS2 using a hidden matrix chord", () => {
  const { memory, keyboard, sync, frame } = setup();
  memory.write(0x5c6a, 0);
  sync.advanceFrame(); // Boot RAM isn't proof of an initialized ROM.
  expect(keyboard.readRows(0)).toBe(31);
  frame();
  expect(keyboard.readRows(0xfe)).toBe(30);
  expect(keyboard.readRows(0xf7)).toBe(29);
  expect(keyboard.isPressed("CAPS_SHIFT")).toBe(false); // Hidden from UI sources.
  expect(memory.read(0x5c6a)).toBe(0); // No direct RAM writes.
  memory.write(0x5c6a, 8); // The ROM acknowledges the chord.
  frame();
  expect(keyboard.readRows(0)).toBe(31);
  for (let i = 0; i < 10; i++) frame();
  expect(keyboard.readRows(0)).toBe(31);
  keyboard.observeHostCapsLock(false);
  frame();
  expect(keyboard.readRows(0)).toBe(28);
  memory.write(0x5c6a, 0);
  frame();
  expect(keyboard.readRows(0)).toBe(31);
});

it("keeps real keys intact, bounds retries, and cancels on focus loss and reset", () => {
  const { memory, keyboard, sync, frame } = setup();
  memory.write(0x5c6a, 0);
  keyboard.press("a", "A");
  frame();
  expect(keyboard.readRows(0xfe)).toBe(31);
  keyboard.release("a");
  frame();
  for (let i = 0; i < 4; i++) frame();
  expect(keyboard.readRows(0)).toBe(31);
  for (let i = 0; i < 4; i++) frame();
  expect(keyboard.readRows(0)).toBe(31);
  frame();
  expect(keyboard.readRows(0)).toBe(28);
  keyboard.capsSyncActive = false;
  frame();
  expect(keyboard.readRows(0)).toBe(31);
  keyboard.capsSyncActive = true;
  frame();
  sync.reset();
  expect(keyboard.readRows(0)).toBe(31);
  expect(keyboard.desiredCapsLock).toBe(true);
  sync.advanceFrame();
  expect(keyboard.readRows(0)).toBe(31);
  frame();
  expect(keyboard.readRows(0)).toBe(28);
});

it("does not inject for an unsupported ROM", () => {
  const keyboard = new KeyboardDevice();
  const sync = new Spectrum48CapsLock(
    new BankedMemory(new Uint8Array(16384)),
    keyboard,
  );
  keyboard.observeHostCapsLock(true);
  keyboard.capsSyncActive = true;
  sync.keyboardPoll();
  sync.advanceFrame();
  expect(keyboard.readRows(0)).toBe(31);
});
