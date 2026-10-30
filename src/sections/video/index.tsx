import { type Component, createEffect, onMount } from "solid-js";
import { VIDEO_PRESETS } from "../../devices/videoPresets";
import { rasterTiming } from "../../machine/config";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";

const VideoCanvas: Component<{
  onCanvas: (canvas: HTMLCanvasElement) => void;
}> = (props) => {
  const store = useStore();
  let canvas: HTMLCanvasElement | undefined;

  const paint = () => {
    const element = canvas;
    const active = store.machine();
    if (!element || !active?.hasFrame) return;
    try {
      const context = element.getContext("2d");
      if (!context) return;
      const rgba = active.renderFrame(store.showBorder());
      const image = context.createImageData(active.width, active.height);
      image.data.set(rgba);
      context.putImageData(image, 0, 0);
    } catch (cause) {
      // A missing canvas context in jsdom is harmless. Keep browser rendering
      // failures out of Solid's effect queue so controls remain usable.
      if (cause instanceof Error && !cause.message.includes("canvas")) {
        console.error(cause);
      }
    }
  };

  createEffect(() => {
    store.frameVersion();
    store.showBorder();
    store.machine();
    paint();
  });
  onMount(paint);

  return (
    <div class="machine-canvas-wrap">
      <canvas
        ref={(element) => {
          canvas = element;
          props.onCanvas(element);
        }}
        class="machine-canvas"
        tabIndex={0}
        data-emulator-input="true"
        onPointerDown={(event) =>
          event.currentTarget.focus({ preventScroll: true })
        }
        width={store.status().width}
        height={store.status().height}
        role="img"
        aria-label="ZX Spectrum full raster"
      />
      {!store.status().hasFrame && (
        <div class="canvas-placeholder">
          {store.machine()
            ? "Run or step a frame to display the selected video preset."
            : "Choose a 16 KiB ROM, then run or step the machine."}
        </div>
      )}
    </div>
  );
};

export const VideoSection: Component = () => {
  const store = useStore();
  let canvas: HTMLCanvasElement | undefined;
  createEffect(() => {
    if (!store.screenFocusRequest()) return;
    // The section may need to unfold before its canvas exists.
    queueMicrotask(() => {
      if (canvas?.isConnected) canvas.focus({ preventScroll: true });
    });
  });
  return (
    <SectionFrame
      title="Video"
      openRequest={store.screenFocusRequest()}
      subtitle={`${store.videoPreset().label} · ${store.videoPreset().width}×${store.videoPreset().height}`}
      defaultFolded={false}
    >
      <div class="video-layout">
        <VideoCanvas
          onCanvas={(element) => {
            canvas = element;
          }}
        />
        <div class="machine-controls">
          <label class="setting-row">
            <span>Video preset</span>
            <select
              value={store.videoPreset().id}
              onChange={(event) =>
                store.setVideoPreset(event.currentTarget.value)
              }
            >
              {VIDEO_PRESETS.map((preset) => (
                <option value={preset.id}>{preset.label}</option>
              ))}
            </select>
          </label>
          <label class="setting-row setting-check">
            <input
              type="checkbox"
              checked={store.showBorder()}
              onChange={(event) =>
                store.setShowBorder(event.currentTarget.checked)
              }
            />
            <span>Show border over captured symbols</span>
          </label>

          <label class="setting-row setting-check">
            <input
              type="checkbox"
              checked={store.lateInt()}
              disabled
              title="Experimental timing disabled pending investigation"
              onChange={(event) =>
                store.setLateInt(event.currentTarget.checked)
              }
            />
            <span>Late INT</span>
          </label>

          <dl class="machine-status" aria-live="polite">
            <div title="Measured emulation FPS, updated every 16 completed frames">
              <dt>FPS</dt>
              <dd>{store.fps()?.toFixed(2) ?? "—"}</dd>
            </div>
            <div>
              <dt>Frame rate</dt>
              <dd>{rasterTiming(store.videoPreset()).frameHz.toFixed(3)} Hz</dd>
            </div>
            <div>
              <dt>Raster</dt>
              <dd>
                {store.status().width}×{store.status().height}
              </dd>
            </div>
            <div>
              <dt>Pixels / frame</dt>
              <dd>{store.videoPreset().pixelsPerFrame.toLocaleString()}</dd>
            </div>
          </dl>
          <p class="machine-note">
            The canvas is the complete timed raster, including sync and
            blanking. The orange line marks active INT, ending on timeout or CPU
            acknowledgment. Presentation uses the latest completed frame only.
          </p>
        </div>
      </div>
    </SectionFrame>
  );
};
export const videoSection = {
  id: "video",
  title: "Video",
  Body: VideoSection,
  defaultFolded: false,
};
