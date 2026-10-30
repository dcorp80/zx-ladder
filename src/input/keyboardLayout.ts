import type { SpectrumKey } from "../devices/keyboard";

export const KEYBOARD_LAYOUT_ID = "macbook-pro-iso";
export const PC_LAYOUT_ID = "pc-full-size";
export const KEYBOARD_PROFILE_ID = "zx-m8xxx-chords";
export const HOST_KEYS: Readonly<
  Record<string, SpectrumKey | readonly SpectrumKey[]>
> = Object.freeze({
  ...Object.fromEntries(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((k) => [`Key${k}`, k]),
  ),
  ...Object.fromEntries("0123456789".split("").map((k) => [`Digit${k}`, k])),
  ControlLeft: "CAPS_SHIFT",
  ControlRight: "CAPS_SHIFT",
  AltLeft: "SYMBOL_SHIFT",
  AltRight: "SYMBOL_SHIFT",
  Enter: "ENTER",
  NumpadEnter: "ENTER",
  ...Object.fromEntries("0123456789".split("").map((k) => [`Numpad${k}`, k])),
  NumpadDecimal: ["SYMBOL_SHIFT", "M"],
  NumpadAdd: ["SYMBOL_SHIFT", "K"],
  NumpadSubtract: ["SYMBOL_SHIFT", "J"],
  NumpadMultiply: ["SYMBOL_SHIFT", "B"],
  NumpadDivide: ["SYMBOL_SHIFT", "V"],
  Delete: ["CAPS_SHIFT", "0"],
  Space: "SPACE",
  Backspace: ["CAPS_SHIFT", "0"],
  CapsLock: ["CAPS_SHIFT", "2"],
  ArrowLeft: ["CAPS_SHIFT", "5"],
  ArrowDown: ["CAPS_SHIFT", "6"],
  ArrowUp: ["CAPS_SHIFT", "7"],
  ArrowRight: ["CAPS_SHIFT", "8"],
  Period: ["SYMBOL_SHIFT", "M"],
  Comma: ["SYMBOL_SHIFT", "N"],
  Semicolon: ["SYMBOL_SHIFT", "O"],
  Quote: ["SYMBOL_SHIFT", "P"],
  Slash: ["SYMBOL_SHIFT", "V"],
  Minus: ["SYMBOL_SHIFT", "J"],
  Equal: ["SYMBOL_SHIFT", "L"],
  IntlHash: ["SYMBOL_SHIFT", "3"],
} as const);
export const EXTENDED_CHARACTERS: Readonly<Record<string, SpectrumKey>> = {
  "[": "Y",
  "]": "U",
  "{": "F",
  "}": "G",
  "|": "S",
  "`": "A",
  "~": "A",
  "\\": "D",
};
export const EXTENDED_CODES: Readonly<Record<string, string>> = {
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  IntlBackslash: "`",
  Backquote: "`",
};
// Shifted characters follow the host layout; codes provide a positional fallback.
export const SHIFT_CHARACTERS: Readonly<Record<string, SpectrumKey>> = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "H",
  "&": "6",
  "*": "B",
  "(": "8",
  ")": "9",
  "<": "R",
  ">": "T",
  "?": "C",
  ":": "Z",
  '"': "P",
  _: "0",
  "+": "K",
  "'": "7",
};
export const SHIFT_CODES: Readonly<Record<string, string>> = {
  Digit1: "!",
  Digit2: "@",
  Digit3: "#",
  Digit4: "$",
  Digit5: "%",
  Digit6: "^",
  Digit7: "&",
  Digit8: "*",
  Digit9: "(",
  Digit0: ")",
  Comma: "<",
  Period: ">",
  Slash: "?",
  Semicolon: ":",
  Quote: '"',
  Minus: "_",
  Equal: "+",
  BracketLeft: "{",
  BracketRight: "}",
  Backslash: "|",
  IntlBackslash: "~",
  Backquote: "~",
};
export function shiftedCharacter(code: string, key = ""): string | undefined {
  return EXTENDED_CHARACTERS[key] || SHIFT_CHARACTERS[key]
    ? key
    : SHIFT_CODES[code];
}
export function pressHostKey(
  keyboard: import("../devices/keyboard").KeyboardDevice,
  source: string,
  code: string,
  shift: boolean,
  key = "",
  layout = KEYBOARD_LAYOUT_ID,
): boolean {
  if (code === "CapsLock") {
    keyboard.toggleCapsLockTarget();
    return true;
  }
  const character =
    shift && !code.startsWith("Numpad")
      ? shiftedCharacter(code, key)
      : EXTENDED_CODES[code] &&
        (EXTENDED_CHARACTERS[key] ? key : EXTENDED_CODES[code]);
  const extendedKey = character && EXTENDED_CHARACTERS[character];
  if (extendedKey) {
    keyboard.pressExtended(source, extendedKey);
    return true;
  }
  const mapped = character && SHIFT_CHARACTERS[character];
  const chord = mapped
    ? (["SYMBOL_SHIFT", mapped] as const)
    : hostMapping(code, layout);
  if (!chord) return false;
  keyboard.press(source, chord);
  return true;
}
function hostMapping(code: string, layout: string) {
  return layout === PC_LAYOUT_ID && code === "Quote"
    ? (["SYMBOL_SHIFT", "7"] as const)
    : HOST_KEYS[code];
}
const keywords: Record<string, string> = {
  Q: "PLOT",
  W: "DRAW",
  E: "REM",
  R: "RUN",
  T: "RANDOMIZE",
  Y: "RETURN",
  U: "IF",
  I: "INPUT",
  O: "POKE",
  P: "PRINT",
  A: "NEW",
  S: "SAVE",
  D: "DIM",
  F: "FOR",
  G: "GO TO",
  H: "GO SUB",
  J: "LOAD",
  K: "LIST",
  L: "LET",
  Z: "COPY",
  X: "CLEAR",
  C: "CONT",
  V: "CLS",
  B: "BORDER",
  N: "NEXT",
  M: "PAUSE",
};
const symbols: Record<string, string> = {
  "1": "!",
  "2": "@",
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "&",
  "7": "′",
  "8": "(",
  "9": ")",
  "0": "_",
  Q: "≤",
  W: "≠",
  E: "≥",
  R: "<",
  T: ">",
  Y: "AND",
  U: "OR",
  I: "AT",
  O: ";",
  P: '"',
  A: "STOP",
  S: "NOT",
  D: "STEP",
  F: "TO",
  G: "THEN",
  H: "↑",
  J: "−",
  K: "+",
  L: "=",
  Z: ":",
  X: "£",
  C: "?",
  V: "/",
  B: "*",
  N: ",",
  M: ".",
};
const extended: Record<string, string> = {
  Q: "SIN",
  W: "COS",
  E: "TAN",
  R: "INT",
  T: "RND",
  Y: "STR$",
  U: "CHR$",
  I: "CODE",
  O: "PEEK",
  P: "TAB",
  A: "READ",
  S: "RESTORE",
  D: "DATA",
  F: "SGN",
  G: "ABS",
  H: "SQR",
  J: "VAL",
  K: "LEN",
  L: "USR",
  Z: "LN",
  X: "EXP",
  C: "LPRINT",
  V: "LLIST",
  B: "BIN",
  N: "INKEY$",
  M: "PI",
};
// Spectrum extended mode with shift (the lower key legends).
const extendedShifted: Record<string, string> = {
  Q: "ASN",
  W: "ACS",
  E: "ATN",
  R: "VERIFY",
  T: "MERGE",
  Y: "[",
  U: "]",
  I: "IN",
  O: "OUT",
  P: "©",
  A: "~",
  S: "|",
  D: "\\",
  F: "{",
  G: "}",
  H: "CIRCLE",
  J: "VAL$",
  K: "SCREEN$",
  L: "ATTR",
  Z: "BEEP",
  X: "INK",
  C: "PAPER",
  V: "FLASH",
  B: "BRIGHT",
  N: "OVER",
  M: "INVERSE",
  "1": "DEF FN",
  "2": "FN",
  "3": "LINE",
  "4": "OPEN #",
  "5": "CLOSE #",
  "6": "MOVE",
  "7": "ERASE",
  "8": "POINT",
  "9": "CAT",
  "0": "FORMAT",
};
const caps: Record<string, string> = {
  SPACE: "BREAK",
  "1": "EDIT",
  "2": "CAPS LOCK",
  "3": "TRUE VIDEO",
  "4": "INV VIDEO",
  "5": "←",
  "6": "↓",
  "7": "↑",
  "8": "→",
  "9": "GRAPHICS",
  "0": "DELETE",
};
export interface HostKeycap {
  code: string;
  key: SpectrumKey;
  keys: readonly SpectrumKey[];
  combined: boolean;
  label: string;
  chord: string;
  caption: string;
  keyword: string;
  symbol: string;
  extra: string;
  footer: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
const keys: HostKeycap[] = [];
function createKeycap(
  code: string,
  caption: string,
  x: number,
  y: number,
  width = 1,
  height = 1,
  layout = KEYBOARD_LAYOUT_ID,
): HostKeycap {
  const extendedKey = EXTENDED_CHARACTERS[EXTENDED_CODES[code]];
  const mapping = extendedKey
    ? (["SYMBOL_SHIFT", extendedKey] as const)
    : hostMapping(code, layout);
  const chord = typeof mapping === "string" ? [mapping] : mapping;
  const key = chord[chord.length - 1];
  const combined = chord.length > 1;
  return {
    code,
    key,
    keys: chord,
    combined,
    label: combined ? caption : key.replaceAll("_", " "),
    chord:
      (extendedKey ? "Extended mode → " : "") +
      chord.map((k) => k.replaceAll("_", " ")).join(" + "),
    caption,
    x,
    y,
    width,
    height,
    keyword: extendedKey
      ? `E → SS + ${key}`
      : combined
        ? `${chord[0] === "CAPS_SHIFT" ? "CS" : "SS"} + ${key}`
        : (keywords[key] ?? caps[key] ?? ""),
    symbol: combined ? (SHIFT_CODES[code] ?? "") : (symbols[key] ?? ""),
    extra: combined ? "" : (extended[key] ?? ""),
    footer: combined ? "" : (extendedShifted[key] ?? caption),
  };
}
const add = (...args: Parameters<typeof createKeycap>) =>
  keys.push(createKeycap(...args));
"1234567890".split("").forEach((k, i) => {
  add(`Digit${k}`, k, 1 + i, 0);
});
"QWERTYUIOP".split("").forEach((k, i) => {
  add(`Key${k}`, k, 1.5 + i, 1);
});
"ASDFGHJKL".split("").forEach((k, i) => {
  add(`Key${k}`, k, 1.75 + i, 2);
});
"ZXCVBNM".split("").forEach((k, i) => {
  add(`Key${k}`, k, 2.25 + i, 3);
});
add("CapsLock", "caps lock", 0, 2, 1.75);
add("BracketLeft", "[", 11.5, 1);
add("BracketRight", "]", 12.5, 1);
add("IntlBackslash", "`", 1.25, 3);
add("Enter", "return ↵", 13.5, 1, 1.5, 2);
add("ControlLeft", "control", 1, 4, 1.25);
add("AltLeft", "option ⌥", 2.25, 4, 1.25);
add("Space", "space", 4.75, 4, 5.5);
add("AltRight", "option ⌥", 10.5, 4, 1.25);
add("Minus", "−", 11, 0);
add("Equal", "=", 12, 0);
add("Backspace", "delete ⌫", 13, 0, 2);
add("Semicolon", ";", 10.75, 2);
add("Quote", '"', 11.75, 2);
add("Backslash", "\\", 12.75, 2);
add("Comma", ",", 9.25, 3);
add("Period", ".", 10.25, 3);
add("Slash", "/", 11.25, 3);
add("ArrowLeft", "←", 12, 4);
add("ArrowUp", "↑", 13, 3);
add("ArrowDown", "↓", 13, 4);
add("ArrowRight", "→", 14, 4);
export const MACBOOK_ISO_KEYS: readonly HostKeycap[] = keys;

const pcKeys: HostKeycap[] = [];
function pc(
  code: string,
  caption: string,
  x: number,
  y: number,
  width = 1,
  height = 1,
) {
  pcKeys.push(createKeycap(code, caption, x, y, width, height, PC_LAYOUT_ID));
}
pc("Backquote", "`", 0, 0);
"1234567890".split("").forEach((k, i) => {
  pc(`Digit${k}`, k, i + 1, 0);
});
pc("Minus", "−", 11, 0);
pc("Equal", "=", 12, 0);
pc("Backspace", "backspace", 13, 0, 2);
"QWERTYUIOP".split("").forEach((k, i) => {
  pc(`Key${k}`, k, i + 1.5, 1);
});
pc("BracketLeft", "[", 11.5, 1);
pc("BracketRight", "]", 12.5, 1);
pc("Enter", "enter ↵", 13.5, 1, 1.5, 2);
pc("CapsLock", "caps lock", 0, 2, 1.75);
"ASDFGHJKL".split("").forEach((k, i) => {
  pc(`Key${k}`, k, i + 1.75, 2);
});
pc("Semicolon", ";", 10.75, 2);
pc("Quote", "'", 11.75, 2);
pc("Backslash", "\\", 12.75, 2);
"ZXCVBNM".split("").forEach((k, i) => {
  pc(`Key${k}`, k, i + 2.25, 3);
});
pc("Comma", ",", 9.25, 3);
pc("Period", ".", 10.25, 3);
pc("Slash", "/", 11.25, 3);
pc("ControlLeft", "ctrl", 0, 4, 1.5);
pc("AltLeft", "alt", 2.5, 4, 1.25);
pc("Space", "space", 3.75, 4, 6.25);
pc("AltRight", "alt", 10, 4, 1.25);
pc("ControlRight", "ctrl", 13.5, 4, 1.5);
pc("Delete", "delete", 15.5, 1);
pc("ArrowLeft", "←", 15.5, 4);
pc("ArrowDown", "↓", 16.5, 4);
pc("ArrowRight", "→", 17.5, 4);
pc("ArrowUp", "↑", 16.5, 3);
pc("NumpadDivide", "/", 19.75, 0);
pc("NumpadMultiply", "*", 20.75, 0);
pc("NumpadSubtract", "−", 21.75, 0);
for (let row = 0; row < 3; row++) {
  for (let column = 0; column < 3; column++) {
    const digit = String(7 - row * 3 + column);
    pc(`Numpad${digit}`, digit, 18.75 + column, 1 + row);
  }
}
pc("NumpadAdd", "+", 21.75, 1, 1, 2);
pc("NumpadEnter", "enter", 21.75, 3, 1, 2);
pc("Numpad0", "0", 18.75, 4, 2);
pc("NumpadDecimal", ".", 20.75, 4);
export const KEYBOARD_LAYOUTS = [
  {
    id: KEYBOARD_LAYOUT_ID,
    label: "MacBook Pro ISO",
    width: 15,
    height: 5,
    keys: MACBOOK_ISO_KEYS,
  },
  {
    id: PC_LAYOUT_ID,
    label: "PC full-size",
    width: 22.75,
    height: 5,
    keys: pcKeys,
  },
] as const;
export function keyboardLayout(
  id: string,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
) {
  const resolved =
    id === "auto"
      ? /Mac|iPhone|iPad/i.test(platform)
        ? KEYBOARD_LAYOUT_ID
        : PC_LAYOUT_ID
      : id;
  return (
    KEYBOARD_LAYOUTS.find((layout) => layout.id === resolved) ??
    KEYBOARD_LAYOUTS[0]
  );
}
export function isKeyboardLayout(id: unknown): id is string {
  return KEYBOARD_LAYOUTS.some((layout) => layout.id === id);
}
