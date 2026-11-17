import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { rasterViewport } from "../../devices/frameRenderer";
import {
  LVIV_VIDEO_PRESET,
  PENTAGON_VIDEO_PRESET,
} from "../../devices/videoPresets";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";
import { VideoSection } from ".";

it("reuses ImageData and uploads only changed completed frames or presentation settings", async () => {
  const createImageData = vi.fn((width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }));
  const putImageData = vi.fn();
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({
      createImageData,
      putImageData,
    } as unknown as CanvasRenderingContext2D);
  const store = await createAppStore({
    backend: new MemoryBackend({
      initial: { name: "test.rom", bytes: new Uint8Array(16384) },
    }),
    machineFactory: (options) => {
      const machine = makeFakeMachine();
      if (options.videoPreset) machine.setVideoPreset(options.videoPreset);
      return machine;
    },
    hostLoopFactory: () => makeFakeLoop(),
  });
  store.setShowTechnicalFields(true);
  const view = render(() => (
    <StoreProvider value={store}>
      <VideoSection />
    </StoreProvider>
  ));
  try {
    expect(putImageData).not.toHaveBeenCalled();
    store.stepFrame();
    await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(1));
    expect(createImageData).toHaveBeenCalledTimes(1);
    const firstImage = putImageData.mock.calls[0][0];
    const version = store.frameVersion();
    store.machine()?.advancePixels(100);
    store.refresh();
    store.refresh();
    store.setTurbo(true);
    store.pause();
    expect(store.frameVersion()).toBe(version);
    expect(putImageData).toHaveBeenCalledTimes(1);

    store.stepFrame();
    await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(2));
    expect(putImageData.mock.calls[1][0]).toBe(firstImage);
    expect(createImageData).toHaveBeenCalledTimes(1);
    store.setShowBorder(false);
    await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(3));
    expect(putImageData.mock.calls[2][0]).toBe(firstImage);
    store.setShowBorder(false);
    store.refresh();
    expect(putImageData).toHaveBeenCalledTimes(3);

    // Catch-up execution presents only the latest completed frame.
    store.machine()?.advanceFrame();
    store.machine()?.advanceFrame();
    store.refresh();
    await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(4));
    expect(createImageData).toHaveBeenCalledTimes(1);
    store.setVideoPreset("lviv");
    expect(putImageData).toHaveBeenCalledTimes(4);
    store.stepFrame();
    await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(5));
    expect(createImageData).toHaveBeenCalledTimes(2);
    expect(putImageData.mock.calls[4][0].height).toBe(312);

    fireEvent.click(view.getByRole("button", { name: "Collapse Video" }));
    fireEvent.click(view.getByRole("button", { name: "Expand Video" }));
    await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(6));
    expect(createImageData).toHaveBeenCalledTimes(3);
    // A new machine must repaint even if its frame count matches the old one.
    store.coldBoot();
    store.stepFrame();
    await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(7));
    expect(createImageData).toHaveBeenCalledTimes(3);
  } finally {
    view.unmount();
    store.dispose();
    getContext.mockRestore();
  }
});

