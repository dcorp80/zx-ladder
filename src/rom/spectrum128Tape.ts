/** Supported 128K editor menu: verified against the bundled ROM0.
 * Menu jump table at 2744, Tape Loader handler at 2831, key wait at 3680.
 * https://www.matthew-wilson.net/spectrum/rom/128_ROM0.html
 * Readiness is the BIT 5,(HL) opcode at 3683, after the menu is drawn.
 */
export const MENU_128_POLL = 0x3683;
const SIGNATURES: readonly [number, readonly number[]][] = [
  [
    0x2744,
    [
      5, 0, 0x31, 0x28, 1, 0x6c, 0x28, 2, 0x85, 0x28, 3, 0x47, 0x1b, 4, 0x16,
      0x28,
    ],
  ],
  [
    0x2831,
    [
      0xcd, 0x52, 0x38, 0x21, 0x3c, 0x5c, 0xcb, 0xc6, 0x11, 0xeb, 0x27, 0xcd,
      0x7d, 5,
    ],
  ],
  [
    0x3680,
    [0x21, 0x3b, 0x5c, 0xcb, 0x6e, 0x28, 0xfc, 0xcb, 0xae, 0x3a, 8, 0x5c],
  ],
];
export function supports128TapeMenu(rom: readonly number[]): boolean {
  return SIGNATURES.every(([address, bytes]) =>
    bytes.every((byte, i) => rom[address + i] === byte),
  );
}
