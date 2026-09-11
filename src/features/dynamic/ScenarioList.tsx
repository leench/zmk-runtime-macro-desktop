import { Plus } from "lucide-react";
import type { Messages } from "../../i18n";
import type { DynamicCapabilitiesPresentation, Scenario } from "../../types/scenario";
import { objectDisplayLabel, isScenarioDirty, scenarioByteLength } from "../../utils/scenario";
import { ScenarioListItem } from "./ScenarioListItem";

type ScenarioListProps = {
  copy: Messages;
  scenarios: Scenario[];
  selectedId: string | null;
  capability: DynamicCapabilitiesPresentation | null;
  onSelect: (id: string) => void;
  onNewScenario: () => void;
};

/** Left column of the workspace: scenarios, never device dynamic objects. */
export function ScenarioList({ copy, scenarios, selectedId, capability, onSelect, onNewScenario }: ScenarioListProps) {
  const objects = capability?.objects ?? [];

  return (
    <nav aria-label={copy.dynamicScenarioListAria} className="flex w-[336px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-baseline justify-between px-7 py-6">
        <h2 className="text-xl font-semibold text-ink">{copy.dynamicScenarios}</h2>
        <span className="text-xs text-ink-subtle">{copy.dynamicScenarioCount(scenarios.length)}</span>
      </div>

      {scenarios.length === 0 ? (
        <p className="px-7 text-[13px] leading-6 text-ink-muted">{copy.dynamicNoScenarios}</p>
      ) : (
        <ul className="flex-1 overflow-y-auto px-3 pb-5">
          {scenarios.map((scenario) => {
            const targetObjectId = scenario.draft.targetObjectId;
            const index = targetObjectId ? objects.findIndex((object) => object.objectId === targetObjectId) : -1;
            const targetMissing = Boolean(targetObjectId) && capability !== null && index < 0;
            const targetLabel = !targetObjectId
              ? copy.dynamicScenarioNoTarget
              : index >= 0
                ? copy.dynamicScenarioTarget(objectDisplayLabel(objects[index], index, (position) => copy.dynamicObjectLabel(position)))
                : capability === null
                  ? copy.dynamicScenarioTargetPending
                  : copy.dynamicScenarioTargetMissingShort;
            return (
              <ScenarioListItem
                key={scenario.id}
                copy={copy}
                scenario={scenario}
                selected={scenario.id === selectedId}
                dirty={isScenarioDirty(scenario)}
                targetLabel={targetLabel}
                targetMissing={targetMissing}
                byteCount={scenarioByteLength(scenario.draft.text)}
                onSelect={() => onSelect(scenario.id)}
              />
            );
          })}
        </ul>
      )}

      <div className="shrink-0 border-t border-line px-3 py-3">
        <button
          type="button"
          onClick={onNewScenario}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line-strong text-sm font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {copy.dynamicNewScenario}
        </button>
      </div>
    </nav>
  );
}
