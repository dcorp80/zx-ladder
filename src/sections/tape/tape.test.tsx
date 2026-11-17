import { readFileSync } from "node:fs";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { fileId } from "../../files/library";
import { createMachine, type Machine } from "../../machine/machine";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop } from "../../test/fakes";
import { asTzx, basicTapFixture } from "../../test/tape";
import { FilesSection } from "../files";
import { TapeSection } from ".";

async function setup(
  files: readonly { name: string; bytes: Uint8Array }[] = [],
) {
  const backend = new MemoryBackend({
    initial: {
      name: "48.rom",
      bytes: new Uint8Array(readFileSync("public/roms/48.rom")),
    },
  });
  await backend.putFiles(
    files.map(({ name, bytes }) => ({
      id: fileId(null, name),
      name,
      bytes,
      group: null,
      size: bytes.length,
      updatedAt: 0,
      warning: "",
    })),
  );
  const store = await createAppStore({
    backend,
    machineFactory: createMachine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  store.set48kMode(true);
  store.setReset(true);
  store.setReset(false);
  const view = render(() => (
    <StoreProvider value={store}>
      <FilesSection />
      <TapeSection />
    </StoreProvider>
  ));
  return { store, view, backend, machine: store.machine() as Machine };
}

it("mounts without reset, run or expansion, then supports manual catalog controls", async () => {
  const { store, view, machine } = await setup([
    { name: "manual.tzx", bytes: asTzx(basicTapFixture()) },
  ]);
  try {
    expect(view.getByText(/No tape mounted/)).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Collapse Tape" }));
    machine.advancePixels(10000);
    machine.memory.write(0xa000, 77);
    const pc = machine.cpu.regs.pc;
    fireEvent.click(view.getByRole("button", { name: "Mount" }));
    await waitFor(() => expect(store.tape()?.name).toBe("manual.tzx"));
    expect(view.getByRole("button", { name: "Expand Tape" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(store.isRunning()).toBe(false);
    expect(machine.cpu.regs.pc).toBe(pc);
    expect(machine.memory.read(0xa000)).toBe(77);
    fireEvent.click(view.getByRole("button", { name: "Expand Tape" }));
    expect(view.getByText("boot")).toBeInTheDocument();
    expect(view.getByText(/Program header/)).toBeInTheDocument();
    expect(view.getByText(/Next block: 1 of 2/)).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Select block 2" }));
    await waitFor(() => expect(store.tape()?.cursor).toBe(1));
    expect(
      view.getByRole("button", { name: "Select block 2" }).closest("tr"),
    ).toHaveAttribute("aria-current", "step");
    fireEvent.click(view.getByRole("button", { name: "Rewind" }));
    await waitFor(() => expect(store.tape()?.cursor).toBe(0));
    fireEvent.click(view.getByRole("button", { name: "Eject" }));
    await waitFor(() =>
      expect(view.getByText(/No tape mounted/)).toBeInTheDocument(),
    );
    expect(store.files()).toHaveLength(1);
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("keeps Load autoloading and the mounted copy independent of library replacement/deletion", async () => {
  const { store, view, machine, backend } = await setup([
    { name: "demo.tap", bytes: basicTapFixture() },
  ]);
  try {
    const id = store.files()[0].id;
    await store.loadFile(id);
    expect(store.isRunning()).toBe(true);
    expect(store.tape()?.name).toBe("demo.tap");
    const catalog = store.tape()?.catalog;
    const stored = await backend.getFile(id);
    if (!stored) throw new Error("Fixture missing");
    await backend.putFiles([
      { ...stored, bytes: new Uint8Array([2, 0, 255, 255]), size: 4 },
    ]);
    expect(store.tape()?.catalog).toBe(catalog);
    await store.deleteFile(id);
    expect(store.tape()?.catalog).toBe(catalog);
    expect(store.files()).toHaveLength(0);
    for (let i = 0; i < 300 && machine.memory.read(0x8000) !== 42; i++)
      machine.advanceFrame();
    store.refresh();
    expect(machine.memory.read(0x8000)).toBe(42);
    expect(view.getByText(/End of tape/)).toBeInTheDocument();
    store.setReset(true);
    store.setReset(false);
    expect(store.tape()?.cursor).toBe(0);
    expect(store.tape()?.name).toBe("demo.tap");
    const fresh = await createAppStore({
      backend,
      machineFactory: createMachine,
      hostLoopFactory: () => makeFakeLoop(),
    });
    expect(fresh.tape()?.name).toBeNull();
    fresh.dispose();
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("rejects a corrupt tape before changing the mounted image or machine", async () => {
  const { store, view, machine, backend } = await setup([
    { name: "valid.tap", bytes: basicTapFixture() },
  ]);
  try {
    const id = store.files()[0].id;
    await store.mountFile(id);
    const stored = await backend.getFile(id);
    if (!stored) throw new Error("Fixture missing");
    await backend.putFiles([{ ...stored, bytes: new Uint8Array([5, 0, 255]) }]);
    const catalog = store.tape()?.catalog;
    const pc = machine.cpu.regs.pc;
    await store.mountFile(id);
    expect(store.error()).toMatch(/truncated/i);
    expect(store.tape()?.catalog).toBe(catalog);
    expect(machine.cpu.regs.pc).toBe(pc);
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("keeps catalog buttons attached across cloned worker snapshots during a click", async () => {
  const { store, view, machine } = await setup();
  try {
    machine.mountTape(basicTapFixture(), "cloned.tap");
    store.refresh();
    const select = view.getByRole("button", { name: "Select block 2" });
    const called = vi.spyOn(store, "seekTape").mockResolvedValue();
    fireEvent.mouseDown(select);
    const state = structuredClone(machine.tapeState);
    Object.defineProperty(machine, "tapeState", {
      configurable: true,
      get: () => structuredClone(state),
    });
    store.refresh();
    expect(view.getByRole("button", { name: "Select block 2" })).toBe(select);
    fireEvent.mouseUp(select);
    fireEvent.click(select);
    expect(called).toHaveBeenCalledWith(1);
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("runs the selected program from the mounted copy after deleting its library entry", async () => {
  const tape = basicTapFixture();
  const { store, view, machine } = await setup([
    { name: "two.tap", bytes: new Uint8Array([...tape, ...tape]) },
  ]);
  try {
    const id = store.files()[0].id;
    await store.mountFile(id);
    expect(view.getAllByRole("button", { name: /^Run block/ })).toHaveLength(2);
    expect(view.queryByRole("button", { name: "Run block 2" })).toBeNull();
    await store.deleteFile(id);
    const catalog = store.tape()?.catalog;
    fireEvent.click(view.getByRole("button", { name: "Run block 3" }));
    await waitFor(() => expect(store.isRunning()).toBe(true));
    expect(store.tape()?.cursor).toBe(2);
    expect(store.keyboardFocusRequest()).toBeGreaterThan(0);
    for (let i = 0; i < 300 && machine.memory.read(0x8000) !== 42; i++)
      machine.advanceFrame();
    store.refresh();
    expect(machine.memory.read(0x8000)).toBe(42);
    expect(store.tape()?.cursor).toBe(4);
    expect(store.tape()?.catalog).toBe(catalog);
    expect(store.error()).toBeNull();
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("keeps the mounted name and sole BASIC Run in the header while folded", async () => {
  const { store, view, machine } = await setup();
  try {
    const program = basicTapFixture();
    machine.mountTape(
      new Uint8Array([2, 0, 255, 255, ...program]),
      "single.tap",
    );
    store.refresh();
    const run = view.getByRole("button", { name: "Run tape" });
    const runTape = vi.spyOn(store, "runTape").mockResolvedValue();
    fireEvent.click(view.getByRole("button", { name: "Collapse Tape" }));
    expect(view.getByText("single.tap")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Run tape" })).toBe(run);
    expect(view.queryByRole("button", { name: "Run block 2" })).toBeNull();
    fireEvent.click(run);
    expect(runTape).toHaveBeenCalledWith(1);

    machine.mountTape(new Uint8Array([...program, ...program]), "two.tap");
    store.refresh();
    expect(view.getByText("two.tap")).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Run tape" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Expand Tape" }));
    expect(view.getAllByRole("button", { name: /^Run block/ })).toHaveLength(2);
    machine.mountTape(new Uint8Array([2, 0, 255, 255]), "data.tap");
    store.refresh();
    expect(view.queryByRole("button", { name: "Run tape" })).toBeNull();
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("retains a folded Tape through Load, header Run and automatic import loading", async () => {
  const { store, view } = await setup([
    { name: "first.tap", bytes: basicTapFixture() },
  ]);
  try {
    fireEvent.click(view.getByRole("button", { name: "Collapse Tape" }));
    const expectFolded = (name: string) => {
      const toggle = view.getByRole("button", { name: "Expand Tape" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle.closest("header")).toHaveTextContent(name);
      expect(
        view.getByRole("button", { name: "Run tape" }),
      ).toBeInTheDocument();
      expect(view.queryByRole("table")).toBeNull();
      expect(localStorage.getItem("zx-ladder:section:tape:folded")).toBe(
        "true",
      );
    };
    await store.loadFile(store.files()[0].id);
    expectFolded("first.tap");
    await store.runTape(0);
    expectFolded("first.tap");
    const bytes = basicTapFixture();
    await store.importFiles([
      {
        name: "second.tap",
        size: bytes.length,
        arrayBuffer: async () => bytes.slice().buffer,
      } as File,
    ]);
    expectFolded("second.tap");
    expect(store.isRunning()).toBe(true);
  } finally {
    view.unmount();
    store.dispose();
  }
});
