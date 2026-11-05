import type { Device, IoClaim } from "../machine/devices";
import type { BankedMemory } from "./memory";

/** Paging latch: no work on the memory-read path. */
export class Mcu implements Device {
  readonly id = "mcu";
  readonly io: readonly IoClaim[];
  latch = 0;
  constructor(
    private readonly storage: BankedMemory,
    public decodeFd = false,
    private readonly romChanged: () => void = () => {},
  ) {
    this.io = [
      {
        // Standard 128K/Pentagon paging decodes only A15 and A1.
        lowMask: 2,
        lowValue: 0,
        selected: (address) =>
          this.decodeFd ? (address & 255) === 0xfd : (address & 0x8000) === 0,
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
  reset(): void {
    this.latch = 0;
    this.storage.map(0);
  }
}
