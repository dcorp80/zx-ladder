/** Raw TR-DOS sectors. Filesystem damage does not prevent controller access. */
export interface TrdFile {
  warning?: string;
  index: number;
  name: string;
  ext: string;
  parameter: number;
  length: number;
  sectors: number;
  offset: number;
}
export interface TrdGeometry {
  tracks: number;
  sides: number;
}
export function trdGeometry(bytes: Uint8Array): TrdGeometry {
  const types: Record<number, TrdGeometry> = {
    22: { tracks: 80, sides: 2 },
    23: { tracks: 40, sides: 2 },
    24: { tracks: 80, sides: 1 },
    25: { tracks: 40, sides: 1 },
  };
  const geometry = types[bytes[0x8e3]];
  if (
    !geometry ||
    bytes.length < 0x900 ||
    bytes.length % 256 !== 0 ||
    bytes.length > geometry.tracks * geometry.sides * 4096
  )
    throw new Error(
      "TRD must contain complete 256-byte sectors and fit its declared 40/80-track geometry.",
    );
  return geometry;
}
export function trdCatalog(bytes: Uint8Array): TrdFile[] {
  const files: TrdFile[] = [];
  for (let i = 0; i < 128; i++) {
    const p = i * 16;
    if (!bytes[p]) break;
    if (bytes[p] === 1) continue;
    files.push({
      index: i,
      name: String.fromCharCode(...bytes.subarray(p, p + 8)).trimEnd(),
      ext: String.fromCharCode(bytes[p + 8]),
      parameter: bytes[p + 9] | (bytes[p + 10] << 8),
      length: bytes[p + 11] | (bytes[p + 12] << 8),
      sectors: bytes[p + 13],
      offset: (bytes[p + 15] * 16 + bytes[p + 14]) * 256,
    });
  }
  return files;
}
export function trdBasic(bytes: Uint8Array, file: TrdFile) {
  const end = file.offset + file.parameter;
  if (
    file.ext !== "B" ||
    file.length > file.parameter ||
    file.offset < 4096 ||
    file.parameter > file.sectors * 256 ||
    end > bytes.length
  )
    throw new Error(
      `${file.name}.B: BASIC data extends beyond its declared file or disk bounds.`,
    );
  // Compatibility experiment: disk BASIC often contains embedded machine code
  // and has no saved autostart trailer. Let the Spectrum interpreter execute it.
  // Only recognize a trailer when it actually fits the allocation and image.
  const hasTrailer =
    file.parameter + 4 <= file.sectors * 256 &&
    end + 4 <= bytes.length &&
    bytes[end] === 0x80 &&
    bytes[end + 1] === 0xaa;
  const savedLine = hasTrailer ? bytes[end + 2] | (bytes[end + 3] << 8) : 0;
  const line = savedLine <= 9999 ? savedLine : 0;
  return {
    data: bytes.slice(file.offset, end),
    programLength: file.length,
    line,
  };
}
export function trdBoot(files: TrdFile[]): TrdFile | undefined {
  const basic = files.filter((f) => f.ext === "B");
  const boot = basic.filter((f) => f.name.toLowerCase() === "boot");
  return boot.length === 1
    ? boot[0]
    : boot.length === 0 && basic.length === 1
      ? basic[0]
      : undefined;
}
/** Use the existing verified BASIC loader for ROM-free initial program startup. */
export function basicTape(bytes: Uint8Array, file: TrdFile): Uint8Array {
  const basic = trdBasic(bytes, file);
  const header = new Uint8Array(19);
  header[1] = 0;
  header.fill(32, 2, 12);
  for (let i = 0; i < Math.min(file.name.length, 10); i++)
    header[2 + i] = file.name.charCodeAt(i);
  header[12] = basic.data.length & 255;
  header[13] = basic.data.length >>> 8;
  // Run explicitly: start at the saved line when present, otherwise first line.
  header[14] = basic.line & 255;
  header[15] = basic.line >>> 8;
  header[16] = basic.programLength & 255;
  header[17] = basic.programLength >>> 8;
  const data = new Uint8Array(basic.data.length + 2);
  data[0] = 255;
  data.set(basic.data, 1);
  for (const block of [header, data]) {
    let checksum = 0;
    for (let i = 0; i < block.length - 1; i++) checksum ^= block[i];
    block[block.length - 1] = checksum;
  }
  const tape = new Uint8Array(header.length + data.length + 4);
  tape[0] = header.length;
  tape.set(header, 2);
  const p = header.length + 2;
  tape[p] = data.length & 255;
  tape[p + 1] = data.length >>> 8;
  tape.set(data, p + 2);
  return tape;
}
/** A tiny BASIC launcher lets real TR-DOS own loading and metadata handling. */
export function dosLauncher(name: string): Uint8Array {
  if (!/^[\x20-\x21\x23-\x7e]{1,8}$/.test(name))
    throw new Error(
      "This disk filename cannot be entered by the BASIC launcher.",
    );
  const body = [
    0xf9,
    0xc0,
    ...Array.from("15619", (c) => c.charCodeAt(0)),
    14,
    0,
    0,
    3,
    0x3d,
    0,
    58,
    0xea,
    58,
    0xf7,
    34,
    ...Array.from(name, (c) => c.charCodeAt(0)),
    34,
    13,
  ];
  const payload = new Uint8Array(4096 + 256);
  payload.set([0, 10, body.length, 0, ...body, 0x80, 0xaa, 10, 0], 4096);
  return basicTape(payload, {
    index: 0,
    name: "disk-run",
    ext: "B",
    parameter: body.length + 4,
    length: body.length + 4,
    sectors: 1,
    offset: 4096,
  });
}
