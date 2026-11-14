import { expect, it, vi } from "vitest";

it("filters before queueing, retains history through starvation and resets playback safely", async () => {
  type Packet = {
    type: string;
    samples?: Float32Array;
    frames?: number;
    generation?: number;
  };
  type Processor = {
    port: { onmessage: ((event: { data: Packet }) => void) | null };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  };
  const accepted: Packet[] = [];
  let createProcessor: (new () => Processor) | undefined;
  vi.stubGlobal("sampleRate", 48_000);
  vi.stubGlobal(
    "AudioWorkletProcessor",
    class {
      port = {
        onmessage: null,
        postMessage: (packet: Packet, transfer: Transferable[]) => {
          accepted.push(structuredClone(packet, { transfer }));
        },
      };
    },
  );
  vi.stubGlobal(
    "registerProcessor",
    (name: string, factory: new () => Processor) => {
      expect(name).toBe("ladder-sound");
      createProcessor = factory;
    },
  );
  try {
    vi.resetModules();
    await import("./beeper.worklet");
    expect(createProcessor).toBeDefined();
    const processor = new (createProcessor as new () => Processor)();
    const send = (level: number) => {
      for (let i = 0; i < 8; i++) {
        const samples = new Float32Array(512).fill(level);
        processor.port.onmessage?.({
          data: { type: "samples", samples, frames: 256, generation: 7 },
        });
        expect(samples.byteLength).toBe(0); // Storage was acknowledged/transferred.
      }
    };
    const render = () => {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      expect(processor.process([], [[left, right]])).toBe(true);
      expect(right).toEqual(left);
      return left;
    };
    send(-0.1);
    for (let i = 0; i < 32; i++)
      expect(render().every((x) => x === 0)).toBe(true);
    // An actual input-level change still reaches the filter after starvation.
    send(0.2);
    expect(Math.max(...render().map(Math.abs))).toBeGreaterThan(0.05);
    processor.port.onmessage?.({ data: { type: "reset" } });
    send(-0.3);
    render(); // Finish the bounded fade-out from the old sound.
    for (let i = 0; i < 32; i++)
      expect(render().every((x) => x === 0)).toBe(true);
    expect(accepted).toHaveLength(24);
    expect(
      accepted.every((p) => p.type === "accepted" && p.generation === 7),
    ).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
