import { describe, expect, it } from "vitest";
import { BankedMemory } from "../devices/memory";
import { DeviceBus } from "./devices";

describe("memory dispatch", () => {
  it("preserves bank selection, byte masking and ROM protection on direct pages", () => {
    const memory = new BankedMemory(new Uint8Array(16384).fill(0x42));
    const bus = new DeviceBus([memory]);
    for (const address of [
      0, 0x3fff, 0x4000, 0x7fff, 0x8000, 0xbfff, 0xc000, 0xffff,
    ]) {
      bus.writeMemory(address, 0x123);
      expect(bus.readMemory(address)).toBe(address < 0x4000 ? 0x42 : 0x23);
    }
  });

  it("checks exact partial-page ranges and leaves unmapped memory open", () => {
    let stored = 9;
    const bus = new DeviceBus([
      {
        id: "partial",
        memory: [
          {
            start: 0x4080,
            end: 0x408f,
            read: () => stored,
            write: (_a, v) => {
              stored = v;
            },
          },
        ],
      },
    ]);
    bus.writeMemory(0x407f, 1);
    bus.writeMemory(0x4090, 2);
    expect(bus.readMemory(0x4080)).toBe(9);
    expect(bus.readMemory(0x407f)).toBe(255);
    expect(bus.readMemory(0x4090)).toBe(255);
    expect(bus.readMemory(0x5000)).toBe(255);
    bus.writeMemory(0x408f, 7);
    expect(bus.readMemory(0x408f)).toBe(7);
  });

  it("runs conditional interceptors by priority and preserves pass-through side effects", () => {
    const memory = new BankedMemory(new Uint8Array(16384));
    const calls: string[] = [];
    let enabled = false;
    const bus = new DeviceBus([
      memory,
      {
        id: "overlays",
        memoryInterceptors: [
          {
            start: 0x4080,
            end: 0x408f,
            read: () => {
              calls.push("low");
              return 0x134;
            },
          },
          {
            start: 0x4080,
            end: 0x408f,
            priority: 1,
            read: () => {
              calls.push("high");
              return enabled ? 0 : undefined;
            },
            write: (_a, v) => {
              calls.push(`write:${v}`);
              return enabled;
            },
          },
        ],
      },
    ]);
    expect(bus.readMemory(0x407f)).toBe(255);
    expect(bus.readMemory(0x4090)).toBe(255);
    expect(calls).toEqual([]);
    expect(bus.readMemory(0x4080)).toBe(0x34);
    expect(calls).toEqual(["high", "low"]);
    bus.writeMemory(0x408f, 0x123);
    expect(memory.read(0x408f)).toBe(0x23);
    enabled = true;
    expect(bus.readMemory(0x408f)).toBe(0);
    bus.writeMemory(0x408f, 0x456);
    expect(memory.read(0x408f)).toBe(0x23);
    expect(calls).toEqual(["high", "low", "write:35", "high", "write:86"]);
  });

  it("falls back to backing memory when every interceptor declines", () => {
    const memory = new BankedMemory(new Uint8Array(16384));
    const bus = new DeviceBus([
      memory,
      {
        id: "observer",
        memoryInterceptors: [
          { start: 0xffff, end: 0xffff, read: () => undefined },
        ],
      },
    ]);
    bus.writeMemory(0xffff, 17);
    expect(bus.readMemory(0xffff)).toBe(17);
  });

  it("validates interceptor registration", () => {
    for (const range of [
      { start: -1, end: 0 },
      { start: 2, end: 1 },
      { start: 0, end: 65536 },
      { start: 0.5, end: 1 },
    ]) {
      expect(
        () => new DeviceBus([{ id: "bad", memoryInterceptors: [range] }]),
      ).toThrow("Invalid memory interceptor range");
    }
    expect(
      () =>
        new DeviceBus([
          {
            id: "bad",
            memoryInterceptors: [{ start: 0, end: 1, priority: NaN }],
          },
        ]),
    ).toThrow("Invalid memory interceptor priority");
  });
});
