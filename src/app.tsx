import { type Component, onCleanup, onMount, Show } from "solid-js";
import { attachKeyboardInput } from "./input/keyboardInput";
import { keyboardLayout } from "./input/keyboardLayout";
import { rasterTiming } from "./machine/config";
import { AppShell } from "./sections/appShell";
import { FilesSection } from "./sections/files";
import { KeyboardSection } from "./sections/keyboard";
import { MachineSection } from "./sections/machine";
import { SettingsSection } from "./sections/settings";
import { SoundSection } from "./sections/sound";
import { VideoSection } from "./sections/video";
import { useStore } from "./store";

export const App: Component = () => {
  const store = useStore();
  onMount(() => {
    const unlock = () => store.unlockAudio();
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    });
    let depth = 0;
    const isFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const enter = (event: DragEvent) => {
      if (isFiles(event)) {
        event.preventDefault();
        depth++;
        document.body.classList.add("file-dragging");
      }
    };
    const over = (event: DragEvent) => {
      if (isFiles(event)) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }
    };
    const leave = () => {
      if (--depth <= 0) {
        depth = 0;
        document.body.classList.remove("file-dragging");
      }
    };
    const drop = (event: DragEvent) => {
      if (!isFiles(event)) return;
      event.preventDefault();
      depth = 0;
      document.body.classList.remove("file-dragging");
      void store.importFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    onCleanup(() => {
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
      document.body.classList.remove("file-dragging");
    });
    const detach = attachKeyboardInput(
      () => store.machine()?.keyboard,
      document,
      () => keyboardLayout(store.keyboardLayout()).id,
    );
    onCleanup(detach);
  });
  return (
    <main class="app">
      <div class="file-drop-overlay" aria-hidden="true">
        Drop TAP, TZX or ZIP files to add to Files
      </div>
      <AppShell />
      <Show when={store.error()}>
        {(message) => (
          <div class="error-banner" role="alert">
            <span>{message()}</span>
            <button
              type="button"
              class="error-dismiss"
              onClick={() => store.clearError()}
            >
              Dismiss
            </button>
          </div>
        )}
      </Show>
      <div class="section-column">
        <MachineSection />
        <VideoSection />
        <SoundSection />
        <KeyboardSection />
        <FilesSection />
        <SettingsSection />
      </div>
      <footer class="app-footer">
        <span>
          48K RAM · no contention · {store.videoPreset().label} video ·{" "}
          {rasterTiming(store.videoPreset()).frameHz.toFixed(3)} Hz derived
          raster
        </span>
        <span>ROM I/O and timing are emulated in the machine core.</span>
      </footer>
    </main>
  );
};
