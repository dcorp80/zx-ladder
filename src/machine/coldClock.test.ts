import { expect, it } from "vitest";
import { Counter } from "./counters";
import { createMachine } from "./machine";

it.each([false, true])(
  "starts the CPU rising edge at the opening raster boundary (turbo=%s)",
  (cpu7) => {
    const rom = new Uint8Array(16384);
    // EI; HALT; JR back to HALT. IM1 handler writes FE and returns.
    rom.set([0xfb, 0x76, 0x18, 0xfd]);
    rom.set([0x3e, 7, 0xd3, 0xfe, 0xfb, 0xc9], 0x38);
    const m = createMachine({ rom, cpu7 });
    m.advancePixels(0);
    expect(m.counters[Counter.cpuEdges]).toBe(0);
    expect(m.cpu.seq.phase).toBe(true); // Next core edge is rising.
    m.advancePixels(1);
    expect(m.counters[Counter.cpuEdges]).toBe(2);
    expect(m.cpu.seq.phase).toBe(true); // Opening rise, then final fall.
    m.advancePixels(1);
    expect(m.counters[Counter.cpuEdges]).toBe(cpu7 ? 4 : 3);
    expect(m.cpu.seq.phase).toBe(cpu7);
    let writes = 0;
    m.border.setSink((batch) => {
      writes += batch.count;
      if (!cpu7) {
        for (let i = 0; i < batch.count; i++) {
          // Final-edge writes take effect at the next slot, on the even
          // pixel boundaries used by the video counter/paper window.
          expect((batch.origin + batch.time[i]) % 2).toBe(0);
        }
      }
    });
    m.advancePixels(37);
    m.flushSound();
    m.advanceFrame();
    m.advanceFrame();
    expect(writes).toBeGreaterThan(0);
    // Warm reset must not re-prime the clock or change its raster phase.
    m.setReset(true);
    m.setReset(false);
    const edges = m.counters[Counter.cpuEdges];
    m.advancePixels(17);
    expect(m.counters[Counter.cpuEdges] - edges).toBe(cpu7 ? 34 : 17);
    m.advanceFrame();
    m.advanceFrame();
  },
);
