import { fireEvent, render } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { loadConfig, sanitizeConfig } from "../../storage/config";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { SoundSection } from "./index";

it("persists AY routing and mix independently of beeper enable", async () => {
  const store = await createAppStore({ backend: new MemoryBackend() });
  const view = render(() => (
    <StoreProvider value={store}>
      <SoundSection />
    </StoreProvider>
  ));
  try {
    fireEvent.click(view.getByRole("checkbox", { name: "Beeper" }));
    expect(store.soundEnabled()).toBe(false);
    expect(store.ayEnabled()).toBe(true);
    fireEvent.click(view.getByRole("radio", { name: "ACB" }));
    fireEvent.input(view.getByRole("slider", { name: /AY volume/ }), {
      target: { value: "0.37" },
    });
    fireEvent.input(view.getByRole("slider", { name: /Middle channel/ }), {
      target: { value: "0.72" },
    });
    expect(loadConfig()).toMatchObject({
      ayStereo: "ACB",
      ayVolume: 0.37,
      ayMiddle: 0.72,
      soundEnabled: false,
    });
    fireEvent.click(view.getByRole("radio", { name: "Mono" }));
    expect(view.getByRole("slider", { name: /Middle channel/ })).toBeDisabled();
  } finally {
    view.unmount();
    store.dispose();
  }
});
it("migrates and sanitizes AY preferences", () => {
  expect(sanitizeConfig({ version: 1 })).toMatchObject({
    ayEnabled: true,
    ayVolume: 0.2,
    ayStereo: "ABC",
    ayMiddle: 0.5,
  });
  expect(
    sanitizeConfig({ version: 1, ayStereo: "bad", ayVolume: NaN, ayMiddle: 9 }),
  ).toMatchObject({ ayStereo: "ABC", ayVolume: 0.2, ayMiddle: 1 });
});

it("keeps master output controls available while folded and restores them without changing source settings", async () => {
  const backend = new MemoryBackend();
  const store = await createAppStore({ backend });
  store.setSoundEnabled(false);
  store.setVolume(0.17);
  store.setAyVolume(0.36);
  const view = render(() => (
    <StoreProvider value={store}>
      <SoundSection />
    </StoreProvider>
  ));
  try {
    const mute = view.getByRole("checkbox", { name: "Mute" });
    const master = view.getByRole("slider", { name: /Master volume/ });
    expect(mute).not.toBeChecked();
    expect(master).toHaveValue("1");
    fireEvent.click(view.getByRole("button", { name: "Collapse Sound" }));
    expect(view.queryByRole("checkbox", { name: "Beeper" })).toBeNull();
    expect(view.getByRole("checkbox", { name: "Mute" })).toBe(mute);
    expect(view.getByRole("slider", { name: /Master volume/ })).toBe(master);
    fireEvent.click(mute);
    fireEvent.input(master, { target: { value: "0.64" } });
    expect(master).toHaveAccessibleName("Master volume 64%");
    expect(view.getByText("Volume 64%")).toBeInTheDocument();
    expect(loadConfig()).toMatchObject({
      muted: true,
      masterVolume: 0.64,
      soundEnabled: false,
      volume: 0.17,
      ayEnabled: true,
      ayVolume: 0.36,
    });
    fireEvent.click(mute);
    expect(store.muted()).toBe(false);
    expect(store.masterVolume()).toBe(0.64);
    expect(store.soundEnabled()).toBe(false);
    expect(store.ayEnabled()).toBe(true);
    fireEvent.click(mute);
  } finally {
    view.unmount();
    store.dispose();
  }
  const restored = await createAppStore({ backend });
  const freshView = render(() => (
    <StoreProvider value={restored}>
      <SoundSection />
    </StoreProvider>
  ));
  try {
    expect(freshView.getByRole("checkbox", { name: "Mute" })).toBeChecked();
    expect(
      freshView.getByRole("slider", { name: "Master volume 64%" }),
    ).toHaveValue("0.64");
    expect(freshView.queryByRole("checkbox", { name: "Beeper" })).toBeNull();
    expect(restored.soundEnabled()).toBe(false);
    expect(restored.ayEnabled()).toBe(true);
  } finally {
    freshView.unmount();
    restored.dispose();
  }
});

it("reports enabled sources in the subtitle independently of master mute and 48K mode", async () => {
  const store = await createAppStore({ backend: new MemoryBackend() });
  store.set48kMode(true);
  const view = render(() => (
    <StoreProvider value={store}>
      <SoundSection />
    </StoreProvider>
  ));
  try {
    const subtitle = view.container.querySelector(".section-subtitle");
    if (!subtitle) throw new Error("Expected Sound subtitle");
    const beeper = view.getByRole("checkbox", { name: "Beeper" });
    const ay = view.getByRole("checkbox", { name: "AY enabled" });
    expect(ay).toBeEnabled();
    expect(subtitle).toHaveTextContent(/^Beeper · AY$/);
    fireEvent.click(view.getByRole("checkbox", { name: "Mute" }));
    expect(subtitle).toHaveTextContent(/^Beeper · AY$/);
    expect(beeper).toBeChecked();
    expect(ay).toBeChecked();
    fireEvent.click(beeper);
    expect(subtitle).toHaveTextContent(/^AY$/);
    fireEvent.click(ay);
    expect(subtitle).toHaveTextContent(/^No sources$/);
    fireEvent.click(beeper);
    expect(subtitle).toHaveTextContent(/^Beeper$/);
    fireEvent.click(ay);
    expect(subtitle).toHaveTextContent(/^Beeper · AY$/);
    expect(
      view.getByText(/AY works in both 48K and 128K modes/),
    ).toBeInTheDocument();
  } finally {
    view.unmount();
    store.dispose();
  }
});
