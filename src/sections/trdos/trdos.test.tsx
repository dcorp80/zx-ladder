import { readFileSync } from "node:fs";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { createMachine, type Machine } from "../../machine/machine";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop } from "../../test/fakes";
import { sclFixture } from "../../test/scl";
import { diskFixture } from "../../test/trd";
import { TrdosSection } from ".";

const file = (name: string, bytes: Uint8Array) =>
  ({
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer,
  }) as File;
it("shows catalog, protects dirty deletion, retains media on cold boot and persists independent ROM", async () => {
  const backend = new MemoryBackend({
    persistent: true,
    initial: {
      name: "48.rom",
      bytes: new Uint8Array(readFileSync("public/roms/48.rom")),
    },
  });
  const store = await createAppStore({
    backend,
    machineFactory: createMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  const mounted = render(() => (
    <StoreProvider value={store}>
      <TrdosSection />
    </StoreProvider>
  ));
  try {
    await store.importFiles([file("test.trd", diskFixture())]);
    const id = store.files()[0].id;
    await store.loadFile(id);
    expect(mounted.getByText("boot.B")).toBeInTheDocument();
    const machine = store.machine() as Machine;
    machine.disk.image[5000] = 77;
    machine.disk.changed();
    store.refresh();
    const deleting = store.deleteFile(id);
    await waitFor(() =>
      expect(mounted.getByRole("dialog")).toBeInTheDocument(),
    );
    fireEvent.click(mounted.getByRole("button", { name: "Cancel" }));
    await deleting;
    expect(store.disk()?.id).toBe(id);
    expect(store.files()).toHaveLength(1);
    store.coldBoot();
    await waitFor(() => expect(store.machine()).not.toBe(machine));
    await waitFor(() => expect(store.disk()?.id).toBe(id));
    expect((store.machine() as Machine).disk.image[5000]).toBe(77);
    expect(store.disk()?.dirty).toBe(true);
    const removing = store.deleteFile(id);
    await waitFor(() => expect(store.diskChangePending()).toBe(true));
    store.resolveDiskChange("discard");
    await removing;
    expect(store.files()).toHaveLength(0);
    expect(store.disk()?.id).toBe("");
    await store.importDosRom(file("trdos.rom", new Uint8Array(16384)));
    expect((await backend.loadRom())?.name).toBe("48.rom");
    expect((await backend.loadRom("trdos"))?.name).toBe("trdos.rom");
    const restored = await createAppStore({
      backend,
      machineFactory: createMachine,
      hostLoopFactory: () => makeFakeLoop(),
    });
    expect(restored.dosRom()?.name).toBe("trdos.rom");
    restored.dispose();
    const active = store.machine() as Machine;
    active.mountDisk(diskFixture(), "retained", "retained.trd", false);
    active.disk.image[5000] = 93;
    active.disk.changed();
    active.disk.dosEnabled = true;
    active.memory.dosRom = active.disk.rom;
    store.refresh();
    fireEvent.click(mounted.getByRole("button", { name: "Remove ROM" }));
    await waitFor(() => expect(store.dosRom()).toBeNull());
    expect(
      mounted.queryByRole("button", { name: "Remove ROM" }),
    ).not.toBeInTheDocument();
    expect(await backend.loadRom("trdos")).toBeNull();
    expect((await backend.loadRom())?.name).toBe("48.rom");
    expect(active.disk.rom).toBeUndefined();
    expect(active.memory.dosRom).toBeUndefined();
    expect(active.disk.image[5000]).toBe(93);
    expect(active.disk.dirty).toBe(true);
    const withoutDos = await createAppStore({
      backend,
      machineFactory: createMachine,
      hostLoopFactory: () => makeFakeLoop(),
    });
    expect(withoutDos.dosRom()).toBeNull();
    withoutDos.dispose();
  } finally {
    mounted.unmount();
    store.dispose();
  }
});
it("reports ROM-required stops through the store and makes Run/Step explain the blocked state", async () => {
  const rom = new Uint8Array(16384);
  rom.set([0xc3, 0, 0x3d]);
  const store = await createAppStore({
    backend: new MemoryBackend({ initial: { name: "test.rom", bytes: rom } }),
    machineFactory: createMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  const mounted = render(() => (
    <StoreProvider value={store}>
      <TrdosSection />
    </StoreProvider>
  ));
  try {
    store.stepFrame();
    expect(store.disk()?.romRequired).toBe(true);
    expect(store.error()).toBe("You need to provide TR-DOS ROM");
    expect(mounted.getByRole("alert")).toHaveTextContent(
      "You need to provide TR-DOS ROM",
    );
    const position = store.machine()?.framePosition;
    store.clearError();
    store.run();
    expect(store.error()).toBe("You need to provide TR-DOS ROM");
    expect(store.isRunning()).toBe(false);
    store.clearError();
    store.stepFrame();
    expect(store.error()).toBe("You need to provide TR-DOS ROM");
    expect(store.machine()?.framePosition).toBe(position);
    store.setReset(true);
    store.setReset(false);
    expect(store.disk()?.romRequired).toBe(false);
    expect(store.error()).toBeNull();
  } finally {
    mounted.unmount();
    store.dispose();
  }
});

it("loads an SCL as writable TRD and downloads TRD without modifying its library original", async () => {
  const backend = new MemoryBackend({
    initial: {
      name: "48.rom",
      bytes: new Uint8Array(readFileSync("public/roms/48.rom")),
    },
  });
  const store = await createAppStore({
    backend,
    machineFactory: createMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  const original = sclFixture();
  let downloaded = "",
    downloadSize = 0;
  const NativeURL = URL;
  try {
    await store.importFiles([file("original.scl", original)]);
    const id = store.files()[0].id;
    await store.loadFile(id);
    const m = store.machine() as Machine;
    expect(store.error()).toBeNull();
    expect(store.disk()?.catalog[0].name).toBe("boot");
    expect(m.disk.image.length).toBe(655360);
    expect(store.disk()?.id).toBe(id);
    m.disk.image[4096] = 99;
    m.disk.changed();
    store.refresh();
    vi.useFakeTimers();
    vi.stubGlobal(
      "URL",
      class extends NativeURL {
        static createObjectURL(blob: Blob) {
          downloadSize = blob.size;
          return "blob:scl-export";
        }
        static revokeObjectURL() {}
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded = this.download;
    });
    await store.downloadDisk();
    vi.runOnlyPendingTimers();
    expect(downloaded).toBe("original-modified.trd");
    expect(downloadSize).toBe(655360);
    expect((await backend.getFile(id))?.bytes).toEqual(original);
    expect(store.disk()?.dirty).toBe(false);
    await store.deleteFile(id);
    expect(store.disk()?.id).toBe("");
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    store.dispose();
  }
});
