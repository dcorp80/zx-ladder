import { StereoQueue } from "./stereoQueue";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;
class SoundProcessor extends AudioWorkletProcessor {
  private readonly queue = new StereoQueue(sampleRate);
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.type === "reset") this.queue.reset();
      else if (
        data.type === "samples" &&
        data.samples instanceof Float32Array
      ) {
        this.queue.push(data.samples, data.frames);
        this.port.postMessage(
          {
            type: "accepted",
            samples: data.samples,
            generation: data.generation,
          },
          [data.samples.buffer],
        );
      }
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (output?.[0] && output[1]) this.queue.render(output[0], output[1]);
    return true;
  }
}
registerProcessor("ladder-sound", SoundProcessor);
