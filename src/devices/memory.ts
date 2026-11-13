import type { Device, MemoryClaim } from "../machine/devices";
export interface MemoryMapping {
  ramPage: number;
  romPage: number;
  screenPage: number;
}
export const ROM_SIZE = 16384;
export function validateRom(rom: Uint8Array): void {
  if (rom.length !== ROM_SIZE && rom.length !== ROM_SIZE * 2)
    throw new RangeError("Choose a 16 KiB or 32 KiB ROM file.");
}
export class BankedMemory implements Device {
  readonly id = "memory";
  /** Active CPU slots; entries alias physical pages, never copies. */
  readonly banks: number[][];
  readonly ramPages: number[][];
  readonly romPages: number[][];
  readonly expanded: boolean;
  romIndex = 0;
  dosRom?: number[];
  private screen: number[];
  /** Paired physical page; updated with paging, never resolved via status. */
  private alternateScreen: number[];
  readonly memory: readonly MemoryClaim[];
  constructor(rom: Uint8Array) {
    validateRom(rom);
    this.expanded = rom.length === ROM_SIZE * 2;
    this.ramPages = Array.from({ length: 8 }, () =>
      new Array<number>(ROM_SIZE).fill(0xff),
    );
    this.romPages = [Array.from(rom.subarray(0, ROM_SIZE))];
    if (this.expanded) this.romPages.push(Array.from(rom.subarray(ROM_SIZE)));
    this.banks = [
      this.romPages[0],
      this.ramPages[5],
      this.ramPages[2],
      this.ramPages[0],
    ];
    this.screen = this.ramPages[5];
    this.alternateScreen = this.ramPages[4];
    this.memory = [
      {
        start: 0,
        end: 0xffff,
        read: (a) => this.read(a),
        write: (a, v) => this.write(a, v),
      },
    ];
  }
  /** Snapshot for status reporting; never used on the memory-access path. */
  get mapping(): MemoryMapping {
    return {
      ramPage: this.ramPages.indexOf(this.banks[3]),
      romPage: this.romIndex,
      screenPage: this.ramPages.indexOf(this.screen),
    };
  }
  map(latch: number): void {
    if (!this.expanded) return;
    this.romIndex = (latch >>> 4) & 1;
    this.banks[0] = this.romPages[this.romIndex];
    this.banks[3] = this.ramPages[latch & 7];
    const screenPage = latch & 8 ? 7 : 5;
    this.screen = this.ramPages[screenPage];
    this.alternateScreen = this.ramPages[screenPage ^ 1];
  }
  /** Physical video access, independent of CPU mappings and overlays. */
  readonly readScreen = (address: number): number =>
    this.screen[address & 0x3fff];
  /** Extended video A14 switches the low physical page bit, not CPU paging. */
  readonly readExtendedScreen = (address: number): number =>
    (address & 0x4000 ? this.alternateScreen : this.screen)[address & 0x3fff];
  read(address: number): number {
    return (
      (address & 0xc000) === 0 && this.dosRom
        ? this.dosRom
        : this.banks[(address & 0xffff) >>> 14]
    )[address & 0x3fff];
  }
  write(address: number, value: number): void {
    const bank = (address & 0xffff) >>> 14;
    // Gate nWR for A15:A14 = 00. Future RAM-at-zero modes can replace this gate.
    if (bank !== 0) this.banks[bank][address & 0x3fff] = value & 255;
  }
}
