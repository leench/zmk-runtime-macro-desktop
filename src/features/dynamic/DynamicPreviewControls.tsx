import { FlaskConical } from "lucide-react";
import type { Messages } from "../../i18n";
import type { PreviewStateId } from "../../types/scenario";
import { PREVIEW_STATES } from "../../types/scenario";
import { SelectField } from "../../components/SelectField";

type DynamicPreviewControlsProps = {
  copy: Messages;
  state: PreviewStateId;
  onChange: (state: PreviewStateId) => void;
};

/**
 * State switcher for the UI-only stage. It is visibly marked as a preview and
 * only reloads in-memory fixtures: no device, no storage, no persistence.
 */
export function DynamicPreviewControls({ copy, state, onChange }: DynamicPreviewControlsProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-dashed border-line-strong bg-surface-2 px-10 py-2.5">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-ink-muted">
        <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
        {copy.dynamicPreviewBadge}
      </span>
      <span id="dynamic-preview-state-label" className="text-sm font-medium text-ink-muted">{copy.dynamicPreviewStateLabel}</span>
      <div className="w-[260px] shrink-0">
        <SelectField
          id="dynamic-preview-state"
          value={state}
          options={PREVIEW_STATES.map((id) => ({ value: id, label: copy.dynamicPreviewStateLabels[id] }))}
          labelledBy="dynamic-preview-state-label"
          onChange={onChange}
        />
      </div>
      <p className="min-w-[220px] flex-1 text-xs leading-relaxed text-ink-subtle">{copy.dynamicPreviewStateHelp}</p>
    </div>
  );
}
