import { fireEvent, render } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";
import { ResetButton } from "./resetButton";

it("holds reset on keyboard press, releases on blur, and never pauses the loop", async () => {
  const machine = makeFakeMachine();
  const reset = vi.spyOn(machine, "setReset");
  const store = await createAppStore({
    backend: new MemoryBackend(),
    machineFactory: () => machine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  await store.importRom(new File([new Uint8Array(16384)], "test.rom"));
  const focusKeyboard = vi.spyOn(store, "focusKeyboard");
  const focusScreen = vi.spyOn(store, "focusScreen");
  store.run();
  const view = render(() => (
    <StoreProvider value={store}>
      <ResetButton />
    </StoreProvider>
  ));
  try {
    const button = view.getByRole("button", { name: "Reset" });
    fireEvent.keyDown(button, { key: " " });
    expect(reset).toHaveBeenLastCalledWith(true);
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyUp(button, { key: " " });
    expect(reset).toHaveBeenLastCalledWith(false);
    expect(focusKeyboard).toHaveBeenCalledOnce();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.blur(window);
    expect(reset).toHaveBeenLastCalledWith(false);
    expect(focusKeyboard).toHaveBeenCalledOnce();
    expect(store.isRunning()).toBe(true);
    fireEvent.click(button, { detail: 0 });
    expect(reset.mock.calls.slice(-2)).toEqual([[true], [false]]);
    expect(focusKeyboard).toHaveBeenCalledTimes(2);
    expect(focusScreen).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    store.dispose();
  }
});

it.each([false, true])(
  "focuses the keyboard only on normal release while running, preserving focus on cancellation (running=%s)",
  async (running) => {
    const store = await createAppStore({
      backend: new MemoryBackend({
        initial: { name: "test.rom", bytes: new Uint8Array(32768) },
      }),
      machineFactory: () => makeFakeMachine(),
      hostLoopFactory: () => makeFakeLoop(),
    });
    const focusKeyboard = vi.spyOn(store, "focusKeyboard");
    const focusScreen = vi.spyOn(store, "focusScreen");
    if (running) store.run();
    const view = render(() => (
      <StoreProvider value={store}>
        <ResetButton />
        <button type="button">Other control</button>
      </StoreProvider>
    ));
    try {
      const button = view.getByRole("button", { name: "Reset" });
      button.setPointerCapture = vi.fn();
      button.focus();
      fireEvent.keyDown(button, { key: " " });
      fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
      fireEvent.pointerUp(button, { pointerId: 1 });
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(focusKeyboard).not.toHaveBeenCalled();
      fireEvent.keyUp(button, { key: " " });
      expect(focusKeyboard).toHaveBeenCalledTimes(running ? 1 : 0);
      fireEvent.pointerDown(button, { button: 0, pointerId: 2 });
      fireEvent.pointerCancel(button, { pointerId: 2 });
      fireEvent.pointerDown(button, { button: 0, pointerId: 3 });
      fireEvent.lostPointerCapture(button, { pointerId: 3 });
      fireEvent.keyDown(button, { key: "Enter" });
      const other = view.getByRole("button", { name: "Other control" });
      other.focus();
      fireEvent.blur(window);
      await Promise.resolve();
      expect(other).toHaveFocus();
      expect(button).toHaveAttribute("aria-pressed", "false");
      expect(focusKeyboard).toHaveBeenCalledTimes(running ? 1 : 0);
      button.focus();
      fireEvent.pointerDown(button, { button: 0, pointerId: 4 });
      fireEvent.pointerUp(button, { pointerId: 4 });
      expect(focusKeyboard).toHaveBeenCalledTimes(running ? 2 : 0);
      fireEvent.click(button, { detail: 0 });
      expect(focusKeyboard).toHaveBeenCalledTimes(running ? 3 : 0);
      expect(focusScreen).not.toHaveBeenCalled();
      if (!running) expect(button).toHaveFocus();
    } finally {
      view.unmount();
      store.dispose();
    }
  },
);
