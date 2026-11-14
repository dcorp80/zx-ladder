import { StereoDcFilter } from "./dcFilter";
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
  private readonly dcFilter = new StereoDcFilter(sampleRate);
  private readonly queue = new StereoQueue(sampleRate);
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.type === "reset") {
        this.dcFilter.reset();
        this.queue.reset();
      } else if (
        data.type === "samples" &&
        data.samples instanceof Float32Array
      ) {
        this.dcFilter.process(data.samples, data.frames);
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
