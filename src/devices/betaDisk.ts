import {
  type TrdFile,
  type TrdGeometry,
  trdBasic,
  trdCatalog,
  trdGeometry,
} from "../files/trd";
import type { Device, IoClaim } from "../machine/devices";
export type DiskDrive = 0 | 1;

interface DriveMedia {
  bytes?: Uint8Array;
  geometry: TrdGeometry;
  fileId: string;
  name: string;
  dirty: boolean;
  catalog: TrdFile[];
}

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
  private readonly media: [DriveMedia, DriveMedia] = [
    this.emptyMedia(),
    this.emptyMedia(),
  ];
  private readonly heads = [0, 0, 0, 0];
  private emptyMedia(): DriveMedia {
    return {
      geometry: { tracks: 80, sides: 2 },
      fileId: "",
      name: "",
      dirty: false,
      catalog: [],
    };
  }
  private get selected(): DriveMedia | undefined {
    return this.media[this.drive as DiskDrive];
  }
  get bytes(): Uint8Array | undefined {
    return this.selected?.bytes;
  }
  set bytes(bytes: Uint8Array | undefined) {
    if (!this.selected) throw new Error("Unsupported disk drive.");
    this.selected.bytes = bytes;
  }
  get geometry(): TrdGeometry {
    return this.selected?.geometry ?? { tracks: 80, sides: 2 };
  }
  get fileId(): string {
    return this.selected?.fileId ?? "";
  }
  get name(): string {
    return this.selected?.name ?? "";
  }
  get dirty(): boolean {
    return this.selected?.dirty ?? false;
  }
  set dirty(value: boolean) {
    if (this.selected) this.selected.dirty = value;
  }
  romRequired = false;
  dosEnabled = false;
  rom?: number[];
  track = 0;
  sector = 1;
  data = 0;
  private systemValue = 0x14;
  get system(): number {
    return this.systemValue;
  }
  set system(value: number) {
    if (this.buffer && (value ^ this.systemValue) & 0x13) this.finish(4);
    this.systemValue = value & 255;
  }
  get head(): number {
    return this.heads[this.drive];
  }
  set head(value: number) {
    this.heads[this.drive] = value;
  }
  selectDrive(drive: number): void {
    this.system = (this.system & ~3) | (drive & 3);
  }
  status = 0;
  intrq = false;
  private type1 = true;
  private direction = 1;
  private buffer?: Uint8Array;
  private position = 0;
  private writeOffset = -1;
  private multi = false;
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
    return this.drive < 2 && !!this.bytes;
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
    return this.stateFor(this.drive as DiskDrive);
  }
  get states(): [DiskState, DiskState] {
    return [this.stateFor(0), this.stateFor(1)];
  }
  stateFor(drive: DiskDrive): DiskState {
    const media = this.media[drive];
    return {
      id: media?.fileId ?? "",
      name: media?.name ?? "",
      dirty: media?.dirty ?? false,
      catalog: media?.catalog ?? [],
      romRequired: this.romRequired,
      dosEnabled: this.dosEnabled,
    };
  }
  imageFor(drive: DiskDrive): Uint8Array {
    const bytes = this.media[drive]?.bytes;
    if (!bytes) throw new Error("No disk mounted.");
    return bytes;
  }
  setDirty(drive: DiskDrive, dirty: boolean): void {
    this.media[drive].dirty = dirty;
  }
  mount(bytes: Uint8Array, id: string, name: string, drive: DiskDrive = 0) {
    const geometry = trdGeometry(bytes);
    const media = this.media[drive];
    if (!media) throw new Error("Unsupported disk drive.");
    if (drive === this.drive && this.buffer) this.finish(4);
    media.bytes = bytes.slice();
    media.geometry = geometry;
    media.fileId = id;
    media.name = name;
    media.dirty = false;
    media.catalog = this.catalog(bytes);
  }
  eject(drive: DiskDrive = 0) {
    const media = this.media[drive];
    if (!media) throw new Error("Unsupported disk drive.");
    if (drive === this.drive && this.buffer) this.finish(4);
    this.media[drive] = this.emptyMedia();
  }
  reset() {
    this.dosEnabled = false;
    this.romRequired = false;
    this.system = 0x14;
    this.track = 0;
    this.heads.fill(0);
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
    if (this.selected)
      this.selected.catalog = this.bytes ? this.catalog(this.bytes) : [];
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
