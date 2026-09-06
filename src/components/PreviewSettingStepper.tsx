import { ChevronDown, ChevronUp } from "lucide-react";

type PreviewSettingStepperProps = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step?: number;
  help: string;
  increaseLabel: string;
  decreaseLabel: string;
  onChange: (value: number) => void;
};

function stepValue(value: number, direction: -1 | 1, min: number, max: number, step: number): number {
  // The hover delay has one intentional gap: -1 means disabled, and the next
  // available value is 0 (there is no -0.5 state).
  if (step === 0.5 && min === -1) {
    if (direction === 1 && value === -1) return 0;
    if (direction === -1 && value === 0) return -1;
  }
  const next = value + direction * step;
  return Math.min(max, Math.max(min, Number(next.toFixed(3))));
}

export function PreviewSettingStepper({
  id,
  label,
  value,
  displayValue,
  min,
  max,
  step = 1,
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
              onClick={() => onChange(stepValue(value, 1, min, max, step))}
              disabled={increaseDisabled}
              aria-label={increaseLabel}
              className="grid h-5 w-7 place-items-center text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span className="h-px bg-line" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onChange(stepValue(value, -1, min, max, step))}
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
