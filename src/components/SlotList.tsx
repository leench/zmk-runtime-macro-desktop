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
            return (
              <li key={item.slot}>
                <div
                  className={`relative mb-1 flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left transition-colors duration-150 ease-out ${selected ? "bg-accent-soft" : "hover:bg-surface-2"}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(item.slot)}
                    disabled={disabled}
                    aria-current={selected ? "true" : undefined}
                    className="flex min-w-0 flex-1 items-center gap-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono text-sm ${selected ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-subtle"}`}>
                      {String(item.slot + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`flex items-center gap-2 truncate font-mono text-base ${empty ? "text-ink-subtle" : selected ? "text-accent" : "text-ink"}`}>
                        {empty ? (
                          <>
                            <CircleSlash2 className="h-4 w-4" aria-hidden="true" />
                            <span className="font-sans text-sm">{copy.empty}</span>
                          </>
                        ) : (
                          item.label || copy.defaultSlotLabel(String(item.slot + 1))
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs font-normal text-ink-subtle">
                        {item.loading ? <LoaderCircle className="mr-1 inline-block h-3.5 w-3.5 animate-spin align-[-2px]" aria-hidden="true" /> : null}
                        {item.error ? copy.slotError : item.loaded ? copy.bytes(item.length) : copy.loadingSlot}
                      </span>
                    </span>
                    {item.dirty ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title={copy.unsavedChanges} aria-label={copy.unsavedChanges} /> : null}
                  </button>
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
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
