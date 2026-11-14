import { type Component, createEffect, createMemo } from "solid-js";
import {
  copyRasterViewport,
  rasterViewport,
} from "../../devices/frameRenderer";
import { VIDEO_PRESETS } from "../../devices/videoPresets";
import { rasterTiming } from "../../machine/config";
import { useStore } from "../../store";
import { SectionFrame } from "../frame";

const VideoCanvas: Component<{
  onCanvas: (canvas: HTMLCanvasElement) => void;
}> = (props) => {
  const store = useStore();
  let canvas: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let fullImage: ImageData | undefined;
  let croppedImage: ImageData | undefined;
  let paintedVersion = -1;
  let paintedBorder: boolean | undefined;
  let paintedTechnical: boolean | undefined;
  let paintedMachine: ReturnType<typeof store.machine>;
  const preset = createMemo(() => {
    store.frameVersion();
    return store.machine()?.videoPreset ?? store.videoPreset();
  });
  const viewport = createMemo(() =>
    rasterViewport(preset(), store.showTechnicalFields()),
  );

  const paint = () => {
    const element = canvas;
    const active = store.machine();
    const version = store.frameVersion();
    const border = store.showBorder();
    const technical = store.showTechnicalFields();
    const visible = viewport();
    if (!element || !active?.hasFrame) return;
    if (
      paintedMachine === active &&
      paintedVersion === version &&
      paintedBorder === border &&
      paintedTechnical === technical &&
      fullImage?.width === active.width &&
      fullImage?.height === active.height
    )
      return;
    try {
      context ??= element.getContext("2d");
      if (!context) return;
      // Allocate once per canvas/raster size, never once per frame.
      if (
        !fullImage ||
        fullImage.width !== active.width ||
        fullImage.height !== active.height
      )
        fullImage = context.createImageData(active.width, active.height);
      const rgba = active.renderFrame(border, fullImage.data);
      if (rgba !== fullImage.data) fullImage.data.set(rgba);
      let image = fullImage;
      if (!technical) {
        if (
          !croppedImage ||
          croppedImage.width !== visible.width ||
          croppedImage.height !== visible.height
        )
          croppedImage = context.createImageData(visible.width, visible.height);
        copyRasterViewport(
          fullImage.data,
          preset(),
          croppedImage.data,
          visible,
        );
        image = croppedImage;
      }
      context.putImageData(image, 0, 0);
      paintedMachine = active;
      paintedVersion = version;
      paintedBorder = border;
      paintedTechnical = technical;
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
    store.showTechnicalFields();
    store.machine();
    paint();
  });

  return (
    <div
      class="machine-canvas-wrap"
      classList={{ "is-screen-only": !store.showTechnicalFields() }}
    >
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
        width={viewport().width}
        height={viewport().height}
        role="img"
        aria-label={
          store.showTechnicalFields()
            ? "ZX Spectrum full raster"
            : "ZX Spectrum screen"
        }
      />
      {!store.status().hasFrame && (
        <div class="canvas-placeholder">
          {store.machine()
            ? "Run or step a frame to display the selected video preset."
            : "Choose a ROM, then run or step the machine."}
        </div>
      )}
    </div>
  );
};

export const VideoSection: Component = () => {
  const store = useStore();
  const viewport = createMemo(() =>
    rasterViewport(store.videoPreset(), store.showTechnicalFields()),
  );
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
      subtitle={`${store.videoPreset().label} · ${viewport().width}×${viewport().height}`}
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
              checked={store.showTechnicalFields()}
              onChange={(event) =>
                store.setShowTechnicalFields(event.currentTarget.checked)
              }
            />
            <span>Show technical fields</span>
          </label>
          <label class="setting-row setting-check">
            <input
              type="checkbox"
              checked={
                !store.showTechnicalFields() ||
                (!store.status().extendedMode && store.showBorder())
              }
              disabled={
                !store.showTechnicalFields() || !!store.status().extendedMode
              }
              onChange={(event) =>
                store.setShowBorder(event.currentTarget.checked)
              }
            />
            <span>Show border over captured symbols</span>
          </label>

          <label class="setting-row setting-check">
            <input
              type="checkbox"
              checked={!!store.status().extendedMode}
              onChange={(event) =>
                store.setExtendedMode(event.currentTarget.checked)
              }
            />
            <span>384×304 mode (EFF7 bit 6)</span>
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
            {store.showTechnicalFields()
              ? "The canvas is the complete timed raster, including sync and blanking. The orange line marks active INT, ending on timeout or CPU acknowledgment."
              : "The canvas shows the visible screen and border."}{" "}
            Presentation uses the latest completed frame only.
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
