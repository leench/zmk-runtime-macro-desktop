import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

type SelectOption<T extends string> = {
  value: T;
  label: string;
};

type SelectFieldProps<T extends string> = {
  id: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  labelledBy: string;
  disabled?: boolean;
};

export function SelectField<T extends string>({
  id,
  value,
  options,
  onChange,
  labelledBy,
  disabled = false,
}: SelectFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const activeOption = options[activeIndex] ?? options[selectedIndex];
  const activeOptionId = activeOption ? `${listboxId}-option-${activeIndex}` : undefined;
  const selectedValueId = `${listboxId}-selected-value`;
  const selectedOption = options[selectedIndex] ?? options[0];
  const visibleOpen = open && !disabled;

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setActiveIndex(selectedIndex);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (nextValue: T) => {
    onChange(nextValue);
    close(true);
  };

  useEffect(() => {
    if (disabled && open) close(false);
  }, [disabled, open]);

  useEffect(() => {
    if (!visibleOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [selectedIndex, visibleOpen]);

  useEffect(() => {
    if (!options.some((option) => option.value === value)) return;
    setActiveIndex((current) => current >= 0 && current < options.length ? current : selectedIndex);
  }, [options, selectedIndex, value]);

  const move = (direction: -1 | 1) => {
    if (options.length === 0) return;
    setActiveIndex((current) => (current + direction + options.length) % options.length);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          setActiveIndex(selectedIndex);
          setOpen(true);
        } else {
          move(1);
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          setActiveIndex(selectedIndex);
          setOpen(true);
        } else {
          move(-1);
        }
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        setOpen(true);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(0, options.length - 1));
        setOpen(true);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open && activeOption) choose(activeOption.value);
        else setOpen(true);
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          close(true);
        }
        break;
      case "Tab":
        if (open) close(false);
        break;
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={visibleOpen}
        aria-controls={listboxId}
        aria-labelledby={`${labelledBy} ${selectedValueId}`}
        aria-activedescendant={visibleOpen ? activeOptionId : undefined}
        disabled={disabled}
        onClick={() => {
          if (visibleOpen) close(false);
          else {
            setActiveIndex(selectedIndex);
            setOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          if (!containerRef.current?.contains(event.relatedTarget as Node | null)) close(false);
        }}
        className={`flex h-11 w-full items-center justify-between gap-3 rounded-xl border bg-surface px-3.5 text-left text-sm text-ink transition-colors focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${open ? "border-accent" : "border-line-strong hover:border-accent"}`}
      >
        <span id={selectedValueId} className="truncate">{selectedOption?.label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-150 ease-out ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {visibleOpen ? (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={labelledBy}
          className="absolute left-0 top-full z-30 mt-2 max-h-60 w-full overflow-auto rounded-xl border border-line bg-surface p-1.5 shadow-xl shadow-black/10"
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <div
                id={`${listboxId}-option-${index}`}
                key={option.value}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.value)}
                className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${selected ? "bg-accent-soft text-accent" : `text-ink hover:bg-surface-2 ${active ? "bg-surface-2" : ""}`}`}
              >
                <span className="truncate">{option.label}</span>
                {selected ? <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
