import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { KempstonDevice } from "../../devices/kempston";
import { attachKeyboardInput } from "../../input/keyboardInput";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";
import { KeyboardSection } from ".";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(compact = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: compact && /max-width:\s*760px/.test(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  const machine = makeFakeMachine();
  const hardware = new KempstonDevice(() => false);
  machine.kempstonInput = hardware.input.bind(hardware);
  const store = await createAppStore({
    backend: new MemoryBackend({
      initial: { name: "keyboard.rom", bytes: new Uint8Array(32768) },
    }),
    machineFactory: () => machine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  const view = render(() => (
    <StoreProvider value={store}>
      <KeyboardSection />
    </StoreProvider>
  ));
  const detach = attachKeyboardInput(
    () => machine.keyboard,
    document,
    store.keyboardLayout,
    store.kempston,
  );
  return {
    store,
    view,
    machine,
    hardware,
    dispose() {
      detach();
      view.unmount();
      store.dispose();
    },
  };
}

function arrow(type: "keydown" | "keyup") {
  const event = new KeyboardEvent(type, {
    key: "ArrowLeft",
    code: "ArrowLeft",
    bubbles: true,
    cancelable: true,
  });
  document.activeElement?.dispatchEvent(event);
  return event;
}

it("places the keyboard before cursor modes, configuration and the modifier legend", async () => {
  const fixture = await setup();
  try {
    const { view } = fixture;
    const ordered = [
      view.getByRole("application", { name: "Spectrum keyboard input" }),
      view.getByRole("application", { name: "Compact Spectrum keyboard" }),
      view.getByRole("group", { name: "Cursor key mode" }),
      view.getByRole("combobox", { name: "Keyboard layout" }),
      view.getByRole("combobox", { name: "Keyboard color" }),
      view.getByText("Control = Caps Shift · Alt / Option = Symbol Shift"),
    ];
    for (let index = 1; index < ordered.length; index++)
      expect(
        ordered[index - 1].compareDocumentPosition(ordered[index]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
  } finally {
    fixture.dispose();
  }
});

it.each([false, true])(
  "returns focus to the visible keyboard and routes physical arrows after selecting a cursor mode (compact=%s)",
  async (compact) => {
    const fixture = await setup(compact);
    try {
      const { view, machine, hardware } = fixture;
      const surface = view.getByRole("application", {
        name: compact ? "Compact Spectrum keyboard" : "Spectrum keyboard input",
      });
      for (const { label, key } of [
        { label: "Sinclair I (67890)", key: "6" },
        { label: "Sinclair II (12345)", key: "1" },
        { label: "Kempston", key: null },
      ] as const) {
        const radio = view.getByRole("radio", { name: label });
        radio.focus();
        fireEvent.click(radio);
        expect(radio).toBeChecked();
        expect(surface).toHaveFocus();
        expect(arrow("keydown").defaultPrevented).toBe(true);
        expect(radio).toBeChecked();
        expect(surface).toHaveFocus();
        expect(fixture.store.kempston.heldBits()).toBe(2);
        expect(hardware.joystick).toBe(key === null ? 2 : 0);
        if (key) expect(machine.keyboard.isPressed(key)).toBe(true);
        expect(machine.keyboard.isPressed("CAPS_SHIFT")).toBe(false);
        arrow("keyup");
        expect(fixture.store.kempston.heldBits()).toBe(0);
        expect(hardware.joystick).toBe(0);
        if (key) expect(machine.keyboard.isPressed(key)).toBe(false);
      }
    } finally {
      fixture.dispose();
    }
  },
);

it("leaves layout and color selectors focused and their arrow keys available to the browser", async () => {
  const fixture = await setup();
  try {
    const { view, store, machine, hardware } = fixture;
    fireEvent.click(view.getByRole("radio", { name: "Kempston" }));
    const layout = view.getByRole("combobox", { name: "Keyboard layout" });
    layout.focus();
    fireEvent.change(layout, { target: { value: "pc-full-size" } });
    expect(store.keyboardLayout()).toBe("pc-full-size");
    expect(layout).toHaveFocus();
    expect(arrow("keydown").defaultPrevented).toBe(false);
    arrow("keyup");
    const color = view.getByRole("combobox", { name: "Keyboard color" });
    color.focus();
    fireEvent.change(color, { target: { value: "dark" } });
    expect(store.keyboardColor()).toBe("dark");
    expect(color).toHaveFocus();
    expect(arrow("keydown").defaultPrevented).toBe(false);
    arrow("keyup");
    expect(store.kempston.heldBits()).toBe(0);
    expect(hardware.joystick).toBe(0);
    expect(machine.keyboard.isPressed("CAPS_SHIFT")).toBe(false);
  } finally {
    fixture.dispose();
  }
});
