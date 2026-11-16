import { readFileSync } from "node:fs";
import { fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { createMachine, type Machine } from "../../machine/machine";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop } from "../../test/fakes";
import { diskFixture } from "../../test/trd";
import { FilesSection } from "../files";
import { TrdosSection } from ".";

const file = (name: string, bytes: Uint8Array) =>
  ({
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer,
  }) as File;
const namedDisk = (name: string) => {
  const bytes = diskFixture();
  bytes.set(Array.from(name.padEnd(8).slice(0, 8), (c) => c.charCodeAt(0)));
  return bytes;
};
async function setup() {
  const store = await createAppStore({
    backend: new MemoryBackend({
      initial: {
        name: "48.rom",
        bytes: new Uint8Array(readFileSync("public/roms/48.rom")),
      },
    }),
    machineFactory: createMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  const view = render(() => (
    <StoreProvider value={store}>
      <FilesSection />
      <TrdosSection />
    </StoreProvider>
  ));
  return { store, view, machine: store.machine() as Machine };
}

it("mounts each Files row into the requested drive without resetting or running", async () => {
  const { store, view, machine } = await setup();
  try {
    await store.importFiles([
      file("alpha.trd", namedDisk("alpha")),
      file("bravo.trd", namedDisk("bravo")),
    ]);
    const a = within(view.getByRole("region", { name: "Drive A" }));
    const b = within(view.getByRole("region", { name: "Drive B" }));
    expect(a.getByText(/No disk mounted/)).toBeInTheDocument();
    expect(b.getByText(/No disk mounted/)).toBeInTheDocument();
    machine.advancePixels(10000);
    const pc = machine.cpu.regs.pc;
    const alpha = view
      .getByText("alpha.trd")
      .closest(".file-row") as HTMLElement;
    const bravo = view
      .getByText("bravo.trd")
      .closest(".file-row") as HTMLElement;
    fireEvent.click(within(alpha).getByRole("button", { name: "Mount A" }));
    await waitFor(() => expect(a.getByText("alpha.B")).toBeInTheDocument());
    fireEvent.click(within(bravo).getByRole("button", { name: "Mount B" }));
    await waitFor(() => expect(b.getByText("bravo.B")).toBeInTheDocument());
    expect(machine.cpu.regs.pc).toBe(pc);
    expect(store.isRunning()).toBe(false);
    expect(store.disks()?.[0].name).toBe("alpha.trd");
    expect(store.disks()?.[1].name).toBe("bravo.trd");
    const run = vi.spyOn(store, "runDisk").mockResolvedValue();
    fireEvent.click(b.getByRole("button", { name: "Run" }));
    expect(run).toHaveBeenCalledWith(0, 1);
    run.mockRestore();
    fireEvent.click(a.getByRole("button", { name: "Eject" }));
    await waitFor(() =>
      expect(a.getByText(/No disk mounted/)).toBeInTheDocument(),
    );
    expect(b.getByText("bravo.B")).toBeInTheDocument();
    expect(store.files()).toHaveLength(2);
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("expands TR-DOS when a disk is mounted into drive B", async () => {
  const { store, view } = await setup();
  try {
    await store.importFiles([file("bravo.trd", namedDisk("bravo"))]);
    fireEvent.click(view.getByRole("button", { name: "Collapse TR-DOS" }));
    expect(view.queryByRole("region", { name: "Drive B" })).toBeNull();
    await store.mountDiskFile(store.files()[0].id, 1);
    expect(view.getByRole("region", { name: "Drive B" })).toBeInTheDocument();
    expect(
      view.getByRole("button", { name: "Collapse TR-DOS" }),
    ).toHaveAttribute("aria-expanded", "true");
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("identifies drive B in the modified-disk decision and leaves drive A alone", async () => {
  const { store, view, machine } = await setup();
  try {
    await store.importFiles([
      file("alpha.trd", namedDisk("alpha")),
      file("bravo.trd", namedDisk("bravo")),
    ]);
    const alpha = store.files().find((entry) => entry.name === "alpha.trd");
    const bravo = store.files().find((entry) => entry.name === "bravo.trd");
    if (!alpha || !bravo) throw new Error("Fixture missing");
    await store.mountDiskFile(alpha.id, 0);
    await store.mountDiskFile(bravo.id, 1);
    const a = within(view.getByRole("region", { name: "Drive A" }));
    const b = within(view.getByRole("region", { name: "Drive B" }));
    machine.disk.setDirty(1, true);
    store.refresh();
    expect(b.getByText(/Modified/)).toBeInTheDocument();
    fireEvent.click(b.getByRole("button", { name: "Eject" }));
    await waitFor(() =>
      expect(view.getByRole("dialog")).toHaveTextContent("Drive B has changes"),
    );
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(store.filesBusy()).toBe(false));
    expect(b.getByText("bravo.B")).toBeInTheDocument();
    fireEvent.click(b.getByRole("button", { name: "Eject" }));
    await waitFor(() => expect(view.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(b.getByText(/No disk mounted/)).toBeInTheDocument(),
    );
    expect(a.getByText("alpha.B")).toBeInTheDocument();
  } finally {
    view.unmount();
    store.dispose();
  }
});
