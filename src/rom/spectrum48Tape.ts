import type { Z80Cpu } from "@dcorp80/z80cpu";
import type { KeyboardDevice, SpectrumKey } from "../devices/keyboard";
import type { BankedMemory } from "../devices/memory";
import type { TapBlock } from "../files/tap";
import { parseTape } from "../files/tape";
import { MENU_128_POLL, supports128TapeMenu } from "./spectrum128Tape";

export const TAPE_ROM_SIGNATURE = [
  0xf5, 0x3a, 0x48, 0x5c, 0xe6, 0x38, 0x0f, 0x0f, 0x0f, 0xd3, 0xfe, 0x3e, 0x7f,
  0xdb, 0xfe, 0x1f, 0xfb, 0x38, 0x02, 0xcf, 0x0c, 0xf1, 0xc9, 0x14, 0x08, 0x15,
  0xf3, 0x3e, 0x0f, 0xd3, 0xfe, 0x21, 0x3f, 0x05, 0xe5, 0xdb, 0xfe, 0x1f, 0xe6,
  0x20, 0xf6, 0x02, 0x4f, 0xbf, 0xc0, 0xcd, 0xe7, 0x05,
];
const OWNER = "tape-auto-load";
const MENU_COMMAND: readonly (readonly SpectrumKey[])[] = [["ENTER"]];
const COMMAND: readonly (readonly SpectrumKey[])[] = [
  ["J"],
  ["SYMBOL_SHIFT", "P"],
  ["SYMBOL_SHIFT", "P"],
  ["ENTER"],
];

/** Shared 48K/128K ROM tape service. Never writes CPU registers, sequencer state, or ROM. */
export class Spectrum48Tape {
  private readonly compatible: boolean[];
  get supported(): boolean {
    return this.compatible[this.memory.romIndex];
  }
  readonly supports128Menu: boolean;
  get canMount(): boolean {
    return this.supports128Menu || this.supported;
  }
  status = "No tape mounted.";
  private menuAutoLoad = false;
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
    this.compatible = memory.romPages.map(
      (rom) =>
        TAPE_ROM_SIGNATURE.every((b, i) => rom[0x053f + i] === b) &&
        [0xfd, 0xcb, 0x02, 0x5e].every((b, i) => rom[0x10a8 + i] === b),
    );
    this.supports128Menu =
      memory.expanded &&
      this.compatible[1] &&
      supports128TapeMenu(memory.romPages[0]);
    keyboard.subscribe(() => {
      if (this.typing && this.phase >= 0 && keyboard.hasOtherSources(OWNER)) {
        this.cancel();
        this.status = "Automatic typing cancelled by keyboard input.";
      }
    });
  }
  mount(bytes: Uint8Array, name: string): void {
    if (!this.canMount)
      throw new Error("This ROM is not supported by the flash tape loader.");
    const blocks = parseTape(bytes, name, this.memory.expanded);
    this.cancel();
    this.menuAutoLoad = this.supports128Menu && this.memory.romIndex === 0;
    this.blocks = blocks;
    this.cursor = 0;
    this.typing = true;
    this.ready = false;
    this.age = 0;
    this.phase = -1;
    this.delay = 0;
    this.status = `${name}: waiting for ${this.menuAutoLoad ? "128K Tape Loader menu" : "BASIC"}…`;
  }
  cancel(): void {
    this.typing = false;
    this.keyboard.release(OWNER);
    this.program = null;
    this.offset = 0;
  }
  /** Normal ROM paging must retain the mounted tape, cursor and menu key press. */
  romChanged(): void {
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
      this.status = `${this.menuAutoLoad ? "128K menu" : "BASIC"} readiness timed out. Load again to retry.`;
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
    const command = this.menuAutoLoad ? MENU_COMMAND : COMMAND;
    if (this.phase >= command.length * 2) {
      this.typing = false;
      this.status = this.menuAutoLoad
        ? "Tape Loader selected; waiting for ROM tape reads…"
        : "LOAD command entered; waiting for ROM tape reads…";
      return;
    }
    if (this.phase % 2 === 0)
      this.keyboard.press(OWNER, command[this.phase / 2]);
    this.delay = 3;
    this.status = this.menuAutoLoad
      ? "Selecting 128K Tape Loader…"
      : 'Typing LOAD ""…';
  }
  /** Called only on a CPU memory read request; undefined means normal bus data. */
  read(address: number, opcode: boolean, cpu: Z80Cpu): number | undefined {
    if (
      this.typing &&
      opcode &&
      this.menuAutoLoad &&
      this.memory.romIndex === 0 &&
      address === MENU_128_POLL
    )
      this.ready = true;
    if (!this.supported) return undefined;
    if (opcode && address === 0x10a8 && this.typing && !this.menuAutoLoad)
      this.ready = true;
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
