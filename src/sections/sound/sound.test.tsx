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
