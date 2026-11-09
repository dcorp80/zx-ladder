import { fireEvent, render } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { App } from "../../app";
import { CONFIG_KEY } from "../../storage/config";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";
import { KempstonSection } from "./index";

it("places Sound after Keyboard and Kempston last, restores Cursor and persists only preferences", async () => {
  const store = await createAppStore({
    backend: new MemoryBackend(),
    loadBundledRom: async () => ({
      name: "test",
      bytes: new Uint8Array(16384),
      updatedAt: 0,
    }),
    machineFactory: makeFakeMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  const mounted = render(() => (
    <StoreProvider value={store}>
      <App />
    </StoreProvider>
  ));
  try {
    expect(
      mounted.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      "Machine",
      "Video",
      "Keyboard",
      "Sound",
      "Files",
      "TR-DOS",
      "Settings",
      "Kempston",
    ]);
    expect(mounted.queryByLabelText("Enable gamepad")).toBeNull();
    expect(mounted.queryByLabelText("Gamepad", { exact: true })).toBeNull();
    fireEvent.click(mounted.getByRole("radio", { name: "Kempston" }));
    expect(mounted.getByText("Kempston source: Keyboard")).toBeInTheDocument();
    fireEvent.change(mounted.getByLabelText("Keyboard fire key"), {
      target: { value: "Enter" },
    });
    fireEvent.click(mounted.getByLabelText("Swap left/right buttons"));
    const config = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}");
    expect(config.kempston.fireKey).toBe("Enter");
    expect(config.kempston.swapButtons).toBe(true);
    expect(config.kempston.mode).toBeUndefined();
    store.setReset(true);
    expect(mounted.getByRole("radio", { name: "Cursor" })).toBeChecked();
    store.setReset(false);
    store.kempston.setMode("Sinclair I");
    store.coldBoot();
    expect(store.kempston.mode()).toBe("Cursor");
  } finally {
    mounted.unmount();
    store.dispose();
  }
});
it("shows a selector only for multiple connected pads and offers explicit return from keyboard takeover", async () => {
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    callback = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let pads = [
    { index: 0, id: "Pad A", connected: true, axes: [0, 0], buttons: [] },
    { index: 1, id: "Pad B", connected: true, axes: [0, 0], buttons: [] },
  ];
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => pads,
  });
  const store = await createAppStore({
    backend: new MemoryBackend(),
    machineFactory: makeFakeMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  const detach = store.kempston.attach();
  const mounted = render(() => (
    <StoreProvider value={store}>
      <KempstonSection />
    </StoreProvider>
  ));
  try {
    callback(0);
    expect(mounted.getByLabelText("Enable gamepad")).toBeChecked();
    fireEvent.change(mounted.getByLabelText("Gamepad", { exact: true }), {
      target: { value: "1" },
    });
    expect(store.kempston.selected()).toBe(1);
    store.kempston.setMode("Kempston");
    fireEvent.click(mounted.getByRole("button", { name: "Use gamepad" }));
    expect(store.kempston.mode()).toBe("Cursor");
    pads = pads.slice(0, 1);
    callback(1);
    expect(mounted.queryByLabelText("Gamepad", { exact: true })).toBeNull();
    expect(mounted.getByText("Pad A")).toBeInTheDocument();
    pads = [];
    callback(2);
    expect(mounted.queryByLabelText("Enable gamepad")).toBeNull();
  } finally {
    mounted.unmount();
    detach();
    store.dispose();
    Reflect.deleteProperty(navigator, "getGamepads");
    vi.unstubAllGlobals();
  }
});
