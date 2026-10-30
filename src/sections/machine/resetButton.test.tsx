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
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.blur(window);
    expect(reset).toHaveBeenLastCalledWith(false);
    expect(store.isRunning()).toBe(true);
    fireEvent.click(button, { detail: 0 });
    expect(reset.mock.calls.slice(-2)).toEqual([[true], [false]]);
  } finally {
    view.unmount();
    store.dispose();
  }
});
