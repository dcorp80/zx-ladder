export function diskFixture(
  body = [
    0xf4,
    ...Array.from("32768", (c) => c.charCodeAt(0)),
    14,
    0,
    0,
    0,
    128,
    0,
    44,
    52,
    50,
    14,
    0,
    0,
    42,
    0,
    0,
    13,
  ],
) {
  const bytes = new Uint8Array(655360);
  bytes.set(Array.from("boot    B", (c) => c.charCodeAt(0)));
  const size = body.length + 4;
  bytes.set([size & 255, size >>> 8, size & 255, size >>> 8, 1, 0, 1], 9);
  bytes.set([0, 10, body.length, 0, ...body, 0x80, 0xaa, 10, 0], 4096);
  bytes[0x8e1] = 1;
  bytes[0x8e2] = 1;
  bytes[0x8e3] = 0x16;
  bytes[0x8e4] = 1;
  bytes[0x8e5] = 0xef;
  bytes[0x8e6] = 9;
  bytes[0x8e7] = 0x10;
  return bytes;
}
