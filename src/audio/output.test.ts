import { afterEach, expect, it, vi } from "vitest";
import { SoundOutput } from "./output";

afterEach(() => vi.unstubAllGlobals());
function audioHarness() {
  const messages: {
    type: string;
    samples?: Float32Array;
    frames?: number;
    generation?: number;
  }[] = [];
  let receive: ((event: { data: unknown }) => void) | undefined;
  const destination = {};
  const connect = vi.fn();
  const createBiquadFilter = vi.fn();
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      setTargetAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const disconnect = vi.fn();
  const close = vi.fn();
  const clock = { time: 12 };
  let nodeOptions: unknown;
  vi.stubGlobal(
    "AudioContext",
    class {
      sampleRate = 44100;
      state = "running";
      get currentTime() {
        return clock.time;
      }
      createGain = () => gain;
      destination = destination;
      audioWorklet = { addModule: async () => {} };
      createBiquadFilter = createBiquadFilter;
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
        close: close,
      };
      connect = connect;
      disconnect = disconnect;
      constructor(_ctx: unknown, _name: string, options: unknown) {
        nodeOptions = options;
      }
    },
  );
  return {
    messages,
    receive: (data: unknown) => receive?.({ data }),
    destination,
    connect,
    disconnect,
    close,
    gain,
    clock,
    nodeOptions: () => nodeOptions,
    createBiquadFilter,
  };
}

it("uses host-rate stereo, bounds transfers and recycles acknowledgments across resets", async () => {
  const h = audioHarness();
  const { messages } = h;
  const rate = vi.fn();
  const status = vi.fn();
  const output = new SoundOutput(status, rate);
  await output.unlock();
  output.setPlaying(true);
  expect(rate).toHaveBeenCalledWith(44100);
  expect(h.nodeOptions()).toMatchObject({ outputChannelCount: [2] });
  expect(h.connect).toHaveBeenCalledExactlyOnceWith(h.gain);
  expect(h.gain.connect).toHaveBeenCalledExactlyOnceWith(h.destination);
  expect(h.gain.gain.setValueAtTime).toHaveBeenCalledExactlyOnceWith(1, 12);
  expect(h.createBiquadFilter).not.toHaveBeenCalled();
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
  h.receive({
    type: "accepted",
    samples: new Float32Array(sent[0].samples ?? []),
    generation: sent[0].generation,
  });
  output.consume(samples, 256, 44100);
  expect(messages.filter((m) => m.type === "samples")).toHaveLength(33);
  output.setPlaying(false);
  output.consume(samples, 256, 44100);
  expect(messages.filter((m) => m.type === "samples")).toHaveLength(33);
  output.dispose();
  expect(h.disconnect).toHaveBeenCalledOnce();
  expect(h.gain.disconnect).toHaveBeenCalledOnce();
  expect(h.close).toHaveBeenCalledOnce();
});

it("applies pre-unlock master mute before connecting and smooths output-only level changes", async () => {
  const h = audioHarness();
  const output = new SoundOutput(vi.fn(), vi.fn());
  output.setMasterVolume(0);
  await output.unlock();
  expect(h.gain.gain.setValueAtTime).toHaveBeenCalledExactlyOnceWith(0, 12);
  expect(h.gain.gain.setValueAtTime.mock.invocationCallOrder[0]).toBeLessThan(
    h.connect.mock.invocationCallOrder[0],
  );
  expect(h.gain.gain.setValueAtTime.mock.invocationCallOrder[0]).toBeLessThan(
    h.gain.connect.mock.invocationCallOrder[0],
  );
  output.setPlaying(true);
  const resets = h.messages.filter(
    (message) => message.type === "reset",
  ).length;
  h.clock.time = 13;
  output.setMasterVolume(0.37);
  expect(h.gain.gain.cancelScheduledValues).toHaveBeenLastCalledWith(13);
  expect(h.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.37, 13, 0.01);
  output.setMasterVolume(0);
  expect(h.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 13, 0.01);
  const samples = new Float32Array(512).fill(0.25);
  output.consume(samples, 256, 44100);
  expect(
    h.messages.findLast((message) => message.type === "samples")?.samples?.[0],
  ).toBe(0.25);
  expect(h.messages.filter((message) => message.type === "reset")).toHaveLength(
    resets,
  );
  output.setMasterVolume(0.37);
  expect(h.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.37, 13, 0.01);
  output.setMasterVolume(2);
  expect(h.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 13, 0.01);
  const changes = h.gain.gain.setTargetAtTime.mock.calls.length;
  output.setMasterVolume(NaN);
  output.setMasterVolume(1);
  expect(h.gain.gain.setTargetAtTime).toHaveBeenCalledTimes(changes);
  output.dispose();
});
