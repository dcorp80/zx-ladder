import { PcmQueue } from "./pcmQueue";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;
class BeeperProcessor extends AudioWorkletProcessor {
  private readonly queue = new PcmQueue(sampleRate);
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.type === "reset") this.queue.reset();
      else if (
        data.type === "samples" &&
        data.samples instanceof Float32Array
      ) {
        this.queue.push(data.samples);
        this.port.postMessage({
          type: "accepted",
          generation: data.generation,
        });
      }
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]?.[0];
    if (output) this.queue.render(output);
    return true;
  }
}
registerProcessor("ladder-beeper", BeeperProcessor);
