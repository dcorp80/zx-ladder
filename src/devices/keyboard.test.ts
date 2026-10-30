import { expect, it, vi } from "vitest";
import { DeviceBus } from "../machine/devices";
import { createMachine } from "../machine/machine";
import { KEY_ROWS, KeyboardDevice } from "./keyboard";

it("maps all forty keys to active-low rows and composes selected rows", () => {
  const k = new KeyboardDevice();
  const bus = new DeviceBus([k]);
  for (let row = 0; row < 8; row++)
    for (let bit = 0; bit < 5; bit++) {
      k.press("test", KEY_ROWS[row][bit]);
      const address = ((255 ^ (1 << row)) << 8) | 0xfe;
      expect(bus.readIo(address)).toBe(255 ^ (1 << bit));
      expect(bus.readIo(address & 0xfffc)).toBe(255 ^ (1 << bit));
      expect(bus.readIo(address | 1)).toBe(255);
      k.release("test");
      expect(bus.readIo(address)).toBe(255);
    }
  k.press("a", "A");
  k.press("x", "X");
  expect(bus.readIo(0xfcfe)).toBe(0xfa);
  expect(bus.readIo(0xfffe)).toBe(255);
});
it("keeps overlapping ownership, ignores repeats, and releases every source", () => {
  const k = new KeyboardDevice();
  k.press("host:AltLeft", "SYMBOL_SHIFT");
  k.press("host:AltLeft", "SYMBOL_SHIFT");
  k.press("host:AltRight", "SYMBOL_SHIFT");
  k.press("pointer:1", "SYMBOL_SHIFT");
  k.release("host:AltLeft");
  k.release("host:AltRight");
  expect(k.isPressed("SYMBOL_SHIFT")).toBe(true);
  k.release("pointer:1");
  expect(k.readRows(0)).toBe(31);
  k.press("pointer:1", "A");
  k.press("pointer:2", "B");
  k.releaseAll();
  expect(k.readRows(0)).toBe(31);
});
it("combines keyboard and tape bits and gates strictly lower priorities", () => {
  const k = new KeyboardDevice();
  k.press("a", "A");
  let diskEnabled = false;
  const lowerWrite = vi.fn(),
    peerWrite = vi.fn();
  const bus = new DeviceBus([
    k,
    {
      id: "tape",
      io: [
        {
          lowMask: 1,
          lowValue: 0,
          readMask: 0x40,
          read: () => 0,
          write: lowerWrite,
        },
      ],
    },
    {
      id: "disk",
      io: [
        {
          lowMask: 1,
          lowValue: 0,
          priority: 10,
          blockLower: true,
          selected: () => diskEnabled,
          read: () => 0x42,
        },
      ],
    },
    {
      id: "peer",
      io: [{ lowMask: 1, lowValue: 0, priority: 10, write: peerWrite }],
    },
  ]);
  expect(bus.readIo(0xfdfe)).toBe(0xbe);
  bus.writeIo(0xfe, 7);
  expect(lowerWrite).toHaveBeenCalledOnce();
  diskEnabled = true;
  expect(bus.readIo(0xfdfe)).toBe(0x42);
  bus.writeIo(0xfe, 7);
  expect(lowerWrite).toHaveBeenCalledOnce();
  expect(peerWrite).toHaveBeenCalledTimes(2);
});
it("allows a gate-only device to inhibit lower I/O without driving bits", () => {
  const read = vi.fn(() => 0);
  const bus = new DeviceBus([
    {
      id: "gate",
      io: [{ lowMask: 0, lowValue: 0, priority: 1, blockLower: true }],
    },
    { id: "lower", io: [{ lowMask: 0, lowValue: 0, read }] },
  ]);
  expect(bus.readIo(0xfe)).toBe(255);
  expect(read).not.toHaveBeenCalled();
});
it.each([false, true])(
  "delivers held keyboard bits to real CPU IN instructions (turbo=%s)",
  (cpu7) => {
    const rom = new Uint8Array(16384);
    rom.set([0x01, 0xfe, 0xfd, 0xed, 0x78, 0x32, 0, 0x80, 0x76]);
    const m = createMachine({ rom, cpu7 });
    m.keyboard.press("host:KeyA", "A");
    m.advancePixels(200);
    expect(m.memory.read(0x8000)).toBe(0x1e);
    expect(m.cpu.bus.nHALT).toBe(0);
  },
);

it("owns each chord switch independently across physical and pointer sources", () => {
  const k = new KeyboardDevice();
  k.press("control", "CAPS_SHIFT");
  k.press("left", ["CAPS_SHIFT", "5"]);
  k.press("right", ["CAPS_SHIFT", "8"]);
  k.press("pointer", ["CAPS_SHIFT", "5"]);
  k.press("left", ["CAPS_SHIFT", "5"]);
  k.release("left");
  expect(k.isPressed("5")).toBe(true);
  k.release("pointer");
  expect(k.isPressed("5")).toBe(false);
  expect(k.isPressed("CAPS_SHIFT")).toBe(true);
  k.release("control");
  expect(k.isPressed("CAPS_SHIFT")).toBe(true);
  k.release("right");
  expect(k.readRows(0)).toBe(31);
  const chord: ("SYMBOL_SHIFT" | "M")[] = ["SYMBOL_SHIFT", "M", "M"];
  k.press("period", chord);
  chord.length = 0;
  k.release("period");
  expect(k.readRows(0)).toBe(31);
});

it("paces extended mode on machine frames and preserves independently held modifiers", () => {
  const m = createMachine({ rom: new Uint8Array(16384) });
  m.cpu.clockEdge = () => {};
  const k = m.keyboard;
  k.press("control", "CAPS_SHIFT");
  k.pressExtended("pipe", "S");
  m.advanceFrame();
  expect(k.isPressed("S")).toBe(false);
  m.advanceFrame();
  expect(k.isPressed("S")).toBe(true);
  expect(k.isPressed("CAPS_SHIFT")).toBe(true);
  k.release("pipe");
  expect(k.isPressed("SYMBOL_SHIFT")).toBe(false);
  expect(k.isPressed("CAPS_SHIFT")).toBe(true);
  k.releaseAll();
});

it("grounds FE upper bits without changing keyboard rows or unclaimed ports", () => {
  const m = createMachine({ rom: new Uint8Array(16384) });
  expect(m.bus.readIo(0xfffe)).toBe(0x1f);
  expect(m.bus.readIo(0x00fc)).toBe(0x1f);
  m.keyboard.press("test", "A");
  expect(m.bus.readIo(0xfdfe)).toBe(0x1e);
  expect(m.bus.readIo(0xfffe)).toBe(0x1f);
  expect(m.bus.readIo(0xffff)).toBe(0xff);
  m.setVideoPreset(m.videoPreset);
  expect(m.bus.readIo(0xfdfe)).toBe(0x1e);
});

it("enters extended mode before an unshifted mobile key and cancels on release", () => {
  const keyboard = new KeyboardDevice();
  keyboard.pressExtended("touch", "Q", false);
  expect(keyboard.isPressed("CAPS_SHIFT")).toBe(true);
  expect(keyboard.isPressed("SYMBOL_SHIFT")).toBe(true);
  keyboard.advanceFrame();
  keyboard.advanceFrame();
  expect(keyboard.isPressed("Q")).toBe(true);
  expect(keyboard.isPressed("SYMBOL_SHIFT")).toBe(false);
  keyboard.release("touch");
  expect(keyboard.hasInputSources).toBe(false);
});
