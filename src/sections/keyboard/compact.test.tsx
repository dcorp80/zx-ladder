import { fireEvent, render, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import type { SpectrumKey } from "../../devices/keyboard";
import { attachKeyboardInput } from "../../input/keyboardInput";
import { MemoryBackend } from "../../storage/memory";
import { createAppStore, StoreProvider } from "../../store";
import { makeFakeLoop, makeFakeMachine } from "../../test/fakes";
import { CompactKeyboard } from "./compact";

async function setup() {
  const machine = makeFakeMachine();
  const store = await createAppStore({
    backend: new MemoryBackend({
      initial: { name: "test.rom", bytes: new Uint8Array(32768) },
    }),
    machineFactory: () => machine,
    hostLoopFactory: () => makeFakeLoop(),
  });
  const view = render(() => (
    <StoreProvider value={store}>
      <CompactKeyboard />
    </StoreProvider>
  ));
  const surface = view.getByRole("application", {
    name: "Compact Spectrum keyboard",
  });
  const modifiers = within(
    view.getByRole("group", { name: "Keyboard modifiers" }),
  );
  const keys = surface.querySelector<HTMLElement>(".compact-keys");
  if (!keys) throw new Error("Expected compact keyboard keys");
  const grid = within(keys);
  const detach = attachKeyboardInput(
    () => machine.keyboard,
    document,
    store.keyboardLayout,
    store.kempston,
  );
  const toggle = (name: "CS" | "SS" | "Extended") => {
    fireEvent.click(modifiers.getByRole("button", { name }));
    expect(surface).toHaveFocus();
  };
  const hold = (name: string, pointerId: number) => {
    const key = grid.getByRole("button", { name });
    key.setPointerCapture = vi.fn();
    fireEvent.pointerDown(key, { button: 0, pointerId });
    return key;
  };
  const expectModifiers = (...selected: string[]) => {
    for (const name of ["CS", "SS", "Extended"])
      expect(modifiers.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        String(selected.includes(name)),
      );
  };
  const expectKeys = (...keys: SpectrumKey[]) => {
    if (keys.length === 0) expect(machine.keyboard.readRows(0)).toBe(0x1f);
    for (const key of ["CAPS_SHIFT", "SYMBOL_SHIFT", "Q"] as const)
      expect(machine.keyboard.isPressed(key)).toBe(keys.includes(key));
  };
  return {
    machine,
    view,
    surface,
    modifiers,
    grid,
    toggle,
    hold,
    expectModifiers,
    expectKeys,
    dispose() {
      view.unmount();
      detach();
      store.dispose();
    },
  };
}

it("offers three toggles and applies CS or SS only while a subsequent key is held", async () => {
  const f = await setup();
  try {
    expect(
      f.modifiers.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["CS", "SS", "Extended"]);
    f.expectModifiers();
    const q = f.grid.getByRole("button", { name: "Q" });
    expect(q).toHaveTextContent("PLOT");
    f.toggle("CS");
    f.expectModifiers("CS");
    f.expectKeys();
    f.hold("Q", 1);
    f.expectKeys("CAPS_SHIFT", "Q");
    fireEvent.pointerUp(q, { pointerId: 1 });
    f.expectKeys();
    f.expectModifiers("CS");
    f.toggle("CS");
    f.expectModifiers();
    expect(q).toHaveTextContent("PLOT");
    f.toggle("SS");
    f.expectModifiers("SS");
    expect(q).toHaveTextContent("≤");
    f.hold("Q", 2);
    f.expectKeys("SYMBOL_SHIFT", "Q");
    fireEvent.pointerUp(q, { pointerId: 2 });
    f.expectKeys();
    f.toggle("SS");
    f.expectModifiers();
    f.hold("Q", 3);
    f.expectKeys("Q");
    fireEvent.pointerUp(q, { pointerId: 3 });
    f.expectKeys();
  } finally {
    f.dispose();
  }
});

it.each([
  ["CS", "SS"],
  ["SS", "CS"],
] as const)(
  "enters Extended with %s then %s and toggles shifted Extended for future presses",
  async (first, second) => {
    const f = await setup();
    try {
      f.toggle(first);
      f.toggle(second);
      f.expectModifiers("Extended");
      f.expectKeys();
      const q = f.grid.getByRole("button", { name: "Q" });
      expect(q).toHaveTextContent("SIN");
      f.hold("Q", 1);
      f.expectKeys("CAPS_SHIFT", "SYMBOL_SHIFT");
      f.machine.keyboard.advanceFrame();
      f.expectKeys("CAPS_SHIFT", "SYMBOL_SHIFT");
      f.machine.keyboard.advanceFrame();
      f.expectKeys("Q");
      fireEvent.pointerUp(q, { pointerId: 1 });
      f.toggle("SS");
      f.expectModifiers("Extended", "SS");
      expect(q).toHaveTextContent("ASN");
      f.hold("Q", 2);
      f.machine.keyboard.advanceFrame();
      f.machine.keyboard.advanceFrame();
      f.expectKeys("SYMBOL_SHIFT", "Q");
      f.toggle("SS");
      f.expectModifiers("Extended");
      expect(q).toHaveTextContent("SIN");
      f.expectKeys("SYMBOL_SHIFT", "Q");
      fireEvent.pointerUp(q, { pointerId: 2 });
      f.hold("Q", 3);
      f.machine.keyboard.advanceFrame();
      f.machine.keyboard.advanceFrame();
      f.expectKeys("Q");
      fireEvent.pointerUp(q, { pointerId: 3 });
      f.expectKeys();
    } finally {
      f.dispose();
    }
  },
);

it("uses Extended as a toggle that clears shifts and allows CS to leave Extended", async () => {
  const f = await setup();
  try {
    f.toggle("SS");
    f.toggle("Extended");
    f.expectModifiers("Extended");
    f.toggle("Extended");
    f.expectModifiers();
    f.toggle("CS");
    f.toggle("Extended");
    f.expectModifiers("Extended");
    f.toggle("CS");
    f.expectModifiers("CS");
    f.toggle("SS");
    f.toggle("SS");
    f.expectModifiers("Extended", "SS");
    f.toggle("CS");
    f.expectModifiers("CS");
    f.toggle("Extended");
    f.toggle("SS");
    f.toggle("Extended");
    f.expectModifiers();
    const q = f.hold("Q", 1);
    f.expectKeys("Q");
    fireEvent.pointerUp(q, { pointerId: 1 });
  } finally {
    f.dispose();
  }
});

it("preserves held chords and host ownership across modifier taps, cancellation and unmount", async () => {
  const f = await setup();
  try {
    f.surface.focus();
    fireEvent.keyDown(f.surface, { key: "Control", code: "ControlLeft" });
    expect(f.machine.keyboard.hasSource("host:ControlLeft")).toBe(true);
    f.toggle("CS");
    const q = f.hold("Q", 1);
    const ss = f.modifiers.getByRole("button", { name: "SS" });
    const tap = new PointerEvent("pointerdown", {
      button: 0,
      pointerId: 2,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(ss, tap);
    expect(tap.defaultPrevented).toBe(true);
    expect(f.surface).toHaveFocus();
    fireEvent.click(ss);
    f.expectModifiers("Extended");
    f.expectKeys("CAPS_SHIFT", "Q");
    fireEvent.pointerCancel(q, { pointerId: 1 });
    f.expectKeys("CAPS_SHIFT");
    f.hold("Q", 3);
    fireEvent.pointerUp(q, { pointerId: 3 });
    f.machine.keyboard.advanceFrame();
    f.machine.keyboard.advanceFrame();
    f.expectKeys("CAPS_SHIFT");
    f.hold("Q", 4);
    f.machine.keyboard.advanceFrame();
    f.machine.keyboard.advanceFrame();
    f.expectKeys("CAPS_SHIFT", "Q");
    f.view.unmount();
    f.expectKeys("CAPS_SHIFT");
    expect(f.machine.keyboard.hasSource("host:ControlLeft")).toBe(true);
  } finally {
    f.dispose();
  }
});

it("keeps the CS and SS keycaps momentary without changing the selected modifiers", async () => {
  const f = await setup();
  try {
    for (const shifted of [false, true]) {
      if (shifted) {
        f.toggle("Extended");
        f.toggle("SS");
      }
      const cs = f.hold("CS", 1);
      f.expectKeys("CAPS_SHIFT");
      fireEvent.pointerUp(cs, { pointerId: 1 });
      const ss = f.hold("SS", 2);
      f.expectKeys("SYMBOL_SHIFT");
      fireEvent.pointerCancel(ss, { pointerId: 2 });
      f.expectKeys();
      if (shifted) f.expectModifiers("Extended", "SS");
      else f.expectModifiers();
    }
  } finally {
    f.dispose();
  }
});
