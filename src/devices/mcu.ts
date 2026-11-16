import type { Device, IoClaim } from "../machine/devices";
import type { BankedMemory } from "./memory";

/** Paging latch: no work on the memory-read path. */
export class Mcu implements Device {
  readonly id = "mcu";
  readonly io: readonly IoClaim[];
  latch = 0;
  constructor(
    private readonly storage: BankedMemory,
    private readonly romChanged: () => void = () => {},
  ) {
    this.io = [
      {
        // Standard 128K/Pentagon paging decodes only A15 and A1.
        lowMask: 2,
        lowValue: 0,
        highMask: 0x80,
        highValue: 0,
        write: (_address, value) => this.write(value),
      },
    ];
  }
  write(value: number): void {
    if (this.latch & 0x20) return;
    const next = value & 0x3f;
    if (next === this.latch) return;
    const changedRom = (next ^ this.latch) & 0x10;
    this.latch = next;
    this.storage.map(next);
    if (changedRom) this.romChanged();
  }
  reset(value = 0): void {
    this.latch = value & 0x3f;
    this.storage.map(this.latch);
  }
}
