import { basicTape, trdCatalog } from "../files/trd";
import { TZX_SIGNATURE } from "../files/tzx";
import { diskFixture } from "./trd";

/** A normal BASIC header/data pair: 10 POKE 32768,42, auto-run at line 10. */
export function basicTapFixture(): Uint8Array {
  const disk = diskFixture();
  return basicTape(disk, trdCatalog(disk)[0]);
}

export function asTzx(tap: Uint8Array): Uint8Array {
  const bytes = [...TZX_SIGNATURE, 1, 20];
  for (let offset = 0; offset < tap.length; ) {
    const length = tap[offset] | (tap[offset + 1] << 8);
    bytes.push(0x10, 0xe8, 3, ...tap.subarray(offset, offset + length + 2));
    offset += length + 2;
  }
  return new Uint8Array(bytes);
}
