import type { MacroToken } from "../types/macro";

export const MAX_TEXT_BYTES = 256;

let tokenSequence = 0;

export function createToken(kind: MacroToken["kind"], label: string): MacroToken {
  tokenSequence += 1;
  return { id: `token-${tokenSequence}`, kind, label };
}

export function tokensFromText(text: string): MacroToken[] {
  const tokens: MacroToken[] = [];
  for (const character of text) {
    if (character === "\n") {
      tokens.push(createToken("control", "LF"));
    } else if (character === "\t") {
      tokens.push(createToken("control", "Tab"));
    } else if (character === "\b") {
      tokens.push(createToken("control", "Backspace"));
    } else {
      tokens.push(createToken("char", character));
    }
  }
  return tokens;
}

export function tokenToText(token: Pick<MacroToken, "kind" | "label">): string {
  if (token.kind !== "control") {
    return token.label;
  }
  switch (token.label) {
    case "LF":
      return "\n";
    case "Tab":
      return "\t";
    case "Backspace":
      return "\b";
    default:
      return "";
  }
}

export function textFromTokens(tokens: MacroToken[]): string {
  return tokens.map(tokenToText).join("");
}

export function macroBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function displayToken(token: Pick<MacroToken, "kind" | "label">): string {
  if (token.kind !== "control") {
    return token.label === " " ? "␠" : token.label;
  }
  switch (token.label) {
    case "LF":
      return "↵";
    case "Tab":
      return "⇥";
    case "Backspace":
      return "⌫";
    default:
      return "?";
  }
}

export function maskBytes(bytes: number): string {
  return "*".repeat(Math.max(0, bytes));
}

export function isPrintableAscii(value: string): boolean {
  for (const character of value) {
    if (character < " " || character > "~") {
      return false;
    }
  }
  return true;
}

export function tokenCode(token: Pick<MacroToken, "kind" | "label">): number {
  if (token.kind === "char") {
    return token.label.charCodeAt(0);
  }
  switch (token.label) {
    case "LF":
      return 0x0a;
    case "Tab":
      return 0x09;
    case "Backspace":
      return 0x08;
    default:
      return 0;
  }
}

export function tokenHex(token: Pick<MacroToken, "kind" | "label">): string {
  return `0x${tokenCode(token).toString(16).padStart(2, "0")}`;
}
