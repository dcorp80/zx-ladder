import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { App } from "../../app";
import { fileId } from "../../files/library";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";

it("focuses the screen after reset release and successful Load, reopening folded Video", async () => {
  const machine = makeFakeMachine();
  machine.loadTape = vi.fn();
  const backend = new MemoryBackend({
    initial: { name: "test.rom", bytes: new Uint8Array(16384) },
  });
  const id = fileId(null, "test.tap");
  await backend.putFiles([
    {
      id,
      name: "test.tap",
      group: null,
      bytes: new Uint8Array([2, 0, 255, 255]),
      size: 4,
      updatedAt: 0,
      warning: "",
    },
  ]);
  const store = await createAppStore({
    backend,
    machineFactory: () => machine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  const view = render(() => (
    <StoreProvider value={store}>
      <App />
    </StoreProvider>
  ));
  try {
    const reset = view.getByRole("button", { name: "Reset" });
    reset.focus();
    fireEvent.keyDown(reset, { key: "Enter", code: "Enter" });
    expect(reset).toHaveFocus();
    fireEvent.keyUp(reset, { key: "Enter", code: "Enter" });
    await waitFor(() =>
      expect(
        view.getByRole("img", { name: "ZX Spectrum full raster" }),
      ).toHaveFocus(),
    );
    const screen = view.getByRole("img", { name: "ZX Spectrum full raster" });
    fireEvent.keyDown(screen, { key: "a", code: "KeyA" });
    expect(machine.keyboard.isPressed("A")).toBe(true);
    fireEvent.keyUp(screen, { key: "a", code: "KeyA" });
    const fold = view.getByRole("button", { name: "Collapse Video" });
    fold.focus();
    fireEvent.click(fold);
    expect(
      view.queryByRole("img", { name: "ZX Spectrum full raster" }),
    ).toBeNull();
    const load = view.getByRole("button", { name: "Load" });
    load.focus();
    fireEvent.click(load);
    await waitFor(() =>
      expect(
        view.getByRole("img", { name: "ZX Spectrum full raster" }),
      ).toHaveFocus(),
    );
    expect(machine.loadTape).toHaveBeenCalledOnce();
    machine.loadTape = () => {
      throw new Error("Unsupported ROM");
    };
    load.focus();
    fireEvent.click(load);
    await waitFor(() => expect(store.error()).toBe("Unsupported ROM"));
    expect(load).toHaveFocus();
    reset.focus();
    fireEvent.keyDown(reset, { key: "Enter", code: "Enter" });
    const theme = view.getByRole("button", { name: "Dark" });
    theme.focus();
    await Promise.resolve();
    expect(theme).toHaveFocus();
    expect(reset).toHaveAttribute("aria-pressed", "false");
  } finally {
    view.unmount();
    store.dispose();
  }
});
