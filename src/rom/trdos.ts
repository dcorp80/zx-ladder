import type { Z80Cpu } from "@dcorp80/z80cpu";
import type { BetaDisk } from "../devices/betaDisk";
import type { BankedMemory } from "../devices/memory";
import { type TrdFile, trdBasic } from "../files/trd";
export const ROM_REQUIRED = "You need to provide TR-DOS ROM";
/** CPU-only instruction overlay. Returns execute on the real stack. */
export class TrdosService {
  private program: number[] = [];
  private base = 0;
  private offset = 0;
  prepareBasic?: TrdFile;
  constructor(
    private memory: BankedMemory,
    private disk: BetaDisk,
  ) {}
  reset() {
    this.program = [];
    this.offset = 0;
    this.prepareBasic = undefined;
    this.ramProgram = [];
  }
  private word(a: number) {
    return this.memory.read(a) | (this.memory.read(a + 1) << 8);
  }
  private put(a: number, v: number) {
    this.memory.write(a, v);
    this.memory.write(a + 1, v >>> 8);
  }
  /** Reserve DOS workspace before 48K loading or after the 128K data return. */
  basicReady() {
    if (!this.prepareBasic) return;
    const file = this.prepareBasic;
    this.prepareBasic = undefined;
    const prog = this.word(0x5c53),
      end = this.word(0x5c65);
    if (prog >= 0x5d3b) {
      this.nextFile(file);
      return;
    }
    if (prog !== 0x5ccb || end < prog || end + 0x70 >= this.word(0x5cb2))
      throw new Error("BASIC workspace is not ready for disk loading.");
    const shift = 0x5d3b - prog;
    for (let p = end; p >= prog; p--)
      this.memory.write(p + shift, this.memory.read(p));
    for (const a of [
      0x5c4b, 0x5c53, 0x5c59, 0x5c5b, 0x5c5d, 0x5c61, 0x5c63, 0x5c65,
    ]) {
      const value = this.word(a);
      if (value >= prog && value <= end + 1) this.put(a, value + shift);
    }
    for (let p = prog; p < 0x5d3b; p++) this.memory.write(p, 0);
    this.memory.write(0x5d06, 9);
    this.nextFile(file);
  }
  read(address: number, opcode: boolean, cpu: Z80Cpu): number | undefined {
    if (this.program.length && address === this.base + this.offset) {
      const value = this.program[this.offset++];
      if (this.offset === this.program.length) this.program = [];
      return value;
    }
    if (!this.disk.dosEnabled || this.disk.rom) return undefined;
    if (!opcode) {
      if (address < 0x4000) this.required();
      return undefined;
    }
    if (address !== 0x3d03 && address !== 0x3d13 && address !== 0x3d21)
      this.required();
    const state = cpu.snapshot(),
      r = { ...state.main };
    let error = 0;
    const command = r.c;
    if (!this.disk.ready) error = 6;
    else if (address === 0x3d03) this.basicCommand();
    else if (address === 0x3d21) this.initialize();
    else {
      const hl = (r.h << 8) | r.l;
      switch (r.c) {
        case 0:
          this.disk.head = this.disk.track = 0;
          break;
        case 1:
          this.disk.system = (this.disk.system & ~3) | (r.a & 3);
          this.memory.write(0x5cf6, r.a & 3);
          if (!this.disk.ready) error = 6;
          break;
        case 2:
          this.disk.head = this.disk.track = Math.floor(
            r.a / this.disk.geometry.sides,
          );
          break;
        case 3:
          this.memory.write(0x5cff, r.a);
          break;
        case 4:
          this.put(0x5d00, hl);
          break;
        case 5:
        case 6: {
          if (!r.b) this.required(); // Sector-header inspection requires real ROM.
          const sector = r.d * 16 + r.e,
            offset = sector * 256,
            count = r.b * 256;
          if (
            r.e > 15 ||
            offset + count >
              this.disk.geometry.tracks * this.disk.geometry.sides * 4096 ||
            hl < 0x4000 ||
            hl + count > 65536
          ) {
            error = 5;
            break;
          }
          if (r.c === 6 && offset + count > this.disk.image.length) {
            const expanded = new Uint8Array(offset + count);
            expanded.set(this.disk.image);
            this.disk.bytes = expanded;
          }
          for (let i = 0; i < count; i++) {
            if (r.c === 5)
              this.memory.write(hl + i, this.disk.image[offset + i] ?? 0);
            else this.disk.image[offset + i] = this.memory.read(hl + i);
          }
          if (r.c === 6) this.disk.changed();
          const next = sector + r.b;
          r.d = Math.floor(next / 16);
          r.e = next % 16;
          r.h = ((hl + count) >>> 8) & 255;
          r.l = (hl + count) & 255;
          r.b = 0;
          this.memory.write(0x5cf4, r.e);
          this.memory.write(0x5cf5, r.d);
          this.put(0x5d00, hl + count);
          break;
        }
        case 8:
          if (r.a >= 128) {
            error = 3;
            break;
          }
          for (let i = 0; i < 16; i++)
            this.memory.write(0x5cdd + i, this.disk.image[r.a * 16 + i]);
          this.memory.write(0x5d0f, r.a);
          break;
        case 0x0a: {
          const count = this.memory.read(0x5d06);
          if (count < 1 || count > 16) this.required();
          const file = this.disk.state.catalog.find((f) => {
            for (let i = 0; i < count; i++)
              if (
                this.disk.image[f.index * 16 + i] !==
                this.memory.read(0x5cdd + i)
              )
                return false;
            return true;
          });
          r.c = file?.index ?? 255;
          this.memory.write(0x5d0f, r.c);
          r.f = file ? 0x40 : 0;
          break;
        }
        case 0x0e: {
          // Standard descriptor load. Exotic modes/internal entry points require ROM.
          const file = this.findDescriptor();
          if (!file) {
            error = 3;
            break;
          }
          if (this.memory.read(0x5cf9) !== 0) this.required();
          if (file.ext === "B") this.loadBasic(file, false);
          else
            this.loadCode(
              file,
              r.a === 0 || r.a === 3 ? file.parameter : hl,
              r.a === 0 || r.a === 3 ? file.length : (r.d << 8) | r.e,
            );
          break;
        }
        case 0x13:
        case 0x14:
          for (let i = 0; i < 16; i++) {
            if (r.c === 0x13)
              this.memory.write(0x5cdd + i, this.memory.read((hl + i) & 65535));
            else
              this.memory.write((hl + i) & 65535, this.memory.read(0x5cdd + i));
          }
          break;
        case 0x17:
          this.disk.system |= 16;
          break;
        case 0x18:
          this.initialize();
          break;
        default:
          this.required();
      }
    }
    if (error || command !== 0x0a || address !== 0x3d13)
      this.memory.write(0x5d0f, error);
    if (error || command !== 0x0a || address !== 0x3d13) {
      r.a = error;
      r.f = error ? 1 : 0x40;
    }
    // DI; JP 4000. RAM fetch pages DOS out; the CPU-only overlay does not
    // overwrite screen RAM. Restore register outputs and RET through real stack.
    const ram = [
      0x21,
      r.f,
      r.a,
      0xe5,
      0xf1,
      0x01,
      r.c,
      r.b,
      0x11,
      r.e,
      r.d,
      0x21,
      r.l,
      r.h,
      ...(state.iff1 ? [0xfb] : []),
      0xc9,
    ];
    this.program = [0xf3, 0xc3, 0x00, 0x40];
    this.base = address;
    this.offset = 1;
    this.ramProgram = ram;
    return this.program[0];
  }
  private ramProgram: number[] = [];
  fetchRam(address: number, opcode: boolean) {
    if (address === 0x4000 && opcode && this.ramProgram.length) {
      this.program = this.ramProgram;
      this.ramProgram = [];
      this.base = address;
      this.offset = 0;
    }
  }
  private required(): never {
    this.disk.romRequired = true;
    throw new Error(ROM_REQUIRED);
  }
  private initialize() {
    this.memory.write(0x5d06, 9);
    this.memory.write(0x5cf6, 0);
    this.memory.write(0x5cf8, 0);
    this.memory.write(0x5cf9, 0);
    this.memory.write(0x5d19, 0);
    this.memory.write(0x5d16, 0x3c);
  }
  private findDescriptor() {
    return this.disk.state.catalog.find((f) => {
      for (let i = 0; i < 9; i++)
        if (this.disk.image[f.index * 16 + i] !== this.memory.read(0x5cdd + i))
          return false;
      return true;
    });
  }
  private loadCode(file: TrdFile, address: number, length: number) {
    if (
      length > file.length ||
      file.offset + length > this.disk.image.length ||
      address < 0x4000 ||
      address + length > 65536
    )
      this.required();
    for (let i = 0; i < length; i++)
      this.memory.write(address + i, this.disk.image[file.offset + i]);
    this.nextFile(file, length);
  }
  private nextFile(file: TrdFile, length = file.parameter) {
    // Packed multiloaders allocate many sectors but load only their BASIC stub.
    // DOS tracks the next sector actually read, not the end of the allocation.
    // The ROM file loader reads floor(length/256)+1 sectors, including an extra
    // sector for exact multiples. Some loaders deliberately back up that sector.
    const next = file.offset / 256 + Math.floor(length / 256) + 1;
    this.memory.write(0x5cf4, next % 16);
    this.memory.write(0x5cf5, Math.floor(next / 16));
  }
  private loadBasic(file: TrdFile, run: boolean) {
    let basic: ReturnType<typeof trdBasic>;
    try {
      basic = trdBasic(this.disk.image, file);
    } catch {
      this.required();
    }
    const prog = this.word(0x5c53);
    if (prog < 0x5d3b || prog + basic.data.length + 8 >= this.word(0x5cb2))
      this.required();
    for (let i = 0; i < basic.data.length; i++)
      this.memory.write(prog + i, basic.data[i]);
    const end = prog + basic.data.length;
    this.memory.write(end, 0x80);
    this.memory.write(end + 1, 13);
    this.put(0x5c4b, prog + basic.programLength);
    this.put(0x5c59, end + 1);
    this.put(0x5c61, end + 2);
    this.put(0x5c63, end + 2);
    this.put(0x5c65, end + 2);
    if (run || basic.line) {
      this.put(0x5c42, basic.line);
      this.memory.write(0x5c44, 0);
    }
    this.nextFile(file);
  }
  private basicCommand() {
    const start = this.word(0x5c5d);
    let command = "",
      ended = false;
    const tokens: Record<number, string> = {
      239: " LOAD ",
      247: " RUN ",
      175: " CODE ",
      234: " REM ",
      176: " VAL ",
    };
    for (let p = start; p < Math.min(start + 256, 65536); p++) {
      const b = this.memory.read(p);
      if (b === 13) {
        ended = true;
        break;
      }
      if (b === 14) {
        p += 5;
        continue;
      }
      command += tokens[b] ?? String.fromCharCode(b);
    }
    if (!ended) this.required();
    // BASIC loaders commonly use CODE VAL "25088" to avoid stored numbers.
    // Support literal decimal strings, without evaluating arbitrary expressions.
    const number = '(?:[0-9]+|VAL\\s*"\\s*[0-9]+\\s*")';
    const match = command.match(
      new RegExp(
        '^\\s*(?::?\\s*REM\\s*:?)?\\s*(LOAD|RUN)\\s*"([^"\\r]{1,8})"\\s*' +
          "(CODE(?:\\s*(" +
          number +
          ")(?:\\s*,\\s*(" +
          number +
          "))?)?)?\\s*$",
        "i",
      ),
    );
    const numericValue = (value: string) =>
      Number(value.replace(/^VAL\s*"(.*)"$/i, "$1").trim());
    if (!match) this.required();
    const file = this.disk.state.catalog.find(
      (f) =>
        f.name.toLowerCase() === match[2].toLowerCase() &&
        f.ext === (match[3] ? "C" : "B"),
    );
    if (!file) this.required();
    if (match[3])
      this.loadCode(
        file,
        match[4] === undefined ? file.parameter : numericValue(match[4]),
        match[5] === undefined ? file.length : numericValue(match[5]),
      );
    else this.loadBasic(file, match[1].toUpperCase() === "RUN");
  }
}
