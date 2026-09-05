import { CircleSlash2, LoaderCircle } from "lucide-react";
import type { Messages } from "../i18n";

type SlotListItem = {
  slot: number;
  length: number;
  label: string;
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
  onSelect: (slot: number) => void;
  onMoveSelection: (offset: number) => void;
};

export function SlotList({ copy, slots, selectedSlot, disabled, onSelect, onMoveSelection }: SlotListProps) {
  return (
    <nav
      aria-label={copy.macroSlotsAria}
      className="w-[336px] shrink-0 overflow-y-auto border-r border-line bg-surface px-4 py-[18px]"
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
      <div className="mb-2.5 flex items-center justify-between px-1">
        <h2 className="m-0 text-[13px] font-semibold text-ink">{copy.macroSlots}</h2>
        <span className="font-mono text-[11px] text-ink-subtle">{copy.slotCount(slots.length)}</span>
      </div>
      {slots.length === 0 ? (
        <p className="px-1 text-[13px] leading-6 text-ink-muted">{copy.noSlotsReturned}</p>
      ) : (
        <ul className="m-0 list-none space-y-1 p-0">
          {slots.map((item) => {
            const selected = selectedSlot === item.slot;
            const empty = item.loaded && item.length === 0;
            return (
              <li key={item.slot}>
                <button
                  type="button"
                  onClick={() => onSelect(item.slot)}
                  disabled={disabled}
                  aria-current={selected ? "true" : undefined}
                  className={`flex min-h-[60px] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "border-accent bg-accent-soft" : "border-transparent hover:bg-surface-2"}`}
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono text-[12px] font-semibold ${selected ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-muted"}`}>
                    {String(item.slot + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">{item.label || copy.defaultSlotLabel(String(item.slot + 1))}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-subtle">
                      {empty ? <CircleSlash2 className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                      {item.loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                      <span>{empty ? copy.empty : item.error ? copy.slotError : item.loaded ? copy.bytes(item.length) : copy.loadingSlot}</span>
                    </span>
                  </span>
                  {item.dirty ? <span className="h-2 w-2 shrink-0 rounded-full bg-warning" title={copy.unsavedChanges} aria-label={copy.unsavedChanges} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
