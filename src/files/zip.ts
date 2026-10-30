// ZIP central-directory reader. No paths are written to the host filesystem.
// Only stored/deflated TAP/TZX members are expanded, with bounded output.
const MAX_FILE = 16 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function extractZip(
  bytes: Uint8Array,
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => view.getUint16(p, true);
  const u32 = (p: number) => view.getUint32(p, true);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--)
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length)
      break;
  if (end < 0 || end < bytes.length - 65557)
    throw new Error("Invalid ZIP directory.");
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10))
    throw new Error("Multi-volume ZIP is unsupported.");
  const count = u16(end + 10);
  if (count > 2048)
    throw new Error("ZIP exceeds 2048 entry limit (ZIP64 unsupported).");
  let p = u32(end + 16);
  const directoryEnd = p + u32(end + 12);
  if (directoryEnd > end) throw new Error("Invalid ZIP directory size.");
  const output: { name: string; bytes: Uint8Array }[] = [];
  let total = 0;
  const names = new Set<string>();
  for (let entry = 0; entry < count; entry++) {
    if (p + 46 > directoryEnd || u32(p) !== 0x02014b50)
      throw new Error("Invalid ZIP member.");
    const flags = u16(p + 8),
      method = u16(p + 10),
      crc = u32(p + 16);
    const compressed = u32(p + 20),
      size = u32(p + 24),
      offset = u32(p + 42);
    const nameLength = u16(p + 28);
    const next = p + 46 + nameLength + u16(p + 30) + u16(p + 32);
    if (next > directoryEnd) throw new Error("Truncated ZIP entry.");
    const name = new TextDecoder().decode(
      bytes.subarray(p + 46, p + 46 + nameLength),
    );
    p = next;
    if (!/\.(tap|tzx)$/i.test(name)) continue;
    if (names.has(name)) throw new Error(`Duplicate ZIP member: ${name}`);
    names.add(name);
    if (flags & 1) throw new Error(`Encrypted ZIP member: ${name}`);
    if (method !== 0 && method !== 8)
      throw new Error(`Unsupported ZIP compression: ${name}`);
    total += size;
    if (size > MAX_FILE || total > MAX_TOTAL)
      throw new Error("ZIP exceeds extracted size limit.");
    if (offset + 30 > bytes.length || u32(offset) !== 0x04034b50)
      throw new Error("Invalid ZIP local header.");
    const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
    if (start + compressed > bytes.length)
      throw new Error("Truncated ZIP data.");
    const data = bytes.slice(start, start + compressed);
    let expanded: Uint8Array;
    if (method === 0) expanded = data;
    else {
      const stream = new ReadableStream<BufferSource>({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      }).pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > size || length > MAX_FILE) {
            await reader.cancel();
            throw new Error("ZIP output exceeds declared size.");
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      expanded = new Uint8Array(length);
      let at = 0;
      for (const chunk of chunks) {
        expanded.set(chunk, at);
        at += chunk.length;
      }
    }
    if (expanded.length !== size || crc32(expanded) !== crc)
      throw new Error(`ZIP size/checksum mismatch: ${name}`);
    output.push({ name, bytes: expanded });
  }
  return output;
}
