import { afterEach, expect, it, vi } from "vitest";
import { SoundOutput } from "./output";

afterEach(() => vi.unstubAllGlobals());
it("uses host-rate stereo, bounds transfers and recycles acknowledgments across resets", async () => {
  const messages: {
    type: string;
    samples?: Float32Array;
    frames?: number;
    generation?: number;
  }[] = [];
  let receive: ((event: { data: unknown }) => void) | undefined;
  const connect = vi.fn(() => ({ connect: vi.fn() }));
  let nodeOptions: unknown;
  vi.stubGlobal(
    "AudioContext",
    class {
      sampleRate = 44100;
      state = "running";
      destination = {};
      audioWorklet = { addModule: async () => {} };
      createBiquadFilter() {
        return { type: "", frequency: { value: 0 }, connect: vi.fn() };
      }
      resume = async () => {};
      close = async () => {};
    },
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = {
        set onmessage(fn: typeof receive) {
          receive = fn;
        },
        postMessage: (
          message: (typeof messages)[number],
          transfer: Transferable[] = [],
        ) => messages.push(structuredClone(message, { transfer })),
        close: vi.fn(),
      };
      connect = connect;
      disconnect = vi.fn();
      constructor(_ctx: unknown, _name: string, options: unknown) {
        nodeOptions = options;
      }
    },
  );
  const rate = vi.fn();
  const status = vi.fn();
  const output = new SoundOutput(status, rate);
  await output.unlock();
  output.setPlaying(true);
  expect(rate).toHaveBeenCalledWith(44100);
  expect(nodeOptions).toMatchObject({ outputChannelCount: [2] });
  const samples = new Float32Array(512);
  samples[0] = 0.2;
  samples[1] = -0.3;
  output.consume(samples, 256, 48000); // obsolete sample rate
  for (let i = 0; i < 40; i++) output.consume(samples, 256, 44100);
  const sent = messages.filter((m) => m.type === "samples");
  expect(sent).toHaveLength(32);
  expect(sent[0].samples?.[0]).toBeCloseTo(0.2);
  expect(sent[0].samples?.[1]).toBeCloseTo(-0.3);
  output.reset();
  receive?.({
    data: {
      type: "accepted",
      samples: new Float32Array(sent[0].samples ?? []),
      generation: sent[0].generation,
    },
  });
  output.consume(samples, 256, 44100);
  expect(messages.filter((m) => m.type === "samples")).toHaveLength(33);
  output.setPlaying(false);
  output.consume(samples, 256, 44100);
  expect(messages.filter((m) => m.type === "samples")).toHaveLength(33);
  output.dispose();
});
