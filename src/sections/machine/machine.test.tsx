import { fireEvent, render } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { createMachine, type Machine } from "../../machine/machine";
import { loadConfig } from "../../storage/config";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";
import { MachineSection } from "./index";

it("keeps machine controls usable in the header while folded", async () => {
  const machines: ReturnType<typeof makeFakeMachine>[] = [];
  const store = await createAppStore({
    backend: new MemoryBackend(),
    machineFactory: () => {
      const machine = makeFakeMachine();
      machines.push(machine);
      return machine;
    },
    hostLoopFactory: () => makeFakeLoop(),
  });
  await store.importRom(new File([new Uint8Array(16384)], "48.rom"));
  const view = render(() => (
    <StoreProvider value={store}>
      <MachineSection />
    </StoreProvider>
  ));
  try {
    const machine = machines[0];
    const reset = vi.spyOn(machine, "setReset");
    const resetButton = view.getByRole("button", { name: "Reset" });
    fireEvent.keyDown(resetButton, { key: "Enter" });
    expect(resetButton).toHaveAttribute("aria-pressed", "true");
    const resetCalls = reset.mock.calls.length;

    fireEvent.click(view.getByRole("button", { name: "Collapse Machine" }));
    expect(view.queryByRole("checkbox", { name: "48K mode" })).toBeNull();
    expect(view.getByRole("button", { name: "Reset" })).toBe(resetButton);
    expect(resetButton).toHaveAttribute("aria-pressed", "true");
    expect(reset).toHaveBeenCalledTimes(resetCalls);
    fireEvent.keyUp(resetButton, { key: "Enter" });
    expect(reset).toHaveBeenLastCalledWith(false);

    const step = view.getByRole("button", { name: "Step frame" });
    fireEvent.click(step);
    expect(machine.frameCount).toBe(1);
    fireEvent.click(view.getByRole("button", { name: "Run" }));
    expect(store.isRunning()).toBe(true);
    expect(step).toBeDisabled();
    fireEvent.click(view.getByRole("button", { name: "Pause" }));
    expect(store.isRunning()).toBe(false);
    expect(step).toBeEnabled();

    fireEvent.click(view.getByRole("button", { name: "Run" }));
    const coldBoot = view.getByRole("button", { name: "Cold boot" });
    expect(coldBoot).toBeEnabled();
    fireEvent.click(coldBoot);
    expect(machines).toHaveLength(2);
    expect(store.isRunning()).toBe(true);
    expect(
      view.getByRole("button", { name: "Expand Machine" }),
    ).toBeInTheDocument();
  } finally {
    view.unmount();
    store.dispose();
  }
});

it.each([false, true])(
  "saves 48K mode and applies it through Reset and Cold boot (running=%s)",
  async (running) => {
    const machines: Machine[] = [];
    const store = await createAppStore({
      backend: new MemoryBackend(),
      machineFactory: (options) => {
        const machine = createMachine(options);
        machines.push(machine);
        return machine;
      },
      hostLoopFactory: () => makeFakeLoop(),
    });
    await store.importRom(new File([new Uint8Array(32768)], "pair.rom"));
    const view = render(() => (
      <StoreProvider value={store}>
        <MachineSection />
      </StoreProvider>
    ));
    try {
      const machine = machines[0];
      machine.bus.writeIo(0x7ffd, 0x0b);
      machine.memory.write(0xc000, 91);
      const mode = view.getByRole("checkbox", { name: "48K mode" });
      expect(view.getByText("128K · no contention")).toBeInTheDocument();
      expect(mode).not.toBeChecked();
      fireEvent.click(mode);
      expect(mode).toBeChecked();
      expect(loadConfig().mode48k).toBe(true);
      expect(view.getByText("128K · no contention")).toBeInTheDocument();
      expect(machine.memoryMapping).toEqual({
        ramPage: 3,
        romPage: 0,
        screenPage: 7,
      });

      fireEvent.click(view.getByRole("button", { name: "Reset" }));
      expect(machine.mcu.latch).toBe(0x30);
      expect(view.getByText("48K · no contention")).toBeInTheDocument();
      expect(machine.memoryMapping).toEqual({
        ramPage: 0,
        romPage: 1,
        screenPage: 5,
      });
      expect(machine.memory.ramPages[3][0]).toBe(91);
      machine.bus.writeIo(0x7ffd, 7);
      expect(machine.mcu.latch).toBe(0x30);

      if (running) store.run();
      const coldBoot = view.getByRole("button", { name: "Cold boot" });
      expect(coldBoot).toBeEnabled();
      fireEvent.click(coldBoot);
      expect(machines).toHaveLength(2);
      expect(store.isRunning()).toBe(running);
      expect(view.getByText("48K · no contention")).toBeInTheDocument();
      expect(machines[1].mcu.latch).toBe(0x30);
      expect(machines[1].memory.ramPages[3][0]).toBe(0xff);

      fireEvent.click(mode);
      expect(loadConfig().mode48k).toBe(false);
      expect(view.getByText("48K · no contention")).toBeInTheDocument();
      expect(machines[1].mcu.latch).toBe(0x30);
      fireEvent.click(view.getByRole("button", { name: "Reset" }));
      expect(machines[1].mcu.latch).toBe(0);
      expect(view.getByText("128K · no contention")).toBeInTheDocument();
      expect(machines[1].memoryMapping.romPage).toBe(0);
    } finally {
      view.unmount();
      store.dispose();
    }
  },
);
