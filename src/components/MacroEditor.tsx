import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Info, Keyboard, RotateCcw, Save, Trash2 } from "lucide-react";
import type { Messages } from "../i18n";
import type { TokenKind } from "../types/macro";
import { macroBytes, tokensFromText } from "../utils/macro";
import { KeyPalette } from "./KeyPalette";
import { TokenChip } from "./TokenChip";

type MacroEditorProps = {
  copy: Messages;
  slotNumber: number;
  label: string;
  text: string;
  loaded: boolean;
  loading: boolean;
  revealed: boolean;
  dirty: boolean;
  status: "idle" | "saving" | "saved" | "error";
  canManage: boolean;
  disabled: boolean;
  clearPending: boolean;
  savedAt: string | null;
  errorMessage: string | null;
  inputErrorMessage: string | null;
  onLabelChange: (value: string) => void;
  onRevealToggle: () => void;
  onAdd: () => void;
  onInsertText: (value: string) => void;
  onInsertKey: (kind: TokenKind, label: string) => void;
  onRemoveToken: (index: number) => void;
  onMoveToken: (index: number, offset: number) => void;
  onClearRequest: () => void;
  onClearConfirm: () => void;
  onClearCancel: () => void;
  onSave: () => void;
  onRevert: () => void;
  onRetry: () => void;
};

function slotLabel(slotNumber: number, copy: Messages): string {
  return copy.slotLabel(String(slotNumber + 1).padStart(2, "0"));
}

function savedLabel(savedAt: string | null, copy: Messages): string {
  return savedAt ? copy.lastSaved : copy.neverSaved;
}

