import { KeyboardDevice } from "../devices/keyboard";
import type { VideoPreset } from "../devices/videoPresets";
import { PENTAGON_VIDEO_PRESET } from "../devices/videoPresets";
import { rasterTiming } from "../machine/config";
import type { HostLoopLike, MachineLike } from "../store";

export function makeFakeMachine(): MachineLike {
  const width = PENTAGON_VIDEO_PRESET.width;
  const height = PENTAGON_VIDEO_PRESET.height;
  const machine = {
    videoPreset: PENTAGON_VIDEO_PRESET,
    timing: rasterTiming(PENTAGON_VIDEO_PRESET),
    width,
    height,
    cpu: { regs: { pc: 0 } },
    keyboard: new KeyboardDevice(),
    counters: new Float64Array(6),
    frameCount: 0,
    framePosition: 0,
    cpu7: false,
    hasFrame: false,
    setReset(_pressed: boolean) {},
    setLateInt(_enabled: boolean) {},
    setVideoPreset(preset: VideoPreset) {
      machine.videoPreset = preset;
      machine.timing = rasterTiming(preset);
      machine.width = preset.width;
      machine.height = preset.height;
      machine.framePosition = 0;
      machine.hasFrame = false;
    },
    setTurbo(enabled: boolean) {
      machine.cpu7 = enabled;
    },
    advancePixels(count: number) {
      const pixelsPerFrame = machine.videoPreset.pixelsPerFrame;
      machine.counters[0] += count;
      const current = machine.framePosition + Math.max(0, Math.floor(count));
      const complete = Math.floor(current / pixelsPerFrame);
      machine.frameCount += complete;
      machine.framePosition = current % pixelsPerFrame;
      machine.hasFrame ||= complete > 0;
      const regs = machine.cpu.regs;
      if (regs) regs.pc = (regs.pc ?? 0) + count;
      return complete;
    },
    advanceFrame() {
      machine.counters[0] +=
        machine.videoPreset.pixelsPerFrame - machine.framePosition;
      machine.frameCount += 1;
      machine.framePosition = 0;
      machine.hasFrame = true;
    },
    renderFrame() {
      const rgba = new Uint8ClampedArray(machine.width * machine.height * 4);
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      return rgba;
    },
  };
  return machine as MachineLike;
}

export function makeFakeLoop(
  onUpdate?: () => void,
  onError?: (error: unknown) => void,
): HostLoopLike {
  let running = false;
  return {
    start() {
      try {
        running = true;
        onUpdate?.();
      } catch (error) {
        onError?.(error);
      }
    },
    pause() {
      running = false;
    },
    dispose() {
      running = false;
    },
    isRunning() {
      return running;
    },
  };
}
