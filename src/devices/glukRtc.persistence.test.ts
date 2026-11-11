import { beforeEach, expect, it, vi } from "vitest";

const storage = {
  loadRtcRam: vi.fn(async () => Array(114).fill(37)),
  saveRtcRam: vi.fn(async (_bytes: number[]) => {}),
};

import { DeviceBus } from "../machine/devices";
import { GlukRtc } from "./glukRtc";

beforeEach(() => {
  storage.loadRtcRam.mockResolvedValue(Array(114).fill(37));
  storage.saveRtcRam.mockResolvedValue(undefined);
});

it("restores RAM, persists user writes only, and retains RAM across reset", async () => {
  const rtc = new GlukRtc(undefined, storage);
  await rtc.ready;
  expect(rtc.bytes[14]).toBe(37);
  expect(rtc.bytes[11]).toBe(2);
  const bus = new DeviceBus([rtc]);
  bus.writeIo(0xeff7, 128);
  bus.writeIo(0xdff7, 0);
  bus.writeIo(0xbff7, 10);
  expect(storage.saveRtcRam).not.toHaveBeenCalled();
  bus.writeIo(0xdff7, 127);
  bus.writeIo(0xbff7, 99);
  await Promise.resolve();
  expect(storage.saveRtcRam).toHaveBeenCalledWith(expect.arrayContaining([99]));
  rtc.reset();
  expect(rtc.bytes[127]).toBe(99);
  expect(bus.readIo(0xbff7)).toBe(255);
});
it("does not overwrite writes made before restoration completes", async () => {
  const rtc = new GlukRtc(undefined, storage);
  const bus = new DeviceBus([rtc]);
  bus.writeIo(0xeff7, 128);
  bus.writeIo(0xdff7, 14);
  bus.writeIo(0xbff7, 88);
  await rtc.ready;
  expect(rtc.bytes[14]).toBe(88);
  expect(rtc.bytes[15]).toBe(37);
});
