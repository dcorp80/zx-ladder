export interface MemoryClaim {
  start: number;
  end: number;
  read(address: number): number;
  write(address: number, value: number): void;
}
export interface IoClaim {
  lowMask: number;
  lowValue: number;
  highMask?: number;
  highValue?: number;
  readMask?: number;
  priority?: number;
  selected?(address: number): boolean;
  blockLower?: boolean;
  /** Pure pin sample; can be called repeatedly during an I/O cycle. */
  read?(address: number): number;
  write?(address: number, value: number): void;
}
export interface ClockContext {
  readonly counters: Float64Array;
  readonly framePosition: number;
}
export interface ClockHook {
  divider: number;
  phase: number;
  tick(context: ClockContext): void;
}
export interface Device {
  readonly id: string;
  readonly memory?: readonly MemoryClaim[];
  readonly io?: readonly IoClaim[];
  readonly clock?: readonly ClockHook[];
}

/** Registration is cold-path work; port lookups first select a low-byte bucket. */
export class DeviceBus {
  private readonly memoryPages: MemoryClaim[][] = Array.from(
    { length: 256 },
    () => [],
  );
  private readonly ports: IoClaim[][] = Array.from({ length: 256 }, () => []);
  readonly clocks: ClockHook[] = [];

  constructor(devices: readonly Device[]) {
    const ranges: MemoryClaim[] = [];
    const ids = new Set<string>();
    for (const d of devices) {
      if (ids.has(d.id)) throw new Error(`Duplicate device: ${d.id}`);
      ids.add(d.id);
      for (const m of d.memory ?? []) {
        if (
          !Number.isInteger(m.start) ||
          !Number.isInteger(m.end) ||
          m.start < 0 ||
          m.end > 0xffff ||
          m.start > m.end
        )
          throw new RangeError("Invalid memory claim");
        if (ranges.some((r) => m.start <= r.end && m.end >= r.start))
          throw new Error("Overlapping memory claims");
        ranges.push(m);
        for (let page = m.start >>> 8; page <= m.end >>> 8; page++)
          this.memoryPages[page].push(m);
      }
      for (const port of d.io ?? []) {
        for (const n of [
          port.lowMask,
          port.lowValue,
          port.highMask ?? 0,
          port.highValue ?? 0,
          port.readMask ?? 255,
        ])
          if (!Number.isInteger(n) || n < 0 || n > 255)
            throw new RangeError("Invalid IO decode");
        if (
          (port.lowValue & port.lowMask) !== port.lowValue ||
          ((port.highValue ?? 0) & (port.highMask ?? 0)) !==
            (port.highValue ?? 0)
        )
          throw new RangeError("IO value outside mask");
        if (!Number.isSafeInteger(port.priority ?? 0))
          throw new RangeError("Invalid IO priority");
        for (let low = 0; low < 256; low++) {
          if ((low & port.lowMask) !== port.lowValue) continue;
          if (
            port.read &&
            this.ports[low].some(
              (other) =>
                other.read &&
                ((other.readMask ?? 255) & (port.readMask ?? 255)) !== 0 &&
                !(
                  (port.priority ?? 0) > (other.priority ?? 0) &&
                  port.blockLower
                ) &&
                !(
                  (other.priority ?? 0) > (port.priority ?? 0) &&
                  other.blockLower
                ) &&
                (((other.highValue ?? 0) ^ (port.highValue ?? 0)) &
                  (other.highMask ?? 0) &
                  (port.highMask ?? 0)) ===
                  0,
            )
          )
            throw new Error("Overlapping IO read drivers");
          this.ports[low].push(port);
        }
      }
      for (const hook of d.clock ?? []) {
        if (
          !Number.isInteger(hook.divider) ||
          hook.divider < 1 ||
          !Number.isInteger(hook.phase) ||
          hook.phase < 0 ||
          hook.phase >= hook.divider
        )
          throw new RangeError("Invalid device clock divider");
        this.clocks.push(hook);
      }
    }
    for (const bucket of this.ports)
      bucket.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }
  readMemory(address: number): number {
    for (const m of this.memoryPages[address >>> 8])
      if (address >= m.start && address <= m.end) return m.read(address) & 255;
    return 255;
  }
  writeMemory(address: number, value: number): void {
    for (const m of this.memoryPages[address >>> 8])
      if (address >= m.start && address <= m.end) {
        m.write(address, value & 255);
        return;
      }
  }
  readIo(address: number): number {
    let data = 255;
    let cutoff = -Infinity;
    for (const p of this.ports[address & 255]) {
      const priority = p.priority ?? 0;
      if (priority < cutoff) break;
      if (
        ((address >>> 8) & (p.highMask ?? 0)) !== (p.highValue ?? 0) ||
        (p.selected && !p.selected(address))
      )
        continue;
      if (p.read) {
        const mask = p.readMask ?? 255;
        data = (data & ~mask) | (p.read(address) & mask);
      }
      if (p.blockLower) cutoff = priority;
    }
    return data;
  }
  writeIo(address: number, value: number): void {
    let cutoff = -Infinity;
    for (const p of this.ports[address & 255]) {
      const priority = p.priority ?? 0;
      if (priority < cutoff) break;
      if (
        ((address >>> 8) & (p.highMask ?? 0)) !== (p.highValue ?? 0) ||
        (p.selected && !p.selected(address))
      )
        continue;
      p.write?.(address, value & 255);
      if (p.blockLower) cutoff = priority;
    }
  }
}
