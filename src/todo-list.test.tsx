import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./app";
import { MemoryBackend } from "./storage/memory";
import { ROM_SIZE } from "./storage/types";
import { createAppStore, StoreProvider } from "./store";
import { makeFakeLoop, makeFakeMachine } from "./test/fakes";

const mount = async (backend = new MemoryBackend({ persistent: true })) => {
  const store = await createAppStore({
    backend,
    machineFactory: () => makeFakeMachine(),
    hostLoopFactory: (_machine, options) =>
      makeFakeLoop(options.onUpdate, options.onError),
  });
  const mounted = render(() => (
    <StoreProvider value={store}>
      <App />
    </StoreProvider>
  ));
  return { store, mounted };
};

let cleanup: (() => void) | undefined;
let restoreCanvas: (() => void) | undefined;
beforeEach(() => {
  const prototype = HTMLCanvasElement.prototype;
  const original = prototype.getContext;
  prototype.getContext = (() => null) as typeof original;
  restoreCanvas = () => {
    prototype.getContext = original;
  };
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  restoreCanvas?.();
  restoreCanvas = undefined;
});

describe("ZX Ladder shell", () => {
  it("switches video and turbo while preserving the running machine and total ticks", async () => {
    const app = await mount();
    cleanup = () => {
      app.mounted.unmount();
      app.store.dispose();
    };
    await app.store.importRom(new File([new Uint8Array(ROM_SIZE)], "test.rom"));
    app.store.stepFrame();
    const machine = app.store.machine();
    const ticks = app.store.status().ticks;
    app.store.run();
    const turbo = app.mounted.getByLabelText(/Turbo CPU/);
    expect(turbo).toBeEnabled();
    fireEvent.click(turbo);
    expect(app.store.turbo()).toBe(true);
    expect(app.store.isRunning()).toBe(true);
    fireEvent.click(turbo);
    expect(app.store.turbo()).toBe(false);
    expect(app.store.isRunning()).toBe(true);
    fireEvent.change(app.mounted.getByLabelText("Video preset"), {
      target: { value: "lviv" },
    });
    expect(app.store.machine()).toBe(machine);
    expect(app.store.isRunning()).toBe(true);
    expect(app.store.status().ticks).toBe(ticks);
    expect(app.store.status().height).toBe(312);
    expect(
      app.mounted.getByRole("img", { name: "ZX Spectrum full raster" }),
    ).toHaveAttribute("height", "312");
    app.store.pause();
    app.store.setVideoPreset("pentagon");
    expect(app.store.isRunning()).toBe(false);
    expect(app.store.status().height).toBe(320);
  });

  it("restores a persisted ROM paused on a fresh app start", async () => {
    const backend = new MemoryBackend({ persistent: true });
    const first = await mount(backend);
    expect(first.store.isRunning()).toBe(false);
    const bytes = new Uint8Array(ROM_SIZE).fill(0x42);
    await first.store.importRom(new File([bytes], "saved.rom"));
    first.store.coldBoot();
    expect(first.store.rom()?.bytes).toEqual(bytes);
    first.mounted.unmount();
    first.store.dispose();

    const fresh = await mount(backend);
    cleanup = () => {
      fresh.mounted.unmount();
      fresh.store.dispose();
    };
    expect(fresh.store.rom()?.name).toBe("saved.rom");
    expect(fresh.store.rom()?.bytes).toEqual(bytes);
    expect(fresh.store.machine()).not.toBeNull();
    expect(fresh.store.isRunning()).toBe(false);
    expect(fresh.mounted.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("renders stacked machine, video, keyboard, and settings sections", async () => {
    const mounted = await mount();
    cleanup = () => {
      mounted.mounted.unmount();
      mounted.store.dispose();
    };
    expect(mounted.mounted.getByText("Machine")).toBeInTheDocument();
    expect(mounted.mounted.getByText("Video")).toBeInTheDocument();
    expect(mounted.mounted.getByText("Keyboard")).toBeInTheDocument();
    expect(mounted.mounted.getByText("Settings")).toBeInTheDocument();
    expect(
      mounted.mounted.getByText("Hardware-like ZX Spectrum emulator"),
    ).toBeInTheDocument();
    expect(mounted.mounted.getByRole("option", { name: "Lviv" })).toBeEnabled();
  });

  it("rejects a ROM unless it is exactly 16 KiB", async () => {
    const mounted = await mount();
    cleanup = () => {
      mounted.mounted.unmount();
      mounted.store.dispose();
    };
    await mounted.store.importRom(new File([new Uint8Array(3)], "short.rom"));
    expect(mounted.store.rom()).toBeNull();
    expect(mounted.store.error()).toMatch(/exactly 16384 bytes/);
  });

  it("imports, persists, and steps a valid ROM without the old Todo UI", async () => {
    const backend = new MemoryBackend({ persistent: true });
    const mounted = await mount(backend);
    cleanup = () => {
      mounted.mounted.unmount();
      mounted.store.dispose();
    };
    await mounted.store.importRom(
      new File([new Uint8Array(ROM_SIZE)], "welcome.rom"),
    );
    expect(mounted.store.rom()?.name).toBe("welcome.rom");
    expect((await backend.loadRom())?.bytes.byteLength).toBe(ROM_SIZE);

    fireEvent.click(
      mounted.mounted.getByRole("button", { name: "Step frame" }),
    );
    expect(mounted.store.status().frames).toBe(1);
    expect(mounted.mounted.queryByText("Add Todo")).toBeNull();
  });

  it("keeps a ROM active while reporting a persistence failure", async () => {
    const mounted = await mount(
      new MemoryBackend({
        persistent: true,
        saveError: new Error("quota exceeded"),
      }),
    );
    cleanup = () => {
      mounted.mounted.unmount();
      mounted.store.dispose();
    };
    await mounted.store.importRom(
      new File([new Uint8Array(ROM_SIZE)], "session.rom"),
    );
    expect(mounted.store.rom()?.name).toBe("session.rom");
    expect(mounted.store.storage().state).toBe("error");
    expect(mounted.store.storage().message).toMatch(/session-only/);
  });
});
