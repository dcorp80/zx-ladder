import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../app";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";
import { MachineSection } from ".";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "opens and focuses the visible keyboard on Run and running Reset, preserving Pause focus (compact=%s)",
  async (compact) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: compact && /max-width:\s*760px/.test(query),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const machine = makeFakeMachine();
    const store = await createAppStore({
      backend: new MemoryBackend({
        initial: { name: "test.rom", bytes: new Uint8Array(32768) },
      }),
      machineFactory: () => machine,
      hostLoopFactory: () => makeFakeLoop(),
    });
    const view = render(() => (
      <StoreProvider value={store}>
        <App />
      </StoreProvider>
    ));
    const keyboardName = compact
      ? "Compact Spectrum keyboard"
      : "Spectrum keyboard input";
    try {
      fireEvent.click(view.getByRole("button", { name: "Collapse Keyboard" }));
      expect(
        view.queryByRole("application", { name: keyboardName }),
      ).toBeNull();
      const run = view.getByRole("button", { name: "Run" });
      run.focus();
      fireEvent.keyDown(run, { key: "Enter", code: "Enter" });
      fireEvent.click(run, { detail: 0 });
      await waitFor(() =>
        expect(
          view.getByRole("application", { name: keyboardName }),
        ).toHaveFocus(),
      );
      expect(store.isRunning()).toBe(true);
      let keyboard = view.getByRole("application", { name: keyboardName });
      for (const [key, code] of [
        ["Enter", "Enter"],
        [" ", "Space"],
      ]) {
        fireEvent.keyDown(keyboard, { key, code, repeat: true });
        fireEvent.keyUp(keyboard, { key, code });
      }
      expect(machine.keyboard.isPressed("ENTER")).toBe(false);
      expect(machine.keyboard.isPressed("SPACE")).toBe(false);
      fireEvent.keyDown(keyboard, { key: "a", code: "KeyA" });
      expect(machine.keyboard.isPressed("A")).toBe(true);
      fireEvent.keyUp(keyboard, { key: "a", code: "KeyA" });

      const pause = view.getByRole("button", { name: "Pause" });
      pause.focus();
      fireEvent.click(pause);
      await Promise.resolve();
      expect(store.isRunning()).toBe(false);
      expect(pause).toHaveFocus();

      const fold = view.getByRole("button", { name: "Collapse Keyboard" });
      fold.focus();
      fireEvent.click(fold);
      store.run();
      await Promise.resolve();
      expect(fold).toHaveFocus();
      expect(
        view.queryByRole("application", { name: keyboardName }),
      ).toBeNull();
      const reset = view.getByRole("button", { name: "Reset" });
      reset.focus();
      fireEvent.keyDown(reset, { key: "Enter", code: "Enter" });
      expect(reset).toHaveFocus();
      fireEvent.keyUp(reset, { key: "Enter", code: "Enter" });
      await waitFor(() =>
        expect(
          view.getByRole("application", { name: keyboardName }),
        ).toHaveFocus(),
      );
      keyboard = view.getByRole("application", { name: keyboardName });
      expect(machine.keyboard.isPressed("ENTER")).toBe(false);
      expect(store.isRunning()).toBe(true);
      expect(keyboard).toHaveFocus();
    } finally {
      view.unmount();
      store.dispose();
    }
  },
);

it("keeps Run focused when starting fails", async () => {
  const store = await createAppStore({
    backend: new MemoryBackend({
      initial: { name: "test.rom", bytes: new Uint8Array(32768) },
    }),
    machineFactory: () => makeFakeMachine(),
    hostLoopFactory: () => ({
      ...makeFakeLoop(),
      start() {
        throw new Error("Run failed");
      },
    }),
  });
  const focusKeyboard = vi.spyOn(store, "focusKeyboard");
  const view = render(() => (
    <StoreProvider value={store}>
      <MachineSection />
    </StoreProvider>
  ));
  try {
    const run = view.getByRole("button", { name: "Run" });
    run.focus();
    fireEvent.click(run);
    await Promise.resolve();
    expect(store.error()).toBe("Run failed");
    expect(store.isRunning()).toBe(false);
    expect(run).toHaveFocus();
    expect(focusKeyboard).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    store.dispose();
  }
});
