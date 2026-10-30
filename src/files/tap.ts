export interface TapBlock {
  flag: number;
  payload: Uint8Array;
  checksumValid: boolean;
}
export function parseTap(bytes: Uint8Array): TapBlock[] {
  const blocks: TapBlock[] = [];
  let p = 0;
  while (p < bytes.length) {
    if (p + 2 > bytes.length) throw new Error("Truncated TAP block length.");
    const length = bytes[p] | (bytes[p + 1] << 8);
    p += 2;
    if (length < 2 || p + length > bytes.length)
      throw new Error("Invalid or truncated TAP block.");
    blocks.push(decodeTapeBlock(bytes.subarray(p, p + length)));
    p += length;
  }
  if (!blocks.length) throw new Error("The TAP contains no blocks.");
  return blocks;
}

/** A complete Spectrum data block: flag, payload, XOR checksum. */
export function decodeTapeBlock(data: Uint8Array): TapBlock {
  if (data.length < 2)
    throw new Error("Tape data block must contain a flag and checksum.");
  let checksum = 0;
  for (const byte of data) checksum ^= byte;
  return {
    flag: data[0],
    payload: data.slice(1, -1),
    checksumValid: checksum === 0,
  };
}
