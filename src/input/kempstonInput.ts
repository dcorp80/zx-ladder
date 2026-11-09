import { createSignal } from "solid-js";
import {
  type KempstonInput,
  type KempstonSettings,
  sanitizeKempston,
} from "../devices/kempston";
import type { KeyboardDevice, SpectrumKey } from "../devices/keyboard";

export type CursorMode = "Cursor" | "Sinclair I" | "Sinclair II" | "Kempston";
export const CURSOR_MODES: CursorMode[] = [
  "Cursor",
  "Sinclair I",
  "Sinclair II",
  "Kempston",
];
const arrows = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"];
const bits = [2, 1, 4, 8, 16];
interface Target {
  readonly mouseAccessed?: boolean;
  keyboard: KeyboardDevice;
  kempstonInput?(input: KempstonInput): void;
  readonly diskState?: { dosEnabled: boolean };
}
export function gamepadBits(pad: Gamepad): number {
  const held = (n: number) => pad.buttons[n]?.pressed ?? false;
  return (
    (held(14) || pad.axes[0] < -0.35 ? 2 : 0) |
    (held(15) || pad.axes[0] > 0.35 ? 1 : 0) |
    (held(13) || pad.axes[1] > 0.35 ? 4 : 0) |
    (held(12) || pad.axes[1] < -0.35 ? 8 : 0) |
    (held(0) ? 16 : 0)
  );
}
export class KempstonController {
  private readonly settingsSignal;
  private readonly modeSignal = createSignal<CursorMode>("Cursor");
  private readonly padsSignal = createSignal<{ index: number; id: string }[]>(
    [],
  );
  private readonly selectedSignal = createSignal<number | undefined>();
  private readonly captureSignal = createSignal("Mouse not captured");
  private readonly heldSignal = createSignal(0);
  private readonly sourceVersion = createSignal(0);
  readonly settings;
  readonly mode = this.modeSignal[0];
  readonly pads = this.padsSignal[0];
  readonly selected = this.selectedSignal[0];
  readonly captureStatus = this.captureSignal[0];
  readonly heldBits = this.heldSignal[0];
  private normalSources = new Set<string>();
  private sources = new Map<string, number>();
  private lastBits = -1;
  private canvas?: HTMLCanvasElement;
  private captureRequested = false;
  private captureEpoch = 0;
  private dx = 0;
  private dy = 0;
  private detach?: () => void;
  constructor(
    private readonly target: () => Target | null,
    initial: unknown,
    private readonly persist: () => void,
  ) {
    this.settingsSignal = createSignal(sanitizeKempston(initial));
    this.settings = this.settingsSignal[0];
  }
  private send(input: KempstonInput) {
    this.target()?.kempstonInput?.(input);
  }
  configure(patch: Partial<KempstonSettings>) {
    if (patch.fireKey !== undefined || patch.suppressKey !== undefined) {
      this.clearNormalKeys();
      this.clearKeys();
    }
    this.settingsSignal[1](sanitizeKempston({ ...this.settings(), ...patch }));
    this.send({ action: "settings", settings: this.settings() });
    if (!this.settings().mouseEnabled) this.releaseMouse();
    if (this.mode() !== "Kempston") this.sendBits(0);
    this.persist();
  }
  setMode(mode: CursorMode) {
    if (this.mode() === mode) return;
    this.clearNormalKeys();
    this.clearKeys();
    this.modeSignal[1](mode);
    this.lastBits = -1;
    this.sendBits(0);
  }
  useGamepad() {
    this.setMode("Cursor");
  }
  selectPad(index: number) {
    this.selectedSignal[1](index);
    if (this.mode() !== "Kempston") this.sendBits(0);
  }
  /** Called before replacing the machine, and on warm reset. */
  reset() {
    this.clearKeys();
    this.modeSignal[1]("Cursor");
    this.releaseMouse();
    this.lastBits = -1;
    this.sendBits(0);
  }
  install() {
    this.lastBits = -1;
    this.send({ action: "settings", settings: this.settings() });
    this.sendBits(0);
  }
  private clearNormalKeys() {
    for (const source of this.normalSources)
      this.target()?.keyboard.release(source);
    this.normalSources.clear();
  }
  clearKeys() {
    for (const source of this.sources.keys())
      this.target()?.keyboard.release(source);
    this.sources.clear();
    this.sourceVersion[1]((v) => v + 1);
    this.heldSignal[1](0);
    this.sendBits(0);
  }
  release(source: string): boolean {
    this.normalSources.delete(source);
    if (!this.sources.has(source)) return false;
    this.sources.delete(source);
    this.target()?.keyboard.release(source);
    this.publishKeyboard();
    return true;
  }
  owns(source: string) {
    this.sourceVersion[0]();
    return this.sources.has(source);
  }
  private publishKeyboard() {
    this.sourceVersion[1]((v) => v + 1);
    let value = 0;
    for (const bit of this.sources.values()) value |= bit;
    this.heldSignal[1](value);
    if (this.mode() === "Kempston") this.sendBits(value);
  }
  /** true means this code was handled, even when the mapped source repeats. */
  press(source: string, code: string): boolean {
    if (this.mode() === "Cursor") {
      if (arrows.includes(code) || code === this.settings().fireKey)
        this.normalSources.add(source);
      return false;
    }
    const direction = arrows.indexOf(code);
    const fire = code === this.settings().fireKey;
    if (direction < 0 && !fire) return false;
    if (this.sources.has(source)) return true;
    const index = fire ? 4 : direction;
    this.sources.set(source, bits[index]);
    const keyboard = this.target()?.keyboard;
    const keys: SpectrumKey[] = [];
    if (this.mode() !== "Kempston") {
      const row = this.mode() === "Sinclair I" ? "67890" : "12345";
      keys.push(row[index] as SpectrumKey);
    }
    if (fire && !this.settings().suppressKey)
      keys.push(code === "Space" ? "SPACE" : code === "Enter" ? "ENTER" : "0");
    if (keys.length) keyboard?.press(source, keys);
    this.publishKeyboard();
    return true;
  }
  caption(code: string): string | undefined {
    if (this.mode() === "Cursor") return;
    const index = code === this.settings().fireKey ? 4 : arrows.indexOf(code);
    if (index < 0) return;
    const mapped =
      this.mode() === "Kempston"
        ? `Kempston ${["Left", "Right", "Down", "Up", "Fire"][index]}`
        : (this.mode() === "Sinclair I" ? "67890" : "12345")[index];
    return index === 4
      ? `Fire: ${mapped}${this.settings().suppressKey ? "" : " + Spectrum key"}`
      : mapped;
  }
  private sendBits(bits: number) {
    if (bits === this.lastBits) return;
    this.lastBits = bits;
    this.send({ action: "joystick", bits });
  }
  async capture() {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.machine-canvas",
    );
    if (!canvas || !this.target()) {
      this.captureSignal[1]("Load a ROM before capturing mouse");
      return;
    }
    if (!this.settings().mouseEnabled) this.configure({ mouseEnabled: true });
    canvas.focus({ preventScroll: true });
    this.captureRequested = true;
    const epoch = ++this.captureEpoch;
    const target = this.target();
    try {
      if (!canvas.requestPointerLock) throw new Error("unavailable");
      this.canvas = canvas;
      await canvas.requestPointerLock();
      if (epoch !== this.captureEpoch || target !== this.target()) {
        if (document.pointerLockElement === canvas)
          document.exitPointerLock?.();
      }
    } catch {
      if (epoch !== this.captureEpoch) return;
      this.captureRequested = false;
      this.captureSignal[1]("Mouse capture unavailable or denied");
    }
  }
  releaseMouse() {
    this.captureRequested = false;
    this.captureEpoch++;
    this.dx = this.dy = 0;
    if (this.canvas && document.pointerLockElement === this.canvas)
      document.exitPointerLock?.();
    this.send({ action: "buttons", buttons: 0 });
    this.captureSignal[1]("Mouse not captured");
  }
  attach() {
    const doc = document;
    let windowFocused = doc.hasFocus();
    const active = () =>
      windowFocused &&
      !doc.hidden &&
      doc.activeElement?.matches('[data-emulator-input="true"]');
    let frame = 0;
    const poll = () => {
      let available: (Gamepad | null)[] = [];
      try {
        available = Array.from(navigator.getGamepads?.() ?? []);
      } catch {
        /* Browser policy may deny gamepad access. */
      }
      const pads = available.filter((p): p is Gamepad => !!p?.connected);
      const old = this.pads();
      if (
        old.length !== pads.length ||
        pads.some((p, i) => old[i]?.index !== p.index || old[i]?.id !== p.id)
      ) {
        this.padsSignal[1](pads.map(({ index, id }) => ({ index, id })));
        if (!pads.some((p) => p.index === this.selected())) {
          this.selectedSignal[1](pads[0]?.index);
          if (this.mode() !== "Kempston") this.sendBits(0);
        }
      }
      const pad = pads.find((p) => p.index === this.selected());
      if (this.mode() !== "Kempston")
        this.sendBits(
          active() && this.settings().gamepadEnabled && pad
            ? gamepadBits(pad)
            : 0,
        );
      if (this.dx || this.dy) {
        this.send({ action: "motion", dx: this.dx, dy: this.dy });
        this.dx = this.dy = 0;
      }
      frame = requestAnimationFrame(poll);
    };
    const locked = () =>
      !!this.canvas && doc.pointerLockElement === this.canvas;
    const lockChange = () => {
      if (locked() && !this.captureRequested) {
        document.exitPointerLock?.();
        return;
      }
      this.dx = this.dy = 0;
      if (!locked()) this.captureRequested = false;
      this.send({ action: "buttons", buttons: 0 });
      this.captureSignal[1](
        locked()
          ? "Mouse captured · use the browser release gesture (Escape)"
          : "Mouse not captured",
      );
    };
    const lockError = () =>
      this.captureSignal[1]("Mouse capture unavailable or denied");
    const move = (e: MouseEvent) => {
      if (locked() && !this.target()?.diskState?.dosEnabled) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    };
    const buttons = (e: MouseEvent) => {
      if (locked()) {
        e.preventDefault();
        this.send({ action: "buttons", buttons: e.buttons });
      }
    };
    const click = (e: MouseEvent) => {
      if (
        e.target instanceof HTMLCanvasElement &&
        e.target.matches(".machine-canvas") &&
        this.settings().mouseEnabled &&
        this.target()?.mouseAccessed === true &&
        !locked()
      ) {
        e.preventDefault();
        void this.capture();
      }
    };
    const context = (e: MouseEvent) => {
      if (locked()) e.preventDefault();
    };
    const release = () => {
      this.clearKeys();
      this.sendBits(0);
      this.releaseMouse();
    };
    const blur = () => {
      windowFocused = false;
      release();
    };
    const windowFocus = () => {
      windowFocused = true;
    };
    const hidden = () => {
      if (doc.hidden) release();
    };
    const focus = () => {
      if (!active()) {
        this.clearKeys();
        this.sendBits(0);
        this.releaseMouse();
      }
    };
    doc.addEventListener("pointerlockchange", lockChange);
    doc.addEventListener("pointerlockerror", lockError);
    doc.addEventListener("mousemove", move);
    doc.addEventListener("mousedown", buttons);
    doc.addEventListener("mouseup", buttons);
    doc.addEventListener("click", click);
    doc.addEventListener("contextmenu", context);
    doc.addEventListener("visibilitychange", hidden);
    doc.addEventListener("focusin", focus);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", windowFocus);
    frame = requestAnimationFrame(poll);
    this.detach = () => {
      cancelAnimationFrame(frame);
      release();
      doc.removeEventListener("pointerlockchange", lockChange);
      doc.removeEventListener("pointerlockerror", lockError);
      doc.removeEventListener("mousemove", move);
      doc.removeEventListener("mousedown", buttons);
      doc.removeEventListener("mouseup", buttons);
      doc.removeEventListener("click", click);
      doc.removeEventListener("contextmenu", context);
      doc.removeEventListener("visibilitychange", hidden);
      doc.removeEventListener("focusin", focus);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", windowFocus);
    };
    return () => {
      this.detach?.();
      this.detach = undefined;
    };
  }
  dispose() {
    this.detach?.();
    this.detach = undefined;
    this.reset();
  }
}
