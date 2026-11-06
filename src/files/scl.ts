/** SCL stores 14-byte file descriptors followed by sector-sized payloads. */
export function parseScl(bytes: Uint8Array) {
  if (
    bytes.length < 9 ||
    String.fromCharCode(...bytes.subarray(0, 8)) !== "SINCLAIR"
  )
    throw new Error("Invalid SCL signature.");
  const count = bytes[8];
  if (count > 128)
    throw new Error("SCL exceeds the TR-DOS limit of 128 files.");
  const headerEnd = 9 + count * 14;
  if (headerEnd > bytes.length)
    throw new Error("Truncated SCL file descriptors.");
  const files: { header: Uint8Array; data: Uint8Array }[] = [];
  let offset = headerEnd,
    sectors = 0;
  for (let i = 0; i < count; i++) {
    const header = bytes.subarray(9 + i * 14, 23 + i * 14);
    sectors += header[13];
    if (sectors > 2544)
      throw new Error("SCL files exceed 640 KiB disk capacity.");
    const end = offset + header[13] * 256;
    if (end > bytes.length) throw new Error("Truncated SCL sector data.");
    files.push({ header, data: bytes.subarray(offset, end) });
    offset = end;
  }
  let warning = "";
  // Both byte orders occur in real archives (including our supplied examples).
  // An absent/mismatched checksum is a warning, not a loading restriction.
  if (bytes.length - offset === 4) {
    let sum = 0;
    for (let i = 0; i < offset; i++) sum = (sum + bytes[i]) >>> 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    if (view.getUint32(0, true) !== sum && view.getUint32(0, false) !== sum)
      warning = "SCL checksum mismatch; original file data preserved";
  } else
    warning =
      bytes.length === offset
        ? "SCL checksum absent"
        : "SCL has unrecognized trailing bytes";
  return { files, warning };
}
/** Repack as an ordinary drive-A disk; retain payload bytes and descriptor fields. */
export function sclToTrd(bytes: Uint8Array): Uint8Array {
  const { files } = parseScl(bytes);
  const trd = new Uint8Array(655360);
  let nextSector = 16;
  for (let i = 0; i < files.length; i++) {
    const { header, data } = files[i];
    const directory = i * 16;
    trd.set(header, directory);
    trd[directory + 14] = nextSector % 16;
    trd[directory + 15] = Math.floor(nextSector / 16);
    trd.set(data, nextSector * 256);
    nextSector += header[13];
  }
  trd[0x8e1] = nextSector % 16;
  trd[0x8e2] = Math.floor(nextSector / 16);
  trd[0x8e3] = 0x16;
  trd[0x8e4] = files.length;
  const free = 2560 - nextSector;
  trd[0x8e5] = free & 255;
  trd[0x8e6] = free >>> 8;
  trd[0x8e7] = 0x10;
  trd.fill(32, 0x8f5, 0x8fd);
  return trd;
}
