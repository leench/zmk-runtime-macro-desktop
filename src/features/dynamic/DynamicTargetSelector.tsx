import { AlertCircle } from "lucide-react";
import type { Messages } from "../../i18n";
import type { DynamicCapabilitiesPresentation, DynamicObjectPresentation, PreviewDeviceState } from "../../types/scenario";
import { SelectField } from "../../components/SelectField";
import { TARGET_MISSING, TARGET_NONE, objectDisplayLabel, targetRowState } from "../../utils/scenario";

type DynamicTargetSelectorProps = {
  copy: Messages;
  capability: DynamicCapabilitiesPresentation | null;
  device: PreviewDeviceState;
  targetObjectId: string | null;
  disabled: boolean;
  onTargetChange: (objectId: string | null) => void;
};

function objectLabel(copy: Messages, object: DynamicObjectPresentation, index: number): string {
  return objectDisplayLabel(object, index, (position) => copy.dynamicObjectLabel(position));
}

/**
 * Capability-driven target object row. A single-object device keeps a read-only
 * row that only shows its object once the saved target resolves; multiple
 * objects become a selector built from the reported collection. A saved target
 * that is gone is reported instead of being remapped.
 */
export function DynamicTargetSelector({ copy, capability, device, targetObjectId, disabled, onTargetChange }: DynamicTargetSelectorProps) {
  const objects = capability?.objects ?? [];
  const { value: selectorValue, missing, soleObject, soleObjectBound } = targetRowState(capability, targetObjectId);
  const pending = !capability && device !== "ready" && device !== "unsupported";
  const options = [
    { value: TARGET_NONE, label: copy.dynamicTargetChoose },
    ...(missing ? [{ value: TARGET_MISSING, label: copy.dynamicTargetUnavailable }] : []),
    ...objects.map((object, index) => ({ value: object.objectId, label: objectLabel(copy, object, index) })),
  ];
  const help = !capability
    ? copy.dynamicTargetPendingHelp
    : objects.length === 0
      ? copy.dynamicNoObjects
      : soleObject && !missing
        ? copy.dynamicTargetSingleHelp
        : copy.dynamicObjectHelp;

  return (
    <div className="min-w-0">
      <span id="dynamic-target-object-label" className="block text-sm font-medium text-ink">{copy.dynamicTargetObject}</span>
      <div className="mt-2.5">
        {!capability ? (
          <p aria-labelledby="dynamic-target-object-label" className="flex h-11 items-center rounded-xl border border-line bg-surface-2 px-3.5 text-sm text-ink-subtle">
            {pending ? copy.dynamicTargetPending : copy.dynamicTargetUnavailable}
          </p>
        ) : soleObject ? (
          <div className="flex items-center gap-2">
            <p
              aria-labelledby="dynamic-target-object-label"
              className={`flex h-11 min-w-0 flex-1 items-center truncate rounded-xl border bg-surface px-3.5 text-sm ${missing ? "border-danger text-danger" : "border-line-strong font-mono text-ink"}`}
            >
              {missing ? copy.dynamicTargetUnavailable : objectLabel(copy, soleObject, 0)}
            </p>
            {soleObjectBound ? null : (
              <button
                type="button"
                onClick={() => onTargetChange(soleObject.objectId)}
                disabled={disabled}
                className="inline-flex h-11 shrink-0 items-center rounded-xl border border-line-strong px-3.5 text-sm font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copy.dynamicTargetUseOnly}
              </button>
            )}
          </div>
        ) : (
          <SelectField
            id="dynamic-target-object"
            value={selectorValue}
            options={options}
            labelledBy="dynamic-target-object-label"
            onChange={(value) => {
              if (value === TARGET_MISSING) return;
              onTargetChange(value === TARGET_NONE ? null : value);
            }}
            disabled={disabled}
          />
        )}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">{help}</p>
      {missing ? (
        <p className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed text-danger" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {copy.dynamicTargetMissingHelp}
        </p>
      ) : null}
    </div>
  );
}
