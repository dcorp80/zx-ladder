import {
  type TrdFile,
  type TrdGeometry,
  trdBasic,
  trdCatalog,
  trdGeometry,
} from "../files/trd";
import type { Device, IoClaim } from "../machine/devices";
export interface DiskState {
  id: string;
  name: string;
  dirty: boolean;
  catalog: TrdFile[];
  romRequired: boolean;
  dosEnabled: boolean;
}
/** Functional sector controller: immediate seeks and demand-driven transfers. */
export class BetaDisk implements Device {
  readonly id = "beta-disk";
  readonly io: IoClaim[];
  bytes?: Uint8Array;
  geometry: TrdGeometry = { tracks: 80, sides: 2 };
  fileId = "";
  name = "";
  dirty = false;
  romRequired = false;
  dosEnabled = false;
  rom?: number[];
  track = 0;
  sector = 1;
  data = 0;
  system = 4;
  head = 0;
  status = 0;
  intrq = false;
  private type1 = true;
  private direction = 1;
  private buffer?: Uint8Array;
  private position = 0;
  private writeOffset = -1;
  private multi = false;
  private catalogCache: TrdFile[] = [];
  get image(): Uint8Array {
    if (!this.bytes) throw new Error("No disk mounted.");
    return this.bytes;
  }
  get drive() {
    return this.system & 3;
  }
  get side() {
    return this.system & 16 ? 0 : 1;
  }
  get ready() {
    return this.drive === 0 && !!this.bytes;
  }
  constructor(private readonly ticks: () => number = () => 0) {
    this.io = [0x1f, 0x3f, 0x5f, 0x7f, 0xff].map((lowValue) => ({
      lowMask: 255,
      lowValue,
      priority: 100,
      blockLower: true,
      selected: () => this.dosEnabled,
      read: () => this.read(lowValue),
      write: (_a, v) => this.write(lowValue, v),
    }));
  }
  private catalog(bytes: Uint8Array): TrdFile[] {
    return trdCatalog(bytes).map((file) => {
      if (file.ext !== "B") return file;
      try {
        trdBasic(bytes, file);
        return file;
      } catch (error) {
        return {
          ...file,
          warning:
            error instanceof Error ? error.message : "Invalid BASIC metadata",
        };
      }
    });
  }
  get state(): DiskState {
    return {
      id: this.fileId,
      name: this.name,
      dirty: this.dirty,
      catalog: this.catalogCache,
      romRequired: this.romRequired,
      dosEnabled: this.dosEnabled,
    };
  }
  mount(bytes: Uint8Array, id: string, name: string) {
    const geometry = trdGeometry(bytes);
    const active = this.dosEnabled;
    this.bytes = bytes.slice();
    this.geometry = geometry;
    this.fileId = id;
    this.name = name;
    this.dirty = false;
    this.catalogCache = this.catalog(bytes);
    this.reset();
    this.dosEnabled = active;
  }
  eject() {
    const active = this.dosEnabled;
    this.bytes = undefined;
    this.fileId = this.name = "";
    this.dirty = false;
    this.catalogCache = [];
    this.reset();
    this.dosEnabled = active;
  }
  reset() {
    this.dosEnabled = false;
    this.romRequired = false;
    this.system = 0x14;
    this.track = this.head = 0;
    this.sector = 1;
    this.data = this.status = 0;
    this.intrq = false;
    this.buffer = undefined;
    this.multi = false;
    this.writeOffset = -1;
  }
  setRom(bytes: Uint8Array | null) {
    if (bytes === null) {
      this.rom = undefined;
      return;
    }
    if (bytes.length !== 16384)
      throw new Error("TR-DOS ROM must be exactly 16 KiB.");
    this.rom = Array.from(bytes);
    this.romRequired = false;
  }
  changed() {
    this.dirty = true;
    this.catalogCache = this.bytes ? this.catalog(this.bytes) : [];
  }
  private finish(error = 0) {
    this.status = error;
    this.intrq = true;
    this.buffer = undefined;
    this.writeOffset = -1;
  }
  private transfer(write: boolean) {
    if (!this.ready) {
      this.finish(0x80);
      return;
    }
    if (
      this.track !== this.head ||
      this.head >= this.geometry.tracks ||
      this.side >= this.geometry.sides ||
      this.sector < 1 ||
      this.sector > 16
    ) {
      this.finish(0x10);
      return;
    }
    const offset =
      ((this.head * this.geometry.sides + this.side) * 16 + this.sector - 1) *
      256;
    this.buffer = new Uint8Array(256);
    if (!write) this.buffer.set(this.image.subarray(offset, offset + 256));
    this.writeOffset = write ? offset : -1;
    this.position = 0;
    this.status = 3;
  }
  read(port: number): number {
    switch (port) {
      case 0x1f: {
        const value =
          (this.ready ? this.status : 0x80) |
          (this.type1 && this.head === 0 ? 4 : 0) |
          (this.type1 && this.ready ? 0x20 : 0) |
          (this.type1 && this.ready && this.ticks() % 1400000 < 28000 ? 2 : 0);
        this.intrq = false;
        return value;
      }
      case 0x3f:
        return this.track;
      case 0x5f:
        return this.sector;
      case 0xff:
        return (this.intrq ? 128 : 0) | (this.buffer ? 64 : 0);
      case 0x7f:
        if (this.buffer && this.writeOffset < 0) {
          this.data = this.buffer[this.position++];
          this.nextByte(false);
        }
        return this.data;
    }
    return 255;
  }
  private nextByte(write: boolean) {
    if (!this.buffer || this.position < this.buffer.length) return;
    if (write) {
      const end = this.writeOffset + this.buffer.length;
      if (end > this.image.length) {
        const expanded = new Uint8Array(end);
        expanded.set(this.image);
        this.bytes = expanded;
      }
      this.image.set(this.buffer, this.writeOffset);
      this.changed();
    }
    if (this.multi && ++this.sector <= 16) this.transfer(write);
    else this.finish();
  }
  write(port: number, value: number) {
    switch (port) {
      case 0x3f:
        this.track = value;
        return;
      case 0x5f:
        this.sector = value;
        return;
      case 0x7f:
        this.data = value;
        if (this.buffer && this.writeOffset >= 0) {
          this.buffer[this.position++] = value;
          this.nextByte(true);
        }
        return;
      case 0xff:
        if (!(value & 4)) {
          const active = this.dosEnabled;
          this.reset();
          this.dosEnabled = active;
        } else if (this.buffer && (value ^ this.system) & 0x13) this.finish(4);
        this.system = value;
        return;
      case 0x1f:
        this.command(value);
    }
  }
  private command(value: number) {
    this.buffer = undefined;
    this.writeOffset = -1;
    this.multi = false;
    this.intrq = false;
    if ((value & 0xf0) === 0xd0) {
      this.status = 0;
      this.intrq = !!(value & 8);
      return;
    }
    this.type1 = !(value & 128);
    if (!this.ready) {
      this.finish(128);
      return;
    }
    if (this.type1) {
      if ((value & 0xf0) === 0) this.track = this.head = 0;
      else if ((value & 0xf0) === 0x10) this.track = this.head = this.data;
      else {
        if ((value & 0xe0) === 0x40) this.direction = 1;
        if ((value & 0xe0) === 0x60) this.direction = -1;
        this.head = Math.max(
          0,
          Math.min(this.geometry.tracks - 1, this.head + this.direction),
        );
        if (value & 0x10) this.track = this.head;
      }
      this.finish(this.head >= this.geometry.tracks ? 0x10 : 0);
      return;
    }
    if ((value & 0xc0) === 0x80) {
      this.multi = !!(value & 16);
      this.transfer(!!(value & 32));
      return;
    }
    if ((value & 0xf0) === 0xc0) {
      this.buffer = new Uint8Array([
        this.head,
        this.side,
        this.sector,
        1,
        0,
        0,
      ]);
      this.position = 0;
      this.status = 3;
      return;
    }
    this.finish(0x10); // Raw tracks/formatting cannot be represented by TRD.
  }
}
