import type { Device, IoClaim } from "../machine/devices";

export interface KempstonSettings {
  mouseEnabled: boolean;
  swapButtons: boolean;
  gamepadEnabled: boolean;
  fireKey: "Space" | "Enter" | "Digit0";
  suppressKey: boolean;
}
export const DEFAULT_KEMPSTON: KempstonSettings = {
  mouseEnabled: false,
  swapButtons: false,
  gamepadEnabled: true,
  fireKey: "Space",
  suppressKey: true,
};
export function sanitizeKempston(value: unknown): KempstonSettings {
  const v = (
    value && typeof value === "object" ? value : {}
  ) as Partial<KempstonSettings>;
  return {
    mouseEnabled: v.mouseEnabled === true,
    swapButtons: v.swapButtons === true,
    gamepadEnabled: v.gamepadEnabled !== false,
    fireKey:
      v.fireKey === "Enter" || v.fireKey === "Digit0" ? v.fireKey : "Space",
    suppressKey: v.suppressKey !== false,
  };
}
export type KempstonInput =
  | { action: "settings"; settings: KempstonSettings }
  | { action: "joystick"; bits: number }
  | { action: "motion"; dx: number; dy: number }
  | { action: "buttons"; buttons: number }
  | { action: "release" };

/** Pure register samples; browser input never enters the CPU hot path. */
export class KempstonDevice implements Device {
  readonly id = "kempston";
  readonly io: IoClaim[];
  settings = { ...DEFAULT_KEMPSTON };
  joystick = 0;
  x = 0;
  y = 0;
  buttons = 0;
  mouseAccessed = false;
  constructor(private readonly dos: () => boolean) {
    this.io = [
      {
        lowMask: 255,
        lowValue: 0x1f,
        selected: () => !this.dos(),
        read: () => this.joystick & 31,
      },
      ...[0, 1, 5].map(
        (reg): IoClaim => ({
          priority: 10,
          blockLower: true,
          lowMask: 255,
          lowValue: 0xdf,
          highMask: 5,
          highValue: reg,
          selected: () => !this.dos() && this.settings.mouseEnabled,
          read: () =>
            reg === 1
              ? this.x & 255
              : reg === 5
                ? this.y & 255
                : this.buttonByte(),
        }),
      ),
    ];
  }
  observeRead(address: number) {
    if (!this.dos() && (address & 255) === 0xdf && ((address >>> 8) & 5) !== 4)
      this.mouseAccessed = true;
  }
  private buttonByte() {
    // Unused active-low lines remain high. Software can probe the full byte
    // (OPTRON 4.1 requires idle 0xFF before enabling its movement handlers).
    const left = this.settings.swapButtons ? 0 : 1;
    const right = this.settings.swapButtons ? 1 : 0;
    return (
      0xff &
      ~(
        (this.buttons & 1 ? 1 << left : 0) |
        (this.buttons & 4 ? 4 : 0) |
        (this.buttons & 2 ? 1 << right : 0)
      )
    );
  }
  input(input: KempstonInput) {
    switch (input.action) {
      case "settings":
        this.settings = sanitizeKempston(input.settings);
        this.buttons = 0;
        break;
      case "joystick":
        this.joystick = input.bits & 31;
        break;
      case "motion":
        if (
          !this.dos() &&
          this.settings.mouseEnabled &&
          Number.isFinite(input.dx) &&
          Number.isFinite(input.dy)
        ) {
          this.x = (((this.x + input.dx) % 256) + 256) % 256;
          this.y = (((this.y - input.dy) % 256) + 256) % 256;
        }
        break;
      case "buttons":
        this.buttons =
          !this.dos() && this.settings.mouseEnabled ? input.buttons & 7 : 0;
        break;
      case "release":
        this.buttons = 0;
        this.joystick = 0;
        break;
    }
  }
  reset() {
    this.input({ action: "release" });
    this.x = this.y = 0;
    this.mouseAccessed = false;
  }
}
