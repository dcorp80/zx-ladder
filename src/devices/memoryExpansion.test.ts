import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { DeviceBus } from "../machine/devices";
import { createMachine } from "../machine/machine";
import { Mcu } from "./mcu";
import { BankedMemory } from "./memory";
import { LVIV_VIDEO_PRESET } from "./videoPresets";

function fixture() {
  const rom = new Uint8Array(32768).fill(0x76);
  rom.fill(0x42, 16384);
  const memory = new BankedMemory(rom);
  const mcu = new Mcu(memory);
  return { memory, mcu, bus: new DeviceBus([memory, mcu]) };
}
it("maps all physical pages without copies, including aliases of fixed pages", () => {
  const { memory, bus } = fixture();
  for (let page = 0; page < 8; page++) {
    bus.writeIo(0x7ffd, page);
    bus.writeMemory(0xc000, page + 10);
    bus.writeMemory(0xffff, page + 20);
  }
  for (let page = 0; page < 8; page++) {
    bus.writeIo(0x7ffd, page);
    expect(bus.readMemory(0xc000)).toBe(page + 10);
    expect(bus.readMemory(0xffff)).toBe(page + 20);
  }
  expect(memory.read(0x4000)).toBe(15);
  expect(memory.read(0x8000)).toBe(12);
  bus.writeIo(0x7ffd, 5);
  memory.write(0x4000, 99);
  expect(memory.read(0xc000)).toBe(99);
  bus.writeIo(0x7ffd, 2);
  memory.write(0xbfff, 88);
  expect(memory.read(0xffff)).toBe(88);
});
it("selects and protects both ROMs, applies the locking write, and resets without clearing RAM", () => {
  const { memory, mcu, bus } = fixture();
  memory.write(0, 1);
  expect(memory.read(0)).toBe(0x76);
  bus.writeIo(0x7ffd, 0x3f);
  expect(memory.read(0)).toBe(0x42);
  memory.write(0x3fff, 1);
  expect(memory.read(0x3fff)).toBe(0x42);
  memory.write(0xc000, 99);
  expect(memory.readScreen(0x4000)).toBe(99);
  bus.writeIo(0x7ffd, 0);
  expect(mcu.latch).toBe(0x3f);
  mcu.reset();
  expect(mcu.latch).toBe(0);
  expect(memory.read(0)).toBe(0x76);
  expect(memory.ramPages[7][0]).toBe(99);
  bus.writeIo(0x7ffd, 7);
  expect(memory.read(0xc000)).toBe(99);
});
it("switches standard 128K / low-byte FD decoding live, without unlocking or changing state", () => {
  const { bus, mcu } = fixture();
  for (const address of [0xfffd, 0xbffd, 0x7fff, 0x7ffe])
    bus.writeIo(address, 3);
  expect(mcu.latch).toBe(0);
  bus.writeIo(0x7ffd, 1);
  mcu.decodeFd = true;
  expect(mcu.latch).toBe(1);
  for (const address of [0xfd, 0x1ffd, 0xfffd]) {
    bus.writeIo(address, 3);
    expect(mcu.latch).toBe(3);
    bus.writeIo(address, 0);
  }
  bus.writeIo(0xfd, 0x25);
  mcu.decodeFd = false;
  bus.writeIo(0x7ffd, 0);
  expect(mcu.latch).toBe(0x25);
  expect(bus.readIo(0x7ffd)).toBe(255);
});
it("preserves CPU interception while video reads the independently selected physical screen", () => {
  const { memory, mcu } = fixture();
  const bus = new DeviceBus([
    memory,
    mcu,
    {
      id: "overlay",
      memoryInterceptors: [{ start: 0x4000, end: 0x4000, read: () => 88 }],
    },
  ]);
  memory.write(0x4000, 5);
  mcu.write(7);
  memory.write(0xc000, 7);
  expect(bus.readMemory(0x4000)).toBe(88);
  expect(memory.readScreen(0x4000)).toBe(5);
  mcu.write(8); // screen 7, CPU top page 0
  expect(memory.readScreen(0x4000)).toBe(7);
  expect(memory.read(0xc000)).toBe(255);
});
it("keeps paging across raster changes and clears it on warm reset", () => {
  const m = createMachine({ rom: new Uint8Array(32768), decodeFd: true });
  m.bus.writeIo(0xfd, 0x3f);
  m.memory.write(0xc000, 91);
  m.setVideoPreset(LVIV_VIDEO_PRESET);
  expect(m.mcu.latch).toBe(0x3f);
  m.setReset(true);
  m.setReset(false);
  expect(m.mcu.latch).toBe(0);
  expect(m.memory.ramPages[7][0]).toBe(91);
});
it("does not register the MCU in 48K mode", () => {
  const m = createMachine({ rom: new Uint8Array(16384), decodeFd: true });
  m.bus.writeIo(0xfd, 0x3f);
  expect(m.mcu.latch).toBe(0);
  expect(m.memory.expanded).toBe(false);
});
it("boots the supplied 128K ROM to a stable menu without modifying either ROM page", () => {
  const rom = new Uint8Array(readFileSync("public/roms/128.rom"));
  const m = createMachine({ rom });
  for (let i = 0; i < 200; i++) m.advanceFrame();
  expect(m.memory.romPages.flat()).toEqual(Array.from(rom));
  expect(
    m.memory.ramPages[5].slice(0, 6912).some((v) => v !== 0 && v !== 255),
  ).toBe(true);
  expect(m.mcu.latch & 0x20).toBe(0);
  expect(m.frameCount).toBe(200);
}, 30000);

