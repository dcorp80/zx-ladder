import type { Device, IoClaim } from "../machine/devices";
import { loadRtcRam, saveRtcRam } from "../storage/rtc";

/** Host local time, refreshed only on Spectrum data reads. CMOS user RAM (0x0e–0x7f) is persisted in IndexedDB. */
export class GlukRtc implements Device {
  readonly id = "gluk-rtc";
  readonly bytes: number[] = Array(128).fill(0);
  enabled = true;
  private readonly dirty = new Set<number>();
  readonly ready: Promise<void>;
  private address = 0;
  private control = 0;
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly storage = { loadRtcRam, saveRtcRam },
  ) {
    this.bytes[10] = 0x20;
    this.bytes[11] = 2;
    this.bytes[13] = 0x80;
    this.ready = this.storage
      .loadRtcRam()
      .then((ram) => {
        if (!Array.isArray(ram)) return;
        for (let a = 14; a < 128; a++)
          if (!this.dirty.has(a) && Number.isInteger(ram[a - 14]))
            this.bytes[a] = ram[a - 14] & 255;
      })
      .catch(() => {});
  }
  reset(): void {
    this.address = 0;
    this.control = 0;
    // Battery-backed RAM survives reset; refresh clock fields on the next read.
  }
  private refresh(): void {
    if (this.bytes[11] & 0x80) return;
    const d = this.now();
    const encode = (n: number) =>
      this.bytes[11] & 4 ? n : (Math.floor(n / 10) << 4) | (n % 10);
    let hour = d.getHours();
    const pm = hour >= 12;
    if (!(this.bytes[11] & 2)) hour = hour % 12 || 12;
    for (const [a, n] of [
      [0, d.getSeconds()],
      [2, d.getMinutes()],
      [4, hour],
      [6, d.getDay() + 1],
      [7, d.getDate()],
      [8, d.getMonth() + 1],
      [9, d.getFullYear() % 100],
    ])
      this.bytes[a] = encode(n);
    if (!(this.bytes[11] & 2) && pm) this.bytes[4] |= 0x80;
  }
  readonly io: readonly IoClaim[] = [
    {
      lowMask: 255,
      lowValue: 0xf7,
      highMask: 255,
      highValue: 0xef,
      selected: () => this.enabled,
      write: (_, v) => {
        this.control = v;
      },
    },
    {
      lowMask: 255,
      lowValue: 0xf7,
      highMask: 255,
      highValue: 0xdf,
      selected: () => this.enabled && !!(this.control & 128),
      write: (_, v) => {
        this.address = v & 127;
      },
    },
    {
      lowMask: 255,
      lowValue: 0xf7,
      highMask: 255,
      highValue: 0xbf,
      selected: () => this.enabled && !!(this.control & 128),
      read: () => {
        this.refresh();
        return this.bytes[this.address];
      },
      write: (_, v) => {
        if (this.address !== 12 && this.address !== 13) {
          this.bytes[this.address] = v & 255;
          if (this.address >= 14) {
            this.dirty.add(this.address);
            void this.ready
              .then(() => this.storage.saveRtcRam(this.bytes.slice(14)))
              .catch(() => {});
          }
        }
      },
    },
  ];
}
