import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { App } from "../../app";
import { fileId } from "../../files/library";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";

it.each([true, false])(
  "keeps paused Reset focused and focuses the keyboard after media Load (jump=%s)",
  async (jump) => {
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
      const setting = view.getByRole("checkbox", {
        name: "Jump to screen on media Run",
      });
      expect(setting).toBeChecked();
      if (!jump) fireEvent.click(setting);
      const reset = view.getByRole("button", { name: "Reset" });
      reset.focus();
      fireEvent.keyDown(reset, { key: "Enter", code: "Enter" });
      expect(reset).toHaveFocus();
      fireEvent.keyUp(reset, { key: "Enter", code: "Enter" });
      await Promise.resolve();
      expect(reset).toHaveFocus();
      const fold = view.getByRole("button", { name: "Collapse Video" });
      fold.focus();
      fireEvent.click(fold);
      expect(
        view.queryByRole("img", { name: "ZX Spectrum screen" }),
      ).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Collapse Keyboard" }));
      const load = view.getByRole("button", { name: "Load" });
      load.focus();
      fireEvent.click(load);
      await waitFor(() =>
        expect(
          view.getByRole("application", { name: "Spectrum keyboard input" }),
        ).toHaveFocus(),
      );
      expect(machine.loadTape).toHaveBeenCalledOnce();
      expect(store.screenScrollRequest()).toBe(jump ? 1 : 0);
      expect(!!view.queryByRole("img", { name: "ZX Spectrum screen" })).toBe(
        jump,
      );
      const keyboard = view.getByRole("application", {
        name: "Spectrum keyboard input",
      });
      fireEvent.keyDown(keyboard, { key: "a", code: "KeyA" });
      expect(machine.keyboard.isPressed("A")).toBe(true);
      fireEvent.keyUp(keyboard, { key: "a", code: "KeyA" });
      machine.loadTape = () => {
        throw new Error("Unsupported ROM");
      };
      load.focus();
      fireEvent.click(load);
      await waitFor(() => expect(store.error()).toBe("Unsupported ROM"));
      expect(load).toHaveFocus();
      expect(store.screenScrollRequest()).toBe(jump ? 1 : 0);
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
  },
);
