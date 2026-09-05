import { ChevronDown, ChevronUp } from "lucide-react";

type PreviewSettingStepperProps = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  help: string;
  increaseLabel: string;
  decreaseLabel: string;
  onChange: (value: number) => void;
};

export function PreviewSettingStepper({
  id,
  label,
  value,
  displayValue,
  min,
  max,
  help,
  increaseLabel,
  decreaseLabel,
  onChange,
}: PreviewSettingStepperProps) {
  const decreaseDisabled = value <= min;
  const increaseDisabled = value >= max;

  return (
    <div role="group" aria-labelledby={`${id}-label`}>
      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-label`} className="text-sm font-medium text-ink">{label}</span>
        <div className="flex shrink-0 items-center gap-2">
          <output id={`${id}-value`} className="min-w-[4.5rem] text-right font-mono text-sm text-ink" aria-live="polite">{displayValue}</output>
          <span className="flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface">
            <button
              type="button"
              onClick={() => onChange(Math.min(max, value + 1))}
              disabled={increaseDisabled}
              aria-label={increaseLabel}
              className="grid h-5 w-7 place-items-center text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span className="h-px bg-line" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onChange(Math.max(min, value - 1))}
              disabled={decreaseDisabled}
              aria-label={decreaseLabel}
              className="grid h-5 w-7 place-items-center text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">{help}</p>
    </div>
  );
}
