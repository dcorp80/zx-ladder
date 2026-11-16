import { fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { MemoryBackend } from "../../storage/memory";
import {
  type CreateStoreDeps,
  createAppStore,
  StoreProvider,
} from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";
import { RomControls } from "./romControls";

const pair = (first: number, second: number) => {
  const bytes = new Uint8Array(32768).fill(first);
  bytes.fill(second, 16384);
  return bytes;
};
async function setup(loadBundledRom?: CreateStoreDeps["loadBundledRom"]) {
  const store = await createAppStore({
    loadBundledRom,
    backend: new MemoryBackend({
      initial: { name: "128.rom", bytes: pair(1, 2) },
    }),
    machineFactory: () => makeFakeMachine(),
    hostLoopFactory: () => makeFakeLoop(),
  });
  const view = render(() => (
    <StoreProvider value={store}>
      <RomControls />
    </StoreProvider>
  ));
  return { store, view };
}

it("shows separate ROM slots and applies each slot's upload rules", async () => {
  const { store, view } = await setup();
  try {
    const rom0 = within(view.getByRole("group", { name: "ROM0" }));
    const rom1 = within(view.getByRole("group", { name: "ROM1" }));
    expect(rom0.getByText("128.rom (1/2)")).toBeInTheDocument();
    expect(rom1.getByText("128.rom (2/2)")).toBeInTheDocument();
    expect(view.queryByRole("combobox")).toBeNull();
    store.set48kMode(true);
    store.run();

    fireEvent.change(view.getByLabelText("Choose ROM1 file"), {
      target: { files: [new File([pair(7, 8)], "alternate.rom")] },
    });
    await waitFor(() => expect(store.rom()?.bytes[16384]).toBe(7));
    expect(store.rom()?.bytes[0]).toBe(1);
    expect(rom0.getByText("128.rom (1/2)")).toBeInTheDocument();
    expect(rom1.getByText(/alternate\.rom/)).toBeInTheDocument();
    expect(store.mode48k()).toBe(true);
    expect(store.isRunning()).toBe(true);

    await waitFor(() => expect(store.filesBusy()).toBe(false));
    fireEvent.change(view.getByLabelText("Choose ROM0 file"), {
      target: {
        files: [new File([new Uint8Array(16384).fill(9)], "editor.rom")],
      },
    });
    await waitFor(() =>
      expect(rom0.getByText("editor.rom")).toBeInTheDocument(),
    );
    expect(store.rom()?.bytes[0]).toBe(9);
    expect(store.rom()?.bytes[16384]).toBe(7);

    await waitFor(() => expect(store.filesBusy()).toBe(false));
    fireEvent.change(view.getByLabelText("Choose ROM0 file"), {
      target: { files: [new File([pair(3, 4)], "replacement.rom")] },
    });
    await waitFor(() =>
      expect(rom1.getByText("replacement.rom (2/2)")).toBeInTheDocument(),
    );
    expect(rom0.getByText("replacement.rom (1/2)")).toBeInTheDocument();
    expect(store.rom()?.bytes[0]).toBe(3);
    expect(store.rom()?.bytes[16384]).toBe(4);
    expect(store.mode48k()).toBe(true);
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("replaces bundled pages independently and disables ROM changes while busy", async () => {
  let finishDownload!: (record: { name: string; bytes: Uint8Array }) => void;
  const pendingDownload = new Promise<{ name: string; bytes: Uint8Array }>(
    (resolve) => {
      finishDownload = resolve;
    },
  );
  const bundled = vi.fn<NonNullable<CreateStoreDeps["loadBundledRom"]>>(
    async () => ({ name: "128.rom", bytes: pair(5, 6) }),
  );
  bundled.mockReturnValueOnce(pendingDownload);
  const { store, view } = await setup(bundled);
  try {
    store.set48kMode(true);
    fireEvent.click(view.getByRole("button", { name: "Use bundled 48K ROM" }));
    expect(bundled).toHaveBeenLastCalledWith("48.rom");
    expect(store.filesBusy()).toBe(true);
    expect(view.getByLabelText("Choose ROM0 file")).toBeDisabled();
    expect(view.getByLabelText("Choose ROM1 file")).toBeDisabled();
    expect(
      view.getByRole("button", { name: "Use bundled 128K ROM" }),
    ).toBeDisabled();
    expect(
      view.getByRole("button", { name: "Use bundled 48K ROM" }),
    ).toBeDisabled();
    finishDownload({ name: "48.rom", bytes: new Uint8Array(16384).fill(48) });
    await waitFor(() => expect(store.filesBusy()).toBe(false));
    expect(store.rom()?.pageNames).toEqual(["128.rom (1/2)", "48.rom"]);
    expect(store.rom()?.bytes[0]).toBe(1);
    expect(store.rom()?.bytes[16384]).toBe(48);
    expect(store.mode48k()).toBe(true);
    expect(store.isRunning()).toBe(false);

    fireEvent.click(view.getByRole("button", { name: "Use bundled 128K ROM" }));
    await waitFor(() => expect(store.filesBusy()).toBe(false));
    expect(bundled).toHaveBeenLastCalledWith("128.rom");
    expect(store.rom()?.pageNames).toEqual(["128.rom (1/2)", "128.rom (2/2)"]);
    expect(store.rom()?.bytes[0]).toBe(5);
    expect(store.rom()?.bytes[16384]).toBe(6);
    expect(store.mode48k()).toBe(true);
    expect(store.isRunning()).toBe(false);
  } finally {
    finishDownload({ name: "48.rom", bytes: new Uint8Array(16384) });
    await waitFor(() => expect(store.filesBusy()).toBe(false));
    view.unmount();
    store.dispose();
  }
});
