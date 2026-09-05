import type { PaletteGroup } from "../types/macro";

const lower = Array.from("abcdefghijklmnopqrstuvwxyz");
const upper = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
const digits = Array.from("0123456789");
const symbols = Array.from("`-=[]\\;',./~!@#$%^&*()_+{}|:\"<>?");

/** Protocol-safe palette: Enter is represented by LF; the unsupported escape key is absent. */
export const paletteGroups: PaletteGroup[] = [
  {
    id: "control",
    label: "控制字符",
    keys: [
      { kind: "control", label: "LF" },
      { kind: "control", label: "Tab" },
      { kind: "control", label: "Backspace" },
    ],
  },
  { id: "lower", label: "小写字母", keys: lower.map((label) => ({ kind: "char" as const, label })) },
  { id: "upper", label: "大写字母", keys: upper.map((label) => ({ kind: "char" as const, label })) },
  { id: "digit", label: "数字", keys: digits.map((label) => ({ kind: "char" as const, label })) },
  { id: "symbol", label: "符号", keys: symbols.map((label) => ({ kind: "char" as const, label })) },
];
