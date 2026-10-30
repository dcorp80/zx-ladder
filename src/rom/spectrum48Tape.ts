import type { Z80Cpu } from "@dcorp80/z80cpu";
import type { KeyboardDevice, SpectrumKey } from "../devices/keyboard";
import type { BankedMemory } from "../devices/memory";
import type { TapBlock } from "../files/tap";
import { parseTape } from "../files/tape";

export const TAPE_ROM_SIGNATURE = [
  0xf5, 0x3a, 0x48, 0x5c, 0xe6, 0x38, 0x0f, 0x0f, 0x0f, 0xd3, 0xfe, 0x3e, 0x7f,
  0xdb, 0xfe, 0x1f, 0xfb, 0x38, 0x02, 0xcf, 0x0c, 0xf1, 0xc9, 0x14, 0x08, 0x15,
  0xf3, 0x3e, 0x0f, 0xd3, 0xfe, 0x21, 0x3f, 0x05, 0xe5, 0xdb, 0xfe, 0x1f, 0xe6,
  0x20, 0xf6, 0x02, 0x4f, 0xbf, 0xc0, 0xcd, 0xe7, 0x05,
];
const OWNER = "tape-auto-load";
const COMMAND: readonly (readonly SpectrumKey[])[] = [
  ["J"],
  ["SYMBOL_SHIFT", "P"],
  ["SYMBOL_SHIFT", "P"],
  ["ENTER"],
];

/** Optional ROM service. Never writes CPU registers, sequencer state, or ROM. */
export class Spectrum48Tape {
  readonly supported: boolean;
  status = "No tape mounted.";
  private blocks: TapBlock[] | null = null;
  private cursor = 0;
  private program: number[] | null = null;
  private offset = 0;
  private typing = false;
  private ready = false;
  private age = 0;
  private phase = -1;
  private delay = 0;
  constructor(
    private readonly memory: BankedMemory,
    private readonly keyboard: KeyboardDevice,
  ) {
    this.supported =
      TAPE_ROM_SIGNATURE.every((b, i) => memory.read(0x053f + i) === b) &&
      [0xfd, 0xcb, 0x02, 0x5e].every((b, i) => memory.read(0x10a8 + i) === b);
    keyboard.subscribe(() => {
      if (this.typing && this.phase >= 0 && keyboard.hasOtherSources(OWNER)) {
        this.cancel();
        this.status = "Automatic typing cancelled by keyboard input.";
      }
    });
  }
  mount(bytes: Uint8Array, name: string): void {
    if (!this.supported)
      throw new Error("This ROM is not supported by the 48K flash loader.");
    const blocks = parseTape(bytes, name);
    this.cancel();
    this.blocks = blocks;
    this.cursor = 0;
    this.typing = true;
    this.ready = false;
    this.age = 0;
    this.phase = -1;
    this.delay = 0;
    this.status = `${name}: waiting for BASIC…`;
  }
  cancel(): void {
    this.typing = false;
    this.keyboard.release(OWNER);
    this.program = null;
    this.offset = 0;
  }
  reset(): void {
    this.cancel();
    this.status = this.blocks
      ? "Tape mounted; automatic loading cancelled."
      : "No tape mounted.";
  }
  frame(): void {
    if (!this.typing) return;
    if (++this.age > 600) {
      this.cancel();
      this.status = "BASIC readiness timed out. Load again to retry.";
      return;
    }
    if (this.keyboard.hasOtherSources(OWNER)) {
      if (this.phase >= 0) {
        this.cancel();
        this.status = "Automatic typing cancelled by keyboard input.";
      }
      return;
    }
    if (!this.ready || this.age < 8) return;
    if (this.delay-- > 0) return;
    this.keyboard.release(OWNER);
    this.phase++;
    if (this.phase >= COMMAND.length * 2) {
      this.typing = false;
      this.status = "LOAD command entered; waiting for ROM tape reads…";
      return;
    }
    if (this.phase % 2 === 0)
      this.keyboard.press(OWNER, COMMAND[this.phase / 2]);
    this.delay = 3;
    this.status = 'Typing LOAD ""…';
  }
  /** Called only on a CPU memory read request; undefined means normal bus data. */
  read(address: number, opcode: boolean, cpu: Z80Cpu): number | undefined {
    if (opcode && address === 0x10a8 && this.typing) this.ready = true;
    if (this.program) {
      if (address === 0x056c + this.offset) {
        const value = this.program[this.offset++];
        if (this.offset === this.program.length) this.program = null;
        return value;
      }
      // No stack or unrelated memory reads may observe the instruction overlay.
      return undefined;
    }
    if (!this.blocks || !opcode || address !== 0x056c) return undefined;
    const state = cpu.snapshot();
    // The ROM entry contract keeps the request in AF'. Custom loaders can
    // enter here with their own return address, bypassing the ROM cleanup.
    // RET must use the real stack rather than require a particular caller.
    this.typing = false;
    this.keyboard.release(OWNER);
    const length = (state.main.d << 8) | state.main.e;
    const block = this.blocks[this.cursor++];
    let copied = 0;
    let success = false;
    let reason = "End of tape";
    if (block && block.flag === state.alt.a) {
      const loading = (state.alt.f & 1) !== 0;
      const available = Math.min(length, block.payload.length);
      for (; copied < available; copied++) {
        const address = (state.ix + copied) & 0xffff;
        const byte = block.payload[copied];
        if (loading) this.memory.write(address, byte);
        else if (this.memory.read(address) !== byte) break;
      }
      success =
        copied === length &&
        block.payload.length === length &&
        block.checksumValid;
      reason =
        copied < available
          ? "VERIFY mismatch"
          : block.payload.length !== length
            ? "Tape block length mismatch"
            : "Tape checksum error";
    } else if (block) reason = "Tape block flag mismatch";
    const ix = (state.ix + copied) & 0xffff,
      remaining = (length - copied) & 0xffff;
    // EX AF,AF'; LD IX,result; LD DE,remainder; LD A,result; CP 1; RET.
    // RET reaches either the ROM cleanup or the custom loader on the real stack.
    this.program = [
      0x08,
      0xdd,
      0x21,
      ix & 255,
      ix >>> 8,
      0x11,
      remaining & 255,
      remaining >>> 8,
      0x3e,
      success ? 0 : 1,
      0xfe,
      0x01,
      0xc9,
    ];
    this.offset = 1;
    this.status = success
      ? `Block ${this.cursor}/${this.blocks.length} loaded${this.cursor === this.blocks.length ? "; end of tape" : ""}.`
      : `${reason} (block ${this.cursor}).`;
    return this.program[0];
  }
}
