import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";
import { AppShell } from "./index";

describe("AppShell", () => {
  let dispose: (() => void) | undefined;

  afterEach(() => dispose?.());

  it("shows the emulator identity and current CPU mode", async () => {
    const store = await createAppStore({
      backend: new MemoryBackend({ persistent: true }),
      machineFactory: () => makeFakeMachine(),
      hostLoopFactory: (_machine, options) =>
        makeFakeLoop(options.onUpdate, options.onError),
    });
    const mounted = render(() => (
      <StoreProvider value={store}>
        <AppShell />
      </StoreProvider>
    ));
    dispose = () => {
      mounted.unmount();
      store.dispose();
    };
    expect(
      mounted.getByText("Hardware-like ZX Spectrum emulator"),
    ).toBeInTheDocument();
    expect(mounted.getByText("3.5 MHz CPU")).toBeInTheDocument();
  });
});
