import { parseTap, type TapBlock } from "./tap";
import { parseTzx, TZX_SIGNATURE } from "./tzx";
/** Filename selects the parser on import; signature also supports API callers. */
export function parseTape(bytes: Uint8Array, name = ""): TapBlock[] {
  if (/\.tzx$/i.test(name) || TZX_SIGNATURE.every((b, i) => bytes[i] === b))
    return parseTzx(bytes);
  return parseTap(bytes);
}
