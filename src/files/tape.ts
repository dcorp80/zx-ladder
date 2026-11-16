import { parseTap, type TapBlock } from "./tap";
import { parseTzx, TZX_SIGNATURE } from "./tzx";

export interface TapeCatalogEntry {
  index: number;
  name: string | null;
  type: string;
  bytes: number;
  flag: number;
  checksumValid: boolean;
  header: boolean;
  runnable: boolean;
}
export interface TapeState {
  name: string | null;
  catalog: readonly TapeCatalogEntry[];
  /** Index of the next flash-load block; catalog.length means end of tape. */
  cursor: number;
  status: string;
}

export function tapeCatalog(blocks: readonly TapBlock[]): TapeCatalogEntry[] {
  const types = ["Program", "Number array", "Character array", "Bytes"];
  return blocks.map((block, index) => {
    const header =
      block.flag === 0 && block.payload.length === 17 && block.payload[0] < 4;
    const data = blocks[index + 1];
    const runnable = !!(
      header &&
      block.payload[0] === 0 &&
      block.checksumValid &&
      data?.flag === 255 &&
      data.checksumValid &&
      data.payload.length === (block.payload[11] | (block.payload[12] << 8))
    );
    return {
      index,
      runnable,
      header,
      name: header
        ? Array.from(block.payload.subarray(1, 11), (byte) =>
            byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : "?",
          )
            .join("")
            .trimEnd()
        : null,
      type: header ? `${types[block.payload[0]]} header` : "Data",
      bytes: block.payload.length,
      flag: block.flag,
      checksumValid: block.checksumValid,
    };
  });
}
/** Filename selects the parser on import; signature also supports API callers. */
export function parseTape(
  bytes: Uint8Array,
  name = "",
  is128 = false,
): TapBlock[] {
  if (/\.tzx$/i.test(name) || TZX_SIGNATURE.every((b, i) => bytes[i] === b))
    return parseTzx(bytes, is128);
  return parseTap(bytes);
}
