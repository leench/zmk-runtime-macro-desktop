import { AlertCircle, Zap } from "lucide-react";
import type { Messages } from "../../i18n";
import type { Scenario } from "../../types/scenario";

type ScenarioListItemProps = {
  copy: Messages;
  scenario: Scenario;
  selected: boolean;
  dirty: boolean;
  targetLabel: string;
  targetMissing: boolean;
  byteCount: number;
  onSelect: () => void;
};

/** One scenario row: name, target description, draft state and byte count. */
export function ScenarioListItem({ copy, scenario, selected, dirty, targetLabel, targetMissing, byteCount, onSelect }: ScenarioListItemProps) {
  const name = scenario.draft.name.trim() || copy.dynamicUntitledScenario;
  return (
    <li className="group relative mb-1">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={name}
        className={`absolute inset-0 z-0 rounded-xl transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${selected ? "bg-accent-soft" : "group-hover:bg-surface-2"}`}
      >
        <span className="sr-only">{name}</span>
      </button>

      <div className="pointer-events-none relative z-10 grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-4 rounded-xl px-4 py-3.5 text-left">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors ${selected ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-subtle"}`}>
          <Zap className="h-4 w-4" aria-hidden="true" />
        </span>

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{name}</span>
            {dirty ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title={copy.unsavedChanges} aria-label={copy.unsavedChanges} /> : null}
            {targetMissing ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-danger" aria-label={copy.dynamicTargetMissingShort} /> : null}
          </div>
          <span className={`mt-0.5 block max-w-full truncate text-xs ${targetMissing ? "text-danger" : "text-ink-subtle"}`}>{targetLabel}</span>
        </div>

        <span className="shrink-0 font-mono text-xs text-ink-subtle">{copy.bytes(byteCount)}</span>
      </div>
    </li>
  );
}
