import { expect, it } from "vitest";
import { DeviceBus } from "../machine/devices";
import { createMachine } from "../machine/machine";
import { BetaDisk } from "./betaDisk";
import { DEFAULT_KEMPSTON, KempstonDevice } from "./kempston";

it("returns idle zero, all five joystick bits, and yields to DOS without a disk or ROM", () => {
  const disk = new BetaDisk();
  const hid = new KempstonDevice(() => disk.dosEnabled);
  const bus = new DeviceBus([disk, hid]);
  expect(bus.readIo(0xff1f)).toBe(0);
  for (const bits of [1, 2, 4, 8, 16, 31, 255]) {
    hid.input({ action: "joystick", bits });
    expect(bus.readIo(0x1f)).toBe(bits & 31);
  }
  disk.dosEnabled = true;
  expect(bus.readIo(0x1f)).toBe(disk.io[0].read?.(0x1f));
  disk.dosEnabled = false;
  expect(bus.readIo(0x1f)).toBe(31);
});
it("decodes mouse aliases, preserves fallback while disabled, wraps and ignores DOS movement", () => {
  let dos = false;
  const hid = new KempstonDevice(() => dos);
  const bus = new DeviceBus([hid]);
  expect(bus.readIo(0xfadf)).toBe(255);
  hid.input({
    action: "settings",
    settings: { ...DEFAULT_KEMPSTON, mouseEnabled: true },
  });
  expect(bus.readIo(0xfadf)).toBe(255);
  hid.input({ action: "motion", dx: 257, dy: 2 });
  expect(bus.readIo(0xfbdf)).toBe(1);
  expect(bus.readIo(0xffdf)).toBe(254);
  expect(bus.readIo(0x01df)).toBe(1);
  expect(bus.readIo(0x04df)).toBe(255);
  hid.input({ action: "motion", dx: 0.5, dy: 0 });
  hid.input({ action: "motion", dx: 0.5, dy: 0 });
  expect(bus.readIo(0xfbdf)).toBe(2);
  dos = true;
  hid.input({ action: "motion", dx: 40, dy: 40 });
  hid.input({ action: "buttons", buttons: 7 });
  for (const address of [0xfadf, 0xfbdf, 0xffdf])
    expect(bus.readIo(address)).toBe(255);
  dos = false;
  expect(bus.readIo(0xfbdf)).toBe(2);
  expect(bus.readIo(0xfadf)).toBe(255);
});
it("translates browser left/right/middle buttons and swaps only left and right", () => {
  const hid = new KempstonDevice(() => false);
  const bus = new DeviceBus([hid]);
  for (const swapButtons of [false, true]) {
    hid.input({
      action: "settings",
      settings: { ...DEFAULT_KEMPSTON, mouseEnabled: true, swapButtons },
    });
    for (const [buttons, normal, swapped] of [
      [1, 253, 254],
      [2, 254, 253],
      [4, 251, 251],
      [7, 248, 248],
      [0, 255, 255],
    ]) {
      hid.input({ action: "buttons", buttons });
      expect(bus.readIo(0xfadf)).toBe(swapButtons ? swapped : normal);
    }
  }
});
it("observes real CPU reads while mouse is disabled, clears on reset and preserves devices across video rebuild", () => {
  const rom = new Uint8Array(16384);
  rom.set([0x3e, 0xfa, 0xdb, 0xdf, 0x32, 0, 0x90, 0x76]);
  const machine = createMachine({ rom });
  machine.advancePixels(500);
  expect(machine.mouseAccessed).toBe(true);
  expect(machine.memory.read(0x9000)).toBe(255);
  machine.setReset(true);
  expect(machine.mouseAccessed).toBe(false);
  machine.setReset(false);
  machine.kempstonInput({ action: "joystick", bits: 16 });
  machine.setVideoPreset(machine.videoPreset);
  expect(machine.bus.readIo(0x1f)).toBe(16);
});
it("access hints exclude unused register aliases and DOS", () => {
  let dos = true;
  const hid = new KempstonDevice(() => dos);
  hid.observeRead(0xfadf);
  expect(hid.mouseAccessed).toBe(false);
  dos = false;
  hid.observeRead(0x04df);
  expect(hid.mouseAccessed).toBe(false);
  hid.observeRead(0xffdf);
  expect(hid.mouseAccessed).toBe(true);
});

it("passes OPTRON's full-byte startup probe before enabling its mouse movement masks", () => {
  const rom = new Uint8Array(16384);
  // LD E,1F; LD BC,FADF; IN A,(C); CP FF; CCF; JR NC,+2;
  // LD E,0; SBC A,A; LD (9000),A; LD A,E; LD (9001),A; HALT.
  // OPTRON patches both axis masks with the result of SBC A,A.
  rom.set([
    0x1e, 0x1f, 0x01, 0xdf, 0xfa, 0xed, 0x78, 0xfe, 0xff, 0x3f, 0x30, 2, 0x1e,
    0, 0x9f, 0x32, 0, 0x90, 0x7b, 0x32, 1, 0x90, 0x76,
  ]);
  const machine = createMachine({ rom });
  machine.kempstonInput({
    action: "settings",
    settings: { ...DEFAULT_KEMPSTON, mouseEnabled: true },
  });
  machine.advancePixels(500);
  expect(machine.memory.read(0x9000)).toBe(255);
  expect(machine.memory.read(0x9001)).toBe(0);
});