export function MacroEditor({
  copy,
  slotNumber,
  label,
  text,
  loaded,
  loading,
  revealed,
  dirty,
  status,
  canManage,
  disabled,
  clearPending,
  savedAt,
  errorMessage,
  inputErrorMessage,
  onLabelChange,
  onRevealToggle,
  onAdd,
  onInsertText,
  onInsertKey,
  onRemoveToken,
  onMoveToken,
  onClearRequest,
  onClearConfirm,
  onClearCancel,
  onSave,
  onRevert,
  onRetry,
}: MacroEditorProps) {
  const tokens = useMemo(() => tokensFromText(text), [text]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const byteCount = loaded ? macroBytes(text) : 0;
  const selectedCanMove = selectedIndex !== null && tokens.length > 1;
  const selectedAtStart = selectedIndex === 0;
  const selectedAtEnd = selectedIndex !== null && selectedIndex === tokens.length - 1;

  useEffect(() => setSelectedIndex(null), [slotNumber]);
  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= tokens.length) setSelectedIndex(tokens.length > 0 ? tokens.length - 1 : null);
  }, [selectedIndex, tokens.length]);

  const appendText = (value: string) => {
    onInsertText(value);
    setSelectedIndex(tokens.length + value.length - 1);
  };
  const appendKey = (kind: TokenKind, keyLabel: string) => {
    onInsertKey(kind, keyLabel);
    setSelectedIndex(tokens.length);
  };
  const removeToken = (index: number) => {
    onRemoveToken(index);
    setSelectedIndex(index > 0 ? index - 1 : null);
  };
  const moveToken = (offset: number) => {
    if (selectedIndex === null) return;
    onMoveToken(selectedIndex, offset);
    setSelectedIndex(selectedIndex + offset);
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-labelledby="inspector-heading">
      <div className="flex-1 overflow-y-auto px-10 py-8">
        <div className="mx-auto max-w-[820px]">
          <header className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{slotLabel(slotNumber, copy)}</p>
              <h1 id="inspector-heading" className="mt-1.5 truncate text-2xl font-semibold text-ink">{label || copy.defaultSlotLabel(String(slotNumber + 1).padStart(2, "0"))}</h1>
            </div>
            <p className={`mt-1 shrink-0 text-xs ${dirty ? "text-warning" : status === "saved" ? "text-success" : "text-ink-subtle"}`} aria-live="polite">
              {status === "saving" ? copy.saving : status === "saved" ? copy.saved : dirty ? copy.unsavedChanges : savedLabel(savedAt, copy)}
            </p>
          </header>

          <div className="mt-8">
            <label htmlFor="slot-label" className="text-sm font-medium text-ink-muted">{copy.name}</label>
            <input
              id="slot-label"
              type="text"
              value={label}
              maxLength={64}
              onChange={(event) => onLabelChange(event.target.value)}
              disabled={!loaded || disabled}
              autoComplete="off"
              placeholder={copy.defaultSlotLabel(String(slotNumber + 1).padStart(2, "0"))}
              className="mt-2.5 h-12 w-full rounded-xl border border-line-strong bg-surface px-4 text-base text-ink placeholder:text-ink-subtle"
            />
            <p className="mt-2 text-xs text-ink-subtle">{copy.localLabelHelp}</p>
          </div>

          <div className="mt-9">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">{copy.macro}</h2>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-ink-subtle">{copy.bytes(byteCount)}</span>
                {revealed ? (
                  <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1" aria-label={copy.tokenActions}>
                    <button type="button" onClick={() => moveToken(-1)} disabled={disabled || !selectedCanMove || selectedAtStart} aria-label={copy.moveLeft} title={copy.moveLeft} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35">
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => moveToken(1)} disabled={disabled || !selectedCanMove || selectedAtEnd} aria-label={copy.moveRight} title={copy.moveRight} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35">
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <span className="mx-0.5 h-5 w-px bg-line" aria-hidden="true" />
                    <button type="button" onClick={() => selectedIndex !== null && removeToken(selectedIndex)} disabled={disabled || selectedIndex === null} aria-label={copy.deleteToken} title={copy.deleteToken} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-35">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {loading ? (
              <div className="mt-3.5 grid min-h-[176px] place-items-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 text-center text-sm text-ink-muted" aria-live="polite">{copy.loadingSlot}</div>
            ) : errorMessage ? (
              <div className="mt-3.5 flex min-h-[176px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-danger bg-danger-soft px-6 text-center text-sm text-danger" role="alert">
                <span>{errorMessage}</span>
                <button type="button" onClick={onRetry} disabled={disabled || !canManage} className="rounded-lg border border-danger px-3 py-2 text-sm font-medium hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-50">{copy.retry}</button>
              </div>
            ) : !revealed && text.length === 0 ? (
              <div className="mt-3.5 grid min-h-[176px] place-items-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 text-center">
                <div>
                  <Keyboard className="mx-auto h-7 w-7 text-ink-subtle" aria-hidden="true" />
                  <p className="mt-3 text-base font-medium text-ink">{copy.noMacroConfigured}</p>
                  <button type="button" onClick={onAdd} disabled={!loaded || disabled || !canManage} className="mt-3 inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity duration-150 ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-subtle">{copy.addMacro}</button>
                </div>
              </div>
            ) : (
              <div className="relative mt-3.5">
                {revealed ? (
                  <div className="flex min-h-[176px] flex-wrap content-start gap-2.5 rounded-2xl border border-line bg-surface p-5" onClick={(event) => { if (event.target === event.currentTarget) setSelectedIndex(null); }}>
                    {tokens.length > 0 ? tokens.map((token, index) => (
                      <TokenChip
                        key={token.id}
                        token={token}
                        selected={selectedIndex === index}
                        selectLabel={`${copy.selectToken}: ${token.kind === "control" ? token.label : "character"}`}
                        deleteLabel={`${copy.deleteToken}: ${token.kind === "control" ? token.label : "character"}`}
                        onSelect={() => setSelectedIndex(selectedIndex === index ? null : index)}
                        onRemove={() => removeToken(index)}
                      />
                    )) : <span className="self-center text-sm text-ink-muted">{copy.startTyping}</span>}
                  </div>
                ) : (
                  <div className="flex min-h-[176px] flex-wrap content-start gap-2.5 rounded-2xl border border-line bg-surface p-5" aria-label={copy.macroHidden}>
                    {tokens.map((token) => (
                      <TokenChip
                        key={token.id}
                        token={token}
                        selected={false}
                        selectLabel="隐藏的宏字符"
                        deleteLabel="删除隐藏的宏字符"
                        onSelect={() => undefined}
                        onRemove={() => undefined}
                        masked
                      />
                    ))}
                  </div>
                )}
                <button type="button" onClick={onRevealToggle} disabled={disabled || !canManage} aria-pressed={revealed} className="absolute bottom-3 right-3 rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">
                  {revealed ? copy.hide : copy.reveal}
                </button>
              </div>
            )}
            <p className="mt-2.5 text-xs text-ink-subtle">{copy.macroControlHelp}</p>
            {inputErrorMessage ? <p className="mt-2 text-sm text-danger" role="alert">{inputErrorMessage}</p> : null}
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-xs leading-relaxed text-ink-muted">
              <Info className="mt-px h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
              <span>{copy.protocolTextHelp}</span>
            </p>
          </div>

          {revealed ? <KeyPalette copy={copy} onInsertText={appendText} onInsertKey={appendKey} disabled={disabled || !canManage} /> : null}
        </div>
      </div>

      <footer className="shrink-0 border-t border-line bg-surface px-10 py-5">
        <div className="mx-auto flex max-w-[820px] items-center gap-4">
          <div>
            {clearPending ? (
              <div className="flex items-center gap-2" role="alert">
                <span className="mr-1 text-sm text-ink-muted">{copy.clearThisMacro}</span>
                <button type="button" onClick={onClearCancel} disabled={disabled} className="inline-flex h-10 items-center rounded-lg border border-line-strong px-3.5 text-sm font-medium text-ink-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40">{copy.cancel}</button>
                <button type="button" onClick={onClearConfirm} disabled={disabled} className="inline-flex h-10 items-center rounded-lg bg-danger px-3.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">{copy.clear}</button>
              </div>
            ) : (
              <button type="button" onClick={onClearRequest} disabled={!canManage || disabled || !loaded || byteCount === 0} className="inline-flex h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-medium text-danger transition-colors duration-150 ease-out hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {copy.clearMacro}
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {dirty ? <button type="button" onClick={onRevert} disabled={disabled} className="inline-flex h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="h-4 w-4" aria-hidden="true" />{copy.revert}</button> : null}
            <button type="button" onClick={onSave} disabled={!dirty || disabled || !canManage || status === "saving"} className="inline-flex h-11 items-center gap-2.5 rounded-lg bg-accent px-6 text-sm font-semibold text-accent-ink transition-[background-color,opacity] duration-150 ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-subtle">
              <Save className="h-4 w-4" aria-hidden="true" />
              {status === "saving" ? copy.saving : copy.save}
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}
