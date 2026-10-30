import { decodeTapeBlock, type TapBlock } from "./tap";

export const TZX_SIGNATURE = [0x5a, 0x58, 0x54, 0x61, 0x70, 0x65, 0x21, 0x1a];
type Node =
  | { kind: "data"; block: TapBlock }
  | { kind: "skip" | "stop" | "endLoop" | "return" }
  | { kind: "jump"; offset: number }
  | { kind: "loop"; count: number }
  | { kind: "call"; offsets: number[] };

/** TZX 1.x flash-load subset. Timings are not waveform playback.
 * Layouts: https://worldofspectrum.net/TZXformat.html (v1.20).
 * Parse first, then resolve control flow with bounded execution and output.
 */
export function parseTzx(bytes: Uint8Array): TapBlock[] {
  let p = 0;
  const take = (length: number): Uint8Array => {
    if (length > bytes.length - p)
      throw new Error(`Truncated TZX at byte ${p}.`);
    const result = bytes.subarray(p, p + length);
    p += length;
    return result;
  };
  const number = (size: number): number => {
    const data = take(size);
    let result = 0;
    for (let i = 0; i < size; i++) result += data[i] * 2 ** (8 * i);
    return result;
  };
  const signed = (): number => {
    const n = number(2);
    return n >= 0x8000 ? n - 0x10000 : n;
  };
  const header = take(10);
  if (!TZX_SIGNATURE.every((b, i) => header[i] === b))
    throw new Error("Invalid TZX signature.");
  if (header[8] !== 1)
    throw new Error(`Unsupported TZX version ${header[8]}.${header[9]}.`);
  const nodes: Node[] = [];
  while (p < bytes.length) {
    if (nodes.length >= 65536)
      throw new Error("TZX exceeds block count limit.");
    const id = number(1);
    let node: Node = { kind: "skip" };
    switch (id) {
      case 0x10:
        take(2); // pause
        node = { kind: "data", block: decodeTapeBlock(take(number(2))) };
        break;
      case 0x11:
      case 0x14: {
        take(id === 0x11 ? 12 : 4); // pulse timings/count
        const lastBits = number(1);
        if (lastBits !== 8)
          throw new Error("TZX partial-byte data requires pulse playback.");
        take(2); // pause
        node = { kind: "data", block: decodeTapeBlock(take(number(3))) };
        break;
      }
      case 0x12:
        take(4);
        break; // tone (no bytes for ROM load)
      case 0x13:
        take(number(1) * 2);
        break; // pulse sequence
      case 0x20:
        if (number(2) === 0) node = { kind: "stop" };
        break;
      case 0x21:
      case 0x30:
        take(number(1));
        break;
      case 0x22:
        break;
      case 0x23:
        node = { kind: "jump", offset: signed() };
        break;
      case 0x24: {
        const count = number(2);
        if (!count) throw new Error("Invalid zero TZX loop count.");
        node = { kind: "loop", count };
        break;
      }
      case 0x25:
        node = { kind: "endLoop" };
        break;
      case 0x26: {
        const count = number(2),
          offsets: number[] = [];
        for (let i = 0; i < count; i++) offsets.push(signed());
        node = { kind: "call", offsets };
        break;
      }
      case 0x27:
        node = { kind: "return" };
        break;
      case 0x2a:
        if (number(4) !== 0) throw new Error("Invalid TZX 48K stop block.");
        node = { kind: "stop" };
        break; // Ladder currently models 48K RAM
      case 0x2b:
        if (number(4) !== 1 || number(1) > 1)
          throw new Error("Invalid TZX signal-level block.");
        break;
      case 0x31:
        take(1);
        take(number(1));
        break;
      case 0x32:
        take(number(2));
        break;
      case 0x33:
        take(number(1) * 3);
        break;
      case 0x34:
        take(8);
        break;
      case 0x35:
        take(16);
        take(number(4));
        break;
      case 0x5a:
        take(9);
        break;
      case 0x15:
      case 0x18:
      case 0x19:
        throw new Error(
          `TZX block 0x${id.toString(16)} requires pulse playback, which is not available yet.`,
        );
      case 0x28:
        throw new Error("TZX selection menus are not supported yet.");
      case 0x40:
        throw new Error(
          "TZX embedded snapshots cannot be loaded into this CPU.",
        );
      default:
        throw new Error(`Unsupported TZX block 0x${id.toString(16)}.`);
    }
    nodes.push(node);
  }

  const result: TapBlock[] = [];
  const loops: { start: number; remaining: number }[] = [];
  const calls: { base: number; offsets: number[]; next: number }[] = [];
  const target = (base: number, offset: number): number => {
    const destination = base + offset;
    if (destination < 0 || destination >= nodes.length)
      throw new Error("TZX control-flow target is outside the tape.");
    return destination;
  };
  let pc = 0,
    steps = 0;
  while (pc < nodes.length) {
    if (
      ++steps > 100000 ||
      result.length >= 16384 ||
      loops.length > 64 ||
      calls.length > 64
    )
      throw new Error(
        "TZX control flow exceeds the flash-load limit (possible infinite loop).",
      );
    const node = nodes[pc];
    switch (node.kind) {
      case "data":
        result.push(node.block);
        pc++;
        break;
      case "skip":
        pc++;
        break;
      case "stop":
        // Stop is an end marker for this flash-load session, never skip across it.
        if (!result.length)
          throw new Error("TZX stops before any loadable data.");
        return result;
      case "jump":
        pc = target(pc, node.offset);
        break;
      case "loop":
        loops.push({ start: pc + 1, remaining: node.count });
        pc++;
        break;
      case "endLoop": {
        const loop = loops.at(-1);
        if (!loop) throw new Error("TZX loop end has no matching start.");
        if (--loop.remaining) pc = loop.start;
        else {
          loops.pop();
          pc++;
        }
        break;
      }
      case "call":
        if (!node.offsets.length) {
          pc++;
          break;
        }
        calls.push({ base: pc, offsets: node.offsets, next: 1 });
        pc = target(pc, node.offsets[0]);
        break;
      case "return": {
        const call = calls.at(-1);
        if (!call) throw new Error("TZX return has no matching call.");
        if (call.next < call.offsets.length)
          pc = target(call.base, call.offsets[call.next++]);
        else {
          calls.pop();
          pc = call.base + 1;
        }
        break;
      }
    }
  }
  if (loops.length || calls.length)
    throw new Error("Unfinished TZX loop or call sequence.");
  if (!result.length)
    throw new Error("The TZX contains no flash-loadable data.");
  return result;
}
