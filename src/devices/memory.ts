import type { Device, MemoryClaim } from "../machine/devices";
export const ROM_SIZE = 16384;
export function validateRom(rom: Uint8Array): void {
  if (rom.length !== ROM_SIZE)
    throw new RangeError("Choose a 16 KiB (16,384-byte) ROM file.");
}
export class BankedMemory implements Device {
  readonly id = "memory";
  readonly banks: number[][];
  readonly memory: readonly MemoryClaim[];
  constructor(rom: Uint8Array) {
    validateRom(rom);
    this.banks = Array.from({ length: 4 }, () =>
      new Array<number>(ROM_SIZE).fill(0xff),
    );
    for (let i = 0; i < ROM_SIZE; i++) this.banks[0][i] = rom[i];
    this.memory = [
      {
        start: 0,
        end: 0xffff,
        read: (a) => this.read(a),
        write: (a, v) => this.write(a, v),
      },
    ];
  }
  read(address: number): number {
    return this.banks[(address & 0xffff) >>> 14][address & 0x3fff];
  }
  write(address: number, value: number): void {
    const bank = (address & 0xffff) >>> 14;
    if (bank !== 0) this.banks[bank][address & 0x3fff] = value & 255;
  }
}
