import type { Device, IoClaim } from "../machine/devices";

export const KEY_ROWS = [
  ["CAPS_SHIFT", "Z", "X", "C", "V"],
  ["A", "S", "D", "F", "G"],
  ["Q", "W", "E", "R", "T"],
  ["1", "2", "3", "4", "5"],
  ["0", "9", "8", "7", "6"],
  ["P", "O", "I", "U", "Y"],
  ["ENTER", "L", "K", "J", "H"],
  ["SPACE", "SYMBOL_SHIFT", "M", "N", "B"],
] as const;
export type SpectrumKey = (typeof KEY_ROWS)[number][number];
const positions = new Map<SpectrumKey, number>();
KEY_ROWS.forEach((row, r) => {
  row.forEach((key, bit) => {
    positions.set(key, r * 5 + bit);
  });
});

/** Headless switch matrix. Sources own switches; releases never clear another owner. */
export class KeyboardDevice implements Device {
  readonly id = "keyboard";
  hostCapsLock: boolean | undefined;
  desiredCapsLock: boolean | undefined;
  romCapsLock: boolean | undefined;
  capsSyncActive = false;
  private hiddenCapsLock = false;
  observeHostCapsLock(state: boolean): void {
    if (state !== this.hostCapsLock) {
      this.hostCapsLock = state;
      this.desiredCapsLock = state;
    }
  }
  toggleCapsLockTarget(): void {
    this.desiredCapsLock = !(this.romCapsLock ?? this.desiredCapsLock ?? false);
  }
  setHiddenCapsLock(active: boolean): void {
    this.hiddenCapsLock = active;
  }
  get hasInputSources(): boolean {
    return this.sources.size > 0;
  }
  readonly io: readonly IoClaim[];
  private readonly rows = new Uint8Array(8).fill(0x1f);
  private readonly counts = new Uint32Array(40);
  private readonly sources = new Map<string, readonly number[]>();
  private readonly sequences = new Map<
    string,
    { key: SpectrumKey; frames: number; shifted: boolean }
  >();
  private readonly listeners = new Set<() => void>();
  constructor(mask = 1, value = 0) {
    this.io = [
      {
        lowMask: mask,
        lowValue: value,
        readMask: 0x1f,
        read: (address) => this.readRows(address >>> 8),
      },
    ];
  }
  readRows(high: number): number {
    let data = 0x1f;
    for (let row = 0; row < 8; row++)
      if ((high & (1 << row)) === 0) data &= this.rows[row];
    if (this.hiddenCapsLock) {
      if ((high & 1) === 0) data &= ~1;
      if ((high & 8) === 0) data &= ~2;
    }
    return data;
  }
  press(source: string, key: SpectrumKey | readonly SpectrumKey[]): void {
    this.hiddenCapsLock = false;
    if (this.sources.has(source)) return;
    const keys = typeof key === "string" ? [key] : [...new Set(key)];
    const indices = keys.map((item) => {
      const index = positions.get(item);
      if (index === undefined) throw new Error(`Unknown Spectrum key: ${item}`);
      return index;
    });
    this.sources.set(source, indices);
    for (const index of indices) {
      this.counts[index]++;
      this.rows[Math.floor(index / 5)] &= ~(1 << (index % 5));
    }
    this.notify();
  }
  /** Extended-mode shortcut, paced by emulated frames rather than wall time. */
  pressExtended(source: string, key: SpectrumKey, shifted = true): void {
    if (this.sources.has(source)) return;
    this.press(source, ["CAPS_SHIFT", "SYMBOL_SHIFT"]);
    this.sequences.set(source, { key, frames: 2, shifted });
  }
  advanceFrame(): void {
    for (const [source, sequence] of this.sequences) {
      if (--sequence.frames > 0) continue;
      this.release(source);
      this.press(
        source,
        sequence.shifted ? ["SYMBOL_SHIFT", sequence.key] : sequence.key,
      );
    }
  }
  release(source: string): void {
    this.sequences.delete(source);
    const indices = this.sources.get(source);
    if (!indices) return;
    this.sources.delete(source);
    for (const index of indices)
      if (--this.counts[index] === 0)
        this.rows[Math.floor(index / 5)] |= 1 << (index % 5);
    this.notify();
  }
  releaseAll(): void {
    this.hiddenCapsLock = false;
    if (!this.sources.size) return;
    this.sequences.clear();
    this.sources.clear();
    this.counts.fill(0);
    this.rows.fill(0x1f);
    this.notify();
  }
  isPressed(key: SpectrumKey): boolean {
    const index = positions.get(key);
    return index !== undefined && this.counts[index] > 0;
  }
  hasOtherSources(source: string): boolean {
    return this.sources.size > (this.sources.has(source) ? 1 : 0);
  }
  hasSource(source: string): boolean {
    return this.sources.has(source);
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
