import { Plus, Zap } from "lucide-react";
import type { Messages } from "../../i18n";

type ScenarioEmptyStateProps = {
  copy: Messages;
  onNewScenario: () => void;
};

/** Empty state of the workspace body; it never implies device content. */
export function ScenarioEmptyState({ copy, onNewScenario }: ScenarioEmptyStateProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col items-center justify-center bg-canvas px-8 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Zap className="h-7 w-7" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-xl font-semibold text-ink">{copy.dynamicEmptyTitle}</h2>
      <p className="mt-2 max-w-[460px] text-sm leading-relaxed text-ink-muted">{copy.dynamicEmptyHelp}</p>
      <button
        type="button"
        onClick={onNewScenario}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink transition-opacity duration-150 ease-out hover:opacity-90"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {copy.dynamicNewScenario}
      </button>
    </section>
  );
}
