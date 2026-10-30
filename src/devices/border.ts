import type { Device, IoClaim } from "../machine/devices";
export class BorderDevice implements Device {
  readonly id = "border";
  /** Full FE output latch: D0–D2 border, D3 MIC, D4 beeper. */
  value = 0;
  get color(): number {
    return this.value & 7;
  }
  set color(color: number) {
    this.value = (this.value & 0xf8) | (color & 7);
  }
  readonly io: readonly IoClaim[];
  constructor(mask = 1, value = 0) {
    this.io = [
      {
        lowMask: mask,
        lowValue: value,
        write: (_a, data) => {
          this.value = data & 255;
        },
      },
    ];
  }
}