it("switches the screen between timed fetches without rewriting captured latches", () => {
  const m = createMachine({ rom: new Uint8Array(32768) });
  const physical = { readMemory: m.memory.readScreen };
  m.memory.ramPages[5].fill(0x11);
  m.memory.ramPages[7].fill(0x77);
  // Fetch pixel from screen 5; switch before fetching the attribute.
  m.video.fetch(physical, 0);
  m.mcu.write(8);
  m.video.fetch(physical, 0);
  // Capture through the concrete timed-video interface.
  const video = m.video as import("./video").TimedVideo;
  video.captureSymbol(0, 0);
  video.finishFrame();
  expect(video.completed.pixels[0]).toBe(0x11);
  expect(video.completed.attributes[0]).toBe(0x77);
  m.video.fetch(physical, 0);
  video.captureSymbol(0, 0);
  video.finishFrame();
  expect(video.completed.pixels[0]).toBe(0x77);
});

it("recognizes the active physical ROM and disables helpers after paging away", () => {
  const pair = new Uint8Array(32768);
  pair.set(new Uint8Array(readFileSync("public/roms/48.rom")), 16384);
  const m = createMachine({ rom: pair });
  expect(m.tape.supported).toBe(false);
  m.mcu.write(16);
  expect(m.tape.supported).toBe(true);
  m.keyboard.setHiddenCapsLock(true);
  m.mcu.write(0);
  expect(m.tape.supported).toBe(false);
  expect(m.tape.read(0x056c, true, m.cpu)).toBeUndefined();
  expect(m.keyboard.romCapsLock).toBeUndefined();
});

it("decodes every paging alias without claiming AY ports", () => {
  const { bus, mcu } = fixture();
  for (let address = 0; address < 65536; address++) {
    bus.writeIo(address, 0x19);
    expect(mcu.latch, address.toString(16)).toBe(
      (address & 0x8002) === 0 ? 0x19 : 0,
    );
    mcu.reset();
  }
});

it("pages through immediate OUT (FD),A as used by demo loaders", () => {
  const rom = new Uint8Array(32768);
  const program = [
    0x3e,
    0x51,
    0xd3,
    0xfd, // page 1 via 51FD
    0x3e,
    42,
    0x32,
    0,
    0xc0,
    0x3e,
    0x50,
    0xd3,
    0xfd, // page 0 via 50FD
    0x3e,
    99,
    0x32,
    0,
    0xc0,
    0x3e,
    0x51,
    0xd3,
    0xfd,
    0x3a,
    0,
    0xc0,
    0x76,
  ];
  rom.set(program);
  rom.set(program, 16384);
  const m = createMachine({ rom });
  m.advancePixels(1000);
  expect(m.cpu.bus.nHALT).toBe(0);
  expect(m.cpu.snapshot().main.a).toBe(42);
  expect(m.memory.ramPages[0][0]).toBe(99);
  expect(m.memoryMapping.ramPage).toBe(1);
});
