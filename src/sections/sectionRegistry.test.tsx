import { render } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { App } from "../app";
import { MemoryBackend } from "../storage/memory";
import { createAppStore, StoreProvider } from "../store";
import { makeFakeLoop, makeFakeMachine } from "../test/fakes";
import { defaultSectionIds } from "./sectionRegistry";

it("places mounted media before Files and keeps Settings last in the app and registry", async () => {
  const store = await createAppStore({
    backend: new MemoryBackend(),
    machineFactory: () => makeFakeMachine(),
    hostLoopFactory: () => makeFakeLoop(),
  });
  const view = render(() => (
    <StoreProvider value={store}>
      <App />
    </StoreProvider>
  ));
  try {
    expect(
      view
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Machine",
      "Video",
      "Keyboard",
      "Sound",
      "Tape",
      "TR-DOS",
      "Files",
      "Kempston",
      "Settings",
    ]);
    expect(defaultSectionIds()).toEqual([
      "machine",
      "video",
      "keyboard",
      "sound",
      "tape",
      "trdos",
      "files",
      "kempston",
      "settings",
    ]);
  } finally {
    view.unmount();
    store.dispose();
  }
});
