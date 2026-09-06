import { CircleSlash2, LoaderCircle } from "lucide-react";
import type { Messages } from "../i18n";
import { SlotPreview } from "./SlotPreview";

type SlotListItem = {
  slot: number;
  length: number;
  label: string;
  text: string | null;
  loaded: boolean;
  dirty: boolean;
  loading: boolean;
  error: boolean;
};

type SlotListProps = {
  copy: Messages;
  slots: SlotListItem[];
  selectedSlot: number | null;
  disabled: boolean;
  previewCharacterCount: number;
  hoverRevealDelay: number;
  onSelect: (slot: number) => void;
  onMoveSelection: (offset: number) => void;
};

export function SlotList({
  copy,
  slots,
  selectedSlot,
  disabled,
  previewCharacterCount,
  hoverRevealDelay,
  onSelect,
  onMoveSelection,
}: SlotListProps) {
  return (
    <nav
      aria-label={copy.macroSlotsAria}
      className="flex w-[336px] shrink-0 flex-col border-r border-line bg-surface"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          onMoveSelection(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          onMoveSelection(-1);
        }
      }}
    >
      <div className="flex items-baseline justify-between px-7 py-6">
        <h2 className="text-xl font-semibold text-ink">{copy.macroSlots}</h2>
        <span className="text-xs text-ink-subtle">{copy.slotCount(slots.length)}</span>
      </div>

      {slots.length === 0 ? (
        <p className="px-7 text-[13px] leading-6 text-ink-muted">{copy.noSlotsReturned}</p>
      ) : (
        <ul className="flex-1 overflow-y-auto px-3 pb-5">
          {slots.map((item) => {
            const selected = selectedSlot === item.slot;
            const empty = item.loaded && item.length === 0;
            const status = item.error ? copy.slotError : item.loading ? copy.loadingSlot : null;
            const previewInteractive = !disabled && item.loaded && !item.loading && !item.error && item.text !== null;
            return (
              <li key={item.slot} className="group relative mb-1">
                <button
                  type="button"
                  onClick={() => onSelect(item.slot)}
                  disabled={disabled}
                  aria-current={selected ? "true" : undefined}
                  aria-label={copy.slotLabel(String(item.slot + 1).padStart(2, "0"))}
                  className={`absolute inset-0 z-0 rounded-xl transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${selected ? "bg-accent-soft" : "group-hover:bg-surface-2"} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <span className="sr-only">{copy.slotLabel(String(item.slot + 1).padStart(2, "0"))}</span>
                </button>

                <div className="relative z-10 pointer-events-none grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-4 rounded-xl px-4 py-3.5 text-left">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono text-sm transition-colors ${selected ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-subtle"}`}>
                    {String(item.slot + 1).padStart(2, "0")}
                  </span>

                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {empty ? (
                        <span className="flex min-w-0 items-center gap-2 truncate font-mono text-base text-ink-subtle">
                          <CircleSlash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="font-sans text-sm">{copy.empty}</span>
                        </span>
                      ) : (
                        <span
                          className={previewInteractive ? "pointer-events-auto" : "pointer-events-none"}
                          onClick={() => { if (previewInteractive) onSelect(item.slot); }}
                        >
                          <SlotPreview
                            copy={copy}
                            text={item.text}
                            length={item.length}
                            loaded={item.loaded}
                            loading={item.loading}
                            error={item.error}
                            selected={selected}
                            disabled={disabled}
                            previewCharacterCount={previewCharacterCount}
                            hoverRevealDelay={hoverRevealDelay}
                            className={`${previewInteractive ? "pointer-events-auto" : "pointer-events-none"} w-full max-w-full justify-start text-left`}
                          />
                        </span>
                      )}
                      {status ? (
                        <span className="flex min-w-0 shrink-0 items-center gap-1 text-xs text-ink-subtle">
                          {item.loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                          <span className="truncate">{status}</span>
                        </span>
                      ) : null}
                      {item.dirty ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title={copy.unsavedChanges} aria-label={copy.unsavedChanges} /> : null}
                    </div>
                    <span className={`mt-0.5 block max-w-full truncate text-xs font-normal text-ink-subtle transition-colors ${selected ? "text-ink-muted" : ""}`}>
                      {item.label || copy.unnamedSlot}
                    </span>
                  </div>

                  {!empty ? <span className="shrink-0 font-mono text-xs text-ink-subtle">{copy.bytes(item.length)}</span> : <span aria-hidden="true" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
