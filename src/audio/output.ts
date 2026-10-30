import workletUrl from "./beeper.worklet.ts?worker&url";
import { BeeperResampler } from "./resampler";

/** Browser playback adapter. Capture buffers stay owned by the video device. */
export class BeeperOutput {
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private gain?: GainNode;
  private resampler?: BeeperResampler;
  private pending?: Promise<void>;
  private playing = false;
  private volume = 0.2;
  private disposed = false;
  private generation = 0;
  private inFlight = 0;
  private skipFrame = true;
  private readonly visibility = () => this.reset();
  constructor(private readonly status: (text: string) => void) {
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.visibility);
  }
  async unlock(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: "interactive" });
        const context = this.context;
        context.onstatechange = () => {
          if (this.disposed) return;
          this.reset();
          this.status(
            context.state === "running"
              ? "Ready"
              : "Click or press a key to enable audio",
          );
        };
        this.resampler = new BeeperResampler(context.sampleRate);
        this.pending = context.audioWorklet.addModule(workletUrl).then(() => {
          if (this.disposed) return;
          const node = new AudioWorkletNode(context, "ladder-beeper", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });
          this.node = node;
          node.port.onmessage = ({ data }) => {
            if (data.type === "accepted" && data.generation === this.generation)
              this.inFlight = Math.max(0, this.inFlight - 1);
          };
          const highpass = context.createBiquadFilter();
          highpass.type = "highpass";
          highpass.frequency.value = 20;
          const lowpass = context.createBiquadFilter();
          lowpass.type = "lowpass";
          lowpass.frequency.value = Math.min(8000, context.sampleRate * 0.4);
          const gain = context.createGain();
          this.gain = gain;
          gain.gain.value = this.volume;
          node
            .connect(highpass)
            .connect(lowpass)
            .connect(gain)
            .connect(context.destination);
          this.reset();
        });
      }
      // Call resume while the trusted gesture is still active.
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
  setVolume(value: number): void {
    this.volume = value;
    if (this.gain && this.context)
      this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
  }
  reset(): void {
    this.generation++;
    this.inFlight = 0;
    this.skipFrame = true;
    this.resampler?.reset();
    this.node?.port.postMessage({ type: "reset" });
  }
  consumeFrame(latch: Uint8Array, slotHz: number): void {
    if (
      !this.playing ||
      !this.node ||
      !this.resampler ||
      this.context?.state !== "running" ||
      document.hidden
    )
      return;
    if (this.skipFrame) {
      this.skipFrame = false;
      return;
    }
    if (this.inFlight >= 4) {
      this.reset();
      return;
    }
    const samples = this.resampler.convert(latch, slotHz);
    this.inFlight++;
    this.node.port.postMessage(
      { type: "samples", samples, generation: this.generation },
      [samples.buffer],
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
