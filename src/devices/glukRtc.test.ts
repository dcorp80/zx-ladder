import { expect, it } from "vitest";
import { DeviceBus } from "../machine/devices";
import { GlukRtc } from "./glukRtc";

it("refreshes local time on access and preserves CMOS RAM", () => {
  const rtc = new GlukRtc(() => new Date(2026, 10, 9, 17, 42, 53));
  rtc.enabled = false;
  const bus = new DeviceBus([rtc]);
  expect(bus.readIo(0xbff7)).toBe(255);
  rtc.enabled = true;
  bus.writeIo(0xeff7, 128);
  bus.writeIo(0xdff7, 0);
  expect(bus.readIo(0xbff7)).toBe(0x53);
  bus.writeIo(0xdff7, 11);
  bus.writeIo(0xbff7, 6);
  bus.writeIo(0xdff7, 4);
  expect(bus.readIo(0xbff7)).toBe(17);
  bus.writeIo(0xdff7, 32);
  bus.writeIo(0xbff7, 123);
  expect(bus.readIo(0xbff7)).toBe(123);
});
