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
    const a = within(view.getByRole("group", { name: "Drive A" }));
    const b = within(view.getByRole("group", { name: "Drive B" }));
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

it("keeps TR-DOS folded when a disk is mounted into drive B, with its header available", async () => {
  const { store, view } = await setup();
  try {
    await store.importFiles([
      file("bravo.trd", namedDisk("bravo")),
      file("other.trd", namedDisk("other")),
    ]);
    fireEvent.click(view.getByRole("button", { name: "Collapse TR-DOS" }));
    expect(view.queryByRole("group", { name: "Drive B" })).toBeNull();
    const bravo = store.files().find((entry) => entry.name === "bravo.trd");
    if (!bravo) throw new Error("Fixture missing");
    await store.mountDiskFile(bravo.id, 1);
    expect(view.queryByRole("group", { name: "Drive B" })).toBeNull();
    expect(view.getByText("B: bravo.trd")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Run drive B" })).toBeEnabled();
    expect(view.getByRole("button", { name: "Expand TR-DOS" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("keeps TR-DOS folded through single-disk autoload and either drive's header Run", async () => {
  const { store, view, machine } = await setup();
  try {
    store.set48kMode(true);
    store.setReset(true);
    store.setReset(false);
    fireEvent.click(view.getByRole("button", { name: "Collapse TR-DOS" }));
    await store.importFiles([file("autoload.trd", diskFixture())]);
    expect(store.error()).toBeNull();
    expect(store.isRunning()).toBe(true);
    expect(view.getByText("A: autoload.trd")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Expand TR-DOS" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    machine.mountDisk(namedDisk("bravo"), "b", "bravo.trd", false, false, 1);
    store.refresh();
    const run = vi.spyOn(machine, "runDisk");
    for (const drive of [0, 1] as const) {
      fireEvent.click(
        view.getByRole("button", {
          name: `Run drive ${drive === 0 ? "A" : "B"}`,
        }),
      );
      await waitFor(() => expect(store.filesBusy()).toBe(false));
      expect(run).toHaveBeenLastCalledWith(0, drive);
      expect(store.error()).toBeNull();
      expect(store.isRunning()).toBe(true);
      expect(
        view.getByRole("button", { name: "Expand TR-DOS" }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(view.queryByRole("group", { name: "Drive A" })).toBeNull();
      expect(view.queryByRole("group", { name: "Drive B" })).toBeNull();
    }
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("opens a folded TR-DOS section when modified media needs a decision", async () => {
  const { store, view, machine } = await setup();
  try {
    machine.mountDisk(diskFixture(), "b", "bravo.trd", false, false, 1);
    machine.disk.setDirty(1, true);
    store.refresh();
    fireEvent.click(view.getByRole("button", { name: "Collapse TR-DOS" }));
    const eject = store.ejectDisk(1);
    await waitFor(() =>
      expect(view.getByRole("dialog")).toHaveTextContent("Drive B has changes"),
    );
    expect(
      view.getByRole("button", { name: "Collapse TR-DOS" }),
    ).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    await eject;
    expect(store.disks()?.[1].id).toBe("b");
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
    const a = within(view.getByRole("group", { name: "Drive A" }));
    const b = within(view.getByRole("group", { name: "Drive B" }));
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

it("keeps each mounted name and preferred BASIC Run available while folded", async () => {
  const { store, view, machine } = await setup();
  try {
    const a = namedDisk("helper");
    a.set(a.slice(0, 16), 16);
    a.set(
      Array.from("BOOT    ", (char) => char.charCodeAt(0)),
      16,
    );
    machine.mountDisk(a, "a", "alpha.trd", false, false, 0);
    machine.mountDisk(namedDisk("bravo"), "b", "bravo.trd", false, false, 1);
    store.refresh();
    const driveA = view.getByRole("group", { name: "Drive A" });
    expect(driveA.tagName).toBe("FIELDSET");
    expect(driveA).toHaveClass("rom-slot");
    const rom = view
      .getByRole("heading", { name: "TR-DOS ROM" })
      .closest(".rom-controls");
    if (!rom) throw new Error("Expected TR-DOS ROM controls");
    expect(
      driveA.compareDocumentPosition(rom) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(rom.querySelector('[role="status"]')).toHaveClass("rom-status");
    const runDisk = vi.spyOn(store, "runDisk").mockResolvedValue();
    fireEvent.click(view.getByRole("button", { name: "Collapse TR-DOS" }));
    expect(view.queryByRole("group", { name: "Drive A" })).toBeNull();
    expect(view.getByText("A: alpha.trd")).toBeInTheDocument();
    expect(view.getByText("B: bravo.trd")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Run drive A" }));
    expect(runDisk).toHaveBeenLastCalledWith(1, 0);
    fireEvent.click(view.getByRole("button", { name: "Run drive B" }));
    expect(runDisk).toHaveBeenLastCalledWith(0, 1);

    a.set(
      Array.from("second  ", (char) => char.charCodeAt(0)),
      16,
    );
    machine.mountDisk(a, "ambiguous", "ambiguous.trd", false, false, 0);
    store.refresh();
    expect(view.queryByRole("button", { name: "Run drive A" })).toBeNull();
    expect(view.getByRole("button", { name: "Run drive B" })).toBeEnabled();
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("applies the catalog's warning and DOS-ROM eligibility to header Run", async () => {
  const { store, view, machine } = await setup();
  try {
    const damaged = diskFixture();
    damaged[9] = damaged[10] = 255;
    machine.mountDisk(damaged, "bad", "damaged.trd", false);
    store.refresh();
    const headerRun = view.getByRole("button", { name: "Run drive A" });
    const rowRun = within(
      view.getByRole("group", { name: "Drive A" }),
    ).getByRole("button", { name: "Run" });
    expect(headerRun).toBeDisabled();
    expect(rowRun).toBeDisabled();
    expect(headerRun).toHaveAttribute(
      "title",
      store.disks()?.[0].catalog[0].warning,
    );
    await store.importDosRom(file("trdos.rom", new Uint8Array(16384)));
    expect(headerRun).toBeEnabled();
    expect(rowRun).toBeEnabled();
  } finally {
    view.unmount();
    store.dispose();
  }
});
