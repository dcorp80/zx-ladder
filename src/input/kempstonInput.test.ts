import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_KEMPSTON, KempstonDevice } from "../devices/kempston";
import { KeyboardDevice } from "../devices/keyboard";
import { gamepadBits, KempstonController } from "./kempstonInput";
import { attachKeyboardInput } from "./keyboardInput";

function harness() {
  const hardware = new KempstonDevice(() => false);
  const keyboard = new KeyboardDevice();
  const target = {
    keyboard,
    kempstonInput: hardware.input.bind(hardware),
    get mouseAccessed() {
      return hardware.mouseAccessed;
    },
  };
  const controller = new KempstonController(
    () => target,
    DEFAULT_KEMPSTON,
    () => {},
  );
  return { hardware, keyboard, controller };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each(["Sinclair I", "Sinclair II"] as const)(
  "maps %s with conventional digits and independent fire ownership",
  (mode) => {
    const { controller, keyboard } = harness();
    controller.setMode(mode);
    const row = mode === "Sinclair I" ? "67890" : "12345";
    for (const [i, code] of [
      "ArrowLeft",
      "ArrowRight",
      "ArrowDown",
      "ArrowUp",
      "Space",
    ].entries()) {
      controller.press(`host:${code}`, code);
      expect(keyboard.isPressed(row[i] as "1")).toBe(true);
    }
    expect(keyboard.isPressed("SPACE")).toBe(false);
    expect(keyboard.isPressed("CAPS_SHIFT")).toBe(false);
    keyboard.press("literal", row[0] as "1");
    controller.setMode("Cursor");
    expect(keyboard.isPressed(row[0] as "1")).toBe(true);
    expect(keyboard.isPressed(row[4] as "1")).toBe(false);
  },
);
it("takes over Kempston exclusively, releases overlapping sources, and restores Cursor on reset", () => {
  const { controller, hardware, keyboard } = harness();
  controller.setMode("Kempston");
  controller.press("host:ArrowLeft", "ArrowLeft");
  controller.press("pointer:1", "ArrowLeft");
  controller.press("host:Space", "Space");
  expect(hardware.joystick).toBe(18);
  expect(keyboard.hasInputSources).toBe(false);
  controller.release("host:ArrowLeft");
  expect(hardware.joystick).toBe(18);
  controller.release("pointer:1");
  expect(hardware.joystick).toBe(16);
  keyboard.press("ordinary", "A");
  controller.reset();
  expect(controller.mode()).toBe("Cursor");
  expect(hardware.joystick).toBe(0);
  expect(keyboard.isPressed("A")).toBe(true);
});
it.each(["Space", "Enter", "Digit0"] as const)(
  "supports %s fire with optional Spectrum passthrough",
  (fireKey) => {
    const { controller, hardware, keyboard } = harness();
    controller.configure({ fireKey, suppressKey: false });
    controller.setMode("Kempston");
    controller.press("fire", fireKey);
    expect(hardware.joystick).toBe(16);
    const key =
      fireKey === "Space" ? "SPACE" : fireKey === "Enter" ? "ENTER" : "0";
    expect(keyboard.isPressed(key)).toBe(true);
    controller.configure({ suppressKey: true });
    expect(keyboard.isPressed(key)).toBe(false);
    expect(hardware.joystick).toBe(0);
  },
);
it("routes physical arrows and fire, clears on focus loss and does not reacquire on repeat", () => {
  const { controller, hardware, keyboard } = harness();
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.dataset.emulatorInput = "true";
  document.body.append(canvas);
  const detach = attachKeyboardInput(
    () => keyboard,
    document,
    () => "macbook-pro-iso",
    controller,
  );
  try {
    canvas.focus();
    controller.setMode("Kempston");
    const key = (type: string, code: string, repeat = false) =>
      canvas.dispatchEvent(
        new KeyboardEvent(type, {
          code,
          repeat,
          bubbles: true,
          cancelable: true,
        }),
      );
    key("keydown", "ArrowUp");
    key("keydown", "Space");
    expect(hardware.joystick).toBe(24);
    window.dispatchEvent(new Event("blur"));
    expect(hardware.joystick).toBe(0);
    key("keydown", "ArrowUp", true);
    expect(hardware.joystick).toBe(0);
  } finally {
    detach();
    canvas.remove();
  }
});
it("removes a held Cursor chord when switching modes without releasing an independent modifier", () => {
  const { controller, keyboard } = harness();
  controller.press("host:ArrowLeft", "ArrowLeft");
  keyboard.press("host:ArrowLeft", ["CAPS_SHIFT", "5"]);
  keyboard.press("host:ControlLeft", "CAPS_SHIFT");
  controller.setMode("Kempston");
  expect(keyboard.isPressed("5")).toBe(false);
  expect(keyboard.isPressed("CAPS_SHIFT")).toBe(true);
});
it("maps standard gamepad axes and buttons", () => {
  const pad = {
    axes: [-0.8, 0.8],
    buttons: [{ pressed: true }],
  } as unknown as Gamepad;
  expect(gamepadBits(pad)).toBe(22);
  expect(
    gamepadBits({ axes: [0.1, -0.1], buttons: [] } as unknown as Gamepad),
  ).toBe(0);
});

it("selects among connected gamepads, respects exclusive takeover and stays released while blurred", () => {
  const { controller, hardware } = harness();
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    callback = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let pads = [
    { index: 0, id: "First", connected: true, axes: [-1, 0], buttons: [] },
    {
      index: 2,
      id: "Second",
      connected: true,
      axes: [1, 0],
      buttons: [{ pressed: true }],
    },
  ];
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => pads,
  });
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.dataset.emulatorInput = "true";
  document.body.append(canvas);
  canvas.focus();
  const detach = controller.attach();
  try {
    window.dispatchEvent(new Event("focus"));
    callback(0);
    expect(controller.pads()).toHaveLength(2);
    expect(controller.selected()).toBe(0);
    expect(hardware.joystick).toBe(2);
    controller.selectPad(2);
    callback(1);
    expect(hardware.joystick).toBe(17);
    window.dispatchEvent(new Event("blur"));
    callback(2);
    expect(hardware.joystick).toBe(0);
    window.dispatchEvent(new Event("focus"));
    callback(3);
    expect(hardware.joystick).toBe(17);
    controller.setMode("Kempston");
    controller.press("host:ArrowUp", "ArrowUp");
    callback(4);
    expect(hardware.joystick).toBe(8);
    pads = pads.slice(0, 1);
    callback(5);
    expect(hardware.joystick).toBe(8);
    controller.configure({ gamepadEnabled: true });
    callback(6);
    expect(hardware.joystick).toBe(8);
    controller.useGamepad();
    callback(7);
    expect(controller.mode()).toBe("Cursor");
    expect(hardware.joystick).toBe(2);
    pads = [];
    callback(8);
    expect(controller.pads()).toHaveLength(0);
    expect(hardware.joystick).toBe(0);
  } finally {
    detach();
    canvas.remove();
    delete (navigator as Partial<Navigator>).getGamepads;
  }
});
it("captures only on explicit action, consumes the initial click and clears buttons on browser release", async () => {
  const { controller, hardware } = harness();
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    callback = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let locked: Element | null = null;
  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    get: () => locked,
  });
  const canvas = document.createElement("canvas");
  canvas.className = "machine-canvas";
  canvas.tabIndex = 0;
  canvas.dataset.emulatorInput = "true";
  canvas.requestPointerLock = vi.fn(async () => {
    locked = canvas;
    document.dispatchEvent(new Event("pointerlockchange"));
  });
  document.body.append(canvas);
  const detach = controller.attach();
  try {
    canvas.click();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    controller.configure({ mouseEnabled: true });
    canvas.click();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    hardware.observeRead(0xfadf);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { buttons: 1, bubbles: true }),
    );
    canvas.click();
    await Promise.resolve();
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    expect(hardware.buttons).toBe(0);
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { buttons: 1, bubbles: true }),
    );
    expect(hardware.buttons).toBe(1);
    for (let i = 0; i < 2; i++) {
      const motion = new MouseEvent("mousemove", { bubbles: true });
      Object.defineProperties(motion, {
        movementX: { value: 3 },
        movementY: { value: -2 },
      });
      canvas.dispatchEvent(motion);
    }
    expect(hardware.x).toBe(0);
    callback(0);
    expect(hardware.x).toBe(6);
    expect(hardware.y).toBe(4);
    locked = null;
    document.dispatchEvent(new Event("pointerlockchange"));
    expect(hardware.buttons).toBe(0);
    expect(controller.captureStatus()).toBe("Mouse not captured");
    canvas.requestPointerLock = vi.fn(async () => {
      throw new Error("Denied");
    });
    await controller.capture();
    expect(controller.captureStatus()).toMatch(/unavailable or denied/);
    let finish!: () => void;
    canvas.requestPointerLock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    Object.defineProperty(document, "exitPointerLock", {
      configurable: true,
      value: vi.fn(() => {
        locked = null;
        document.dispatchEvent(new Event("pointerlockchange"));
      }),
    });
    const pending = controller.capture();
    controller.reset();
    locked = canvas;
    document.dispatchEvent(new Event("pointerlockchange"));
    finish();
    await pending;
    expect(locked).toBeNull();
    expect(controller.captureStatus()).toBe("Mouse not captured");
    hardware.reset();
    canvas.click();
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    // The explicit capture action bypasses the program-access gate.
    canvas.requestPointerLock = vi.fn(async () => {});
    await controller.capture();
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
  } finally {
    locked = null;
    detach();
    canvas.remove();
    Reflect.deleteProperty(document, "pointerLockElement");
    Reflect.deleteProperty(document, "exitPointerLock");
  }
});
