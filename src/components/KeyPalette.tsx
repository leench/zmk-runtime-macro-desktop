import { Plus, Type } from "lucide-react";
import { useState } from "react";
import type { Messages } from "../i18n";
import type { TokenKind } from "../types/macro";
import { paletteGroups } from "../data/keyPalette";
import { TokenIcon } from "./tokenIcons";

const ASCII_ONLY = /^[\x20-\x7e]*$/;

type KeyPaletteProps = {
  copy: Messages;
  onInsertText: (value: string) => void;
  onInsertKey: (kind: TokenKind, label: string) => void;
  disabled?: boolean;
};

function displayKey(kind: TokenKind, label: string): string {
  if (kind !== "control") return label;
  if (label === "LF") return "↵";
  if (label === "Tab") return "⇥";
  return "⌫";
}

export function KeyPalette({ copy, onInsertText, onInsertKey, disabled = false }: KeyPaletteProps) {
  const [activeGroup, setActiveGroup] = useState("control");
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const group = paletteGroups.find((item) => item.id === activeGroup) ?? paletteGroups[0];

  const insertText = () => {
    if (!text || !ASCII_ONLY.test(text)) {
      setInvalid(Boolean(text));
      return;
    }
    onInsertText(text);
    setText("");
    setInvalid(false);
  };

  return (
    <section aria-label={copy.insertCharacters} className="mt-[18px] rounded-[9px] border border-line bg-surface-2 p-4">
      <div>
        <label htmlFor="macro-insert-text" className="flex items-center gap-[7px] text-[13px] font-semibold text-ink">
          <Type className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          {copy.inputText}
        </label>
        <div className="mt-[9px] flex gap-[7px]">
          <input
            id="macro-insert-text"
            value={text}
            onChange={(event) => {
              const value = event.target.value;
              setText(value);
              setInvalid(Boolean(value) && !ASCII_ONLY.test(value));
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (text && ASCII_ONLY.test(text)) insertText();
              if (!text || ASCII_ONLY.test(text)) onInsertKey("control", "LF");
            }}
            aria-invalid={invalid}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            className={`h-9 flex-1 rounded-md border bg-surface px-[11px] font-mono text-[13px] text-ink placeholder:text-ink-subtle ${invalid ? "border-danger" : "border-line-strong"}`}
          />
          <button
            type="button"
            onClick={insertText}
            disabled={disabled || !text || invalid}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-[13px] text-[13px] font-medium text-ink transition-colors duration-150 ease-out hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-[15px] w-[15px]" aria-hidden="true" />
            {copy.insert}
          </button>
        </div>
        <p className={`mt-[7px] text-[11px] leading-[17px] ${invalid ? "text-danger" : "text-ink-subtle"}`}>
          {invalid ? copy.inputUnsupportedText : copy.asciiHelp}
        </p>
      </div>

      <div className="my-[17px] h-px bg-line" />
      <h3 className="m-0 text-xs font-semibold text-ink">{copy.insertOneByOne}</h3>
      <div className="mt-[9px] flex flex-wrap gap-[3px]" role="tablist" aria-label={copy.characterGroups}>
        {paletteGroups.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === activeGroup}
            onClick={() => setActiveGroup(item.id)}
            disabled={disabled}
            className={`min-h-[27px] rounded-[5px] px-[9px] text-[11px] font-medium transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40 ${item.id === activeGroup ? "bg-surface text-ink shadow-sm shadow-black/5" : "bg-transparent text-ink-muted hover:text-ink"}`}
          >
            {item.id === "control" ? copy.controlCharacters : item.id === "lower" ? copy.lowercase : item.id === "upper" ? copy.uppercase : item.id === "digit" ? copy.digits : copy.symbols}
          </button>
        ))}
      </div>
      <div className="mt-[11px] flex flex-wrap gap-[5px]">
        {group.keys.map((key) => (
          <button
            key={`${group.id}-${key.label}`}
            type="button"
            onClick={() => onInsertKey(key.kind, key.label)}
            disabled={disabled}
            aria-label={key.kind === "control" ? (key.label === "LF" ? copy.insertLf : key.label === "Tab" ? copy.insertTab : copy.insertBackspace) : `${copy.insertCharacter}: ${key.label}`}
            className={`inline-flex h-[30px] items-center justify-center gap-1 rounded-[5px] border border-line-strong bg-surface px-[7px] font-mono text-[11px] text-ink transition-colors duration-150 ease-out hover:border-accent hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 ${key.kind === "control" ? "min-w-[48px]" : "min-w-[29px]"}`}
          >
            <TokenIcon token={key} />
            <span>{displayKey(key.kind, key.label)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
