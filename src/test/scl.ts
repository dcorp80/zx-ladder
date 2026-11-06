import { diskFixture } from "./trd";
export function sclFixture(littleEndian = true): Uint8Array {
  const trd = diskFixture();
  const bytes = new Uint8Array(9 + 14 + 256 + 4);
  bytes.set(Array.from("SINCLAIR", (c) => c.charCodeAt(0)));
  bytes[8] = 1;
  bytes.set(trd.subarray(0, 14), 9);
  bytes.set(trd.subarray(4096, 4352), 23);
  let sum = 0;
  for (let i = 0; i < bytes.length - 4; i++) sum += bytes[i];
  new DataView(bytes.buffer).setUint32(bytes.length - 4, sum, littleEndian);
  return bytes;
}
