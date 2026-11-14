import workletUrl from "./beeper.worklet.ts?worker&url";
import { PCM_BLOCK_FRAMES } from "./mixer";

/** Browser stereo playback; pooled buffers are recycled by the worklet. */
export class SoundOutput {
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private pending?: Promise<void>;
  private playing = false;
  private disposed = false;
  private generation = 0;
  private readonly buffers = Array.from(
    { length: 32 },
    () => new Float32Array(PCM_BLOCK_FRAMES * 2),
  );
  private readonly visibility = () => this.reset();
  constructor(
    private readonly status: (text: string) => void,
    private readonly rateChanged: (rate: number) => void,
  ) {
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.visibility);
  }
  async unlock(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: "interactive" });
        const context = this.context;
        this.rateChanged(context.sampleRate);
        context.onstatechange = () => {
          if (this.disposed) return;
          this.reset();
          this.status(
            context.state === "running"
              ? "Ready"
              : "Click or press a key to enable audio",
          );
        };
        this.pending = context.audioWorklet.addModule(workletUrl).then(() => {
          if (this.disposed) return;
          const node = new AudioWorkletNode(context, "ladder-sound", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          this.node = node;
          node.port.onmessage = ({ data }) => {
            // Old generations still own valid storage; always recycle it.
            if (
              data.type === "accepted" &&
              data.samples instanceof Float32Array &&
              this.buffers.length < 32
            )
              this.buffers.push(data.samples);
          };
          node.connect(context.destination);
          this.reset();
        });
      }
      await Promise.all([this.context.resume(), this.pending]);
      if (!this.disposed)
        this.status(
          this.context.state === "running"
            ? "Ready"
            : "Click or press a key to enable audio",
        );
    } catch (error) {
      this.status(
        `Audio unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  setPlaying(value: boolean): void {
    if (value === this.playing) return;
    this.playing = value;
    this.reset();
  }
  reset(): void {
    this.generation++;
    this.node?.port.postMessage({ type: "reset" });
  }
  consume(samples: Float32Array, frames: number, sampleRate: number): void {
    if (
      !this.playing ||
      !this.node ||
      this.context?.state !== "running" ||
      document.hidden ||
      sampleRate !== this.context.sampleRate
    )
      return;
    const buffer = this.buffers.pop();
    if (!buffer) return;
    buffer.set(samples);
    this.node.port.postMessage(
      { type: "samples", samples: buffer, frames, generation: this.generation },
      [buffer.buffer],
    );
  }
  dispose(): void {
    this.disposed = true;
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.visibility);
    this.node?.disconnect();
    this.node?.port.close();
    void this.context?.close().catch(() => {});
  }
}
