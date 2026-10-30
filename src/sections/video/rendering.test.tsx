import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
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