it.each([PENTAGON_VIDEO_PRESET, LVIV_VIDEO_PRESET])(
  "crops and repaints the retained $id frame when technical fields change",
  async (preset) => {
    const createImageData = vi.fn((width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }));
    const putImageData = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        createImageData,
        putImageData,
      } as unknown as CanvasRenderingContext2D);
    const store = await createAppStore({
      backend: new MemoryBackend({
        initial: { name: "test.rom", bytes: new Uint8Array(16384) },
      }),
      machineFactory: (options) => {
        const machine = makeFakeMachine();
        machine.setVideoPreset(options.videoPreset ?? preset);
        let technical = true;
        machine.setShowTechnicalFields = (enabled) => {
          technical = enabled;
        };
        machine.renderFrame = (_border, target) => {
          const rgba =
            target ?? new Uint8ClampedArray(machine.width * machine.height * 4);
          for (let y = 0; y < machine.height; y++) {
            for (let x = 0; x < machine.width; x++) {
              const offset = (y * machine.width + x) * 4;
              rgba[offset] = x & 255;
              rgba[offset + 1] = y & 255;
              rgba[offset + 2] = technical ? 255 : (x >>> 8) | ((y >>> 8) << 1);
              rgba[offset + 3] = 255;
            }
          }
          return rgba;
        };
        return machine;
      },
      hostLoopFactory: () => makeFakeLoop(),
    });
    store.setVideoPreset(preset.id);
    store.setShowTechnicalFields(true);
    const view = render(() => (
      <StoreProvider value={store}>
        <VideoSection />
      </StoreProvider>
    ));
    try {
      const toggle = view.getByRole("checkbox", {
        name: "Show technical fields",
      });
      expect(toggle).toBeChecked();
      const canvas = view.getByRole("img", { name: "ZX Spectrum full raster" });
      expect(canvas).toHaveAttribute("width", String(preset.width));
      expect(canvas).toHaveAttribute("height", String(preset.height));
      expect(view.getByText(/Run or step a frame/)).toBeInTheDocument();
      store.stepFrame();
      await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(1));
      const full = putImageData.mock.calls[0][0] as ImageData;
      const frame = store.frameVersion();
      fireEvent.click(toggle);
      await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(2));
      expect(store.frameVersion()).toBe(frame);
      const screen = view.getByRole("img", { name: "ZX Spectrum screen" });
      expect(screen).toBe(canvas);
      const viewport = rasterViewport(preset, false);
      expect(screen).toHaveAttribute("width", String(viewport.width));
      expect(screen).toHaveAttribute("height", String(viewport.height));
      expect(screen.parentElement).toHaveClass("is-screen-only");
      const cropped = putImageData.mock.calls[1][0] as ImageData;
      expect(cropped.width).toBe(viewport.width);
      expect(cropped.height).toBe(viewport.height);
      const expected = new Uint8ClampedArray(
        viewport.width * viewport.height * 4,
      );
      for (let y = 0; y < viewport.height; y++) {
        const sourceY = (viewport.sourceY + y) % preset.height;
        for (let x = 0; x < viewport.width; x++) {
          const sourceX = (viewport.sourceX + x) % preset.width;
          const offset = (y * viewport.width + x) * 4;
          expected[offset] = sourceX & 255;
          expected[offset + 1] = sourceY & 255;
          expected[offset + 2] = (sourceX >>> 8) | ((sourceY >>> 8) << 1);
          expected[offset + 3] = 255;
        }
      }
      expect(cropped.data).toEqual(expected);
      expect(createImageData).toHaveBeenCalledTimes(2);
      fireEvent.pointerDown(screen);
      expect(screen).toHaveFocus();
      store.refresh();
      expect(putImageData).toHaveBeenCalledTimes(2);
      store.stepFrame();
      await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(3));
      expect(putImageData.mock.calls[2][0]).toBe(cropped);
      fireEvent.click(toggle);
      await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(4));
      expect(putImageData.mock.calls[3][0]).toBe(full);
      fireEvent.click(toggle);
      await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(5));
      expect(putImageData.mock.calls[4][0]).toBe(cropped);
      expect(createImageData).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      store.dispose();
      getContext.mockRestore();
    }
  },
);

it("locks the border on for the cropped screen and restores normal and extended controls", async () => {
  const machine = makeFakeMachine();
  let extended = false;
  Object.defineProperty(machine, "extendedMode", { get: () => extended });
  machine.setExtendedMode = (enabled) => {
    extended = enabled;
  };
  const store = await createAppStore({
    backend: new MemoryBackend({
      initial: { name: "test.rom", bytes: new Uint8Array(16384) },
    }),
    machineFactory: () => machine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  store.setShowTechnicalFields(true);
  const view = render(() => (
    <StoreProvider value={store}>
      <VideoSection />
    </StoreProvider>
  ));
  try {
    const technical = view.getByRole("checkbox", {
      name: "Show technical fields",
    });
    const border = view.getByRole("checkbox", {
      name: "Show border over captured symbols",
    });
    const mode = view.getByRole("checkbox", {
      name: "384×304 mode (EFF7 bit 6)",
    });
    fireEvent.click(border);
    expect(border).not.toBeChecked();
    fireEvent.click(technical);
    expect(border).toBeChecked();
    expect(border).toBeDisabled();
    fireEvent.click(technical);
    expect(border).not.toBeChecked();
    expect(border).not.toBeDisabled();
    fireEvent.click(mode);
    expect(border).not.toBeChecked();
    expect(border).toBeDisabled();
    fireEvent.click(technical);
    expect(border).toBeChecked();
    expect(border).toBeDisabled();
    fireEvent.click(technical);
    expect(border).not.toBeChecked();
    expect(border).toBeDisabled();
    fireEvent.click(mode);
    expect(border).not.toBeChecked();
    expect(border).not.toBeDisabled();
  } finally {
    view.unmount();
    store.dispose();
  }
});
