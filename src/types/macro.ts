export type TokenKind = "char" | "control";

/** A single protocol-safe macro byte represented for editing. */
export type MacroToken = {
  id: string;
  kind: TokenKind;
  /** Printable ASCII character, or LF/Tab/Backspace for a control token. */
  label: string;
};

export type PaletteKey = {
  kind: TokenKind;
  label: string;
};

export type PaletteGroup = {
  id: string;
  label: string;
  keys: PaletteKey[];
};
