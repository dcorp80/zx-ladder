import { parseTap, type TapBlock } from "./tap";
import { parseTzx, TZX_SIGNATURE } from "./tzx";
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
