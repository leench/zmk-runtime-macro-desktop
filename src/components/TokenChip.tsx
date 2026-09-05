import { X } from "lucide-react";
import type { MacroToken } from "../types/macro";
import { displayToken } from "../utils/macro";
import { TokenIcon } from "./tokenIcons";

type TokenChipProps = {
  token: MacroToken;
  selected: boolean;
  selectLabel: string;
  deleteLabel: string;
  onSelect: () => void;
  onRemove: () => void;
  masked?: boolean;
};

export function TokenChip({ token, selected, selectLabel, deleteLabel, onSelect, onRemove, masked = false }: TokenChipProps) {
  const isControl = token.kind === "control";
  const safeSelectLabel = masked ? "隐藏的宏字符" : selectLabel;
  const safeDeleteLabel = masked ? "删除隐藏的宏字符" : deleteLabel;
  return (
    <span
      className={`group relative inline-flex h-11 items-center rounded-lg border font-mono text-sm ${
        isControl ? "gap-2 border-line-strong bg-surface-2 px-3.5 text-ink-muted" : "w-11 justify-center border-line-strong bg-surface text-ink"
      } ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={masked}
        aria-pressed={selected}
        aria-label={safeSelectLabel}
        className="flex h-full w-full items-center justify-center gap-2"
      >
        {masked ? "*" : <TokenIcon token={token} />}
        {masked ? null : displayToken(token)}
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={masked}
        aria-label={safeDeleteLabel}
        className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line-strong bg-surface text-ink-subtle opacity-0 transition-opacity duration-150 ease-out hover:border-danger hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}
