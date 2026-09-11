import { AlertCircle, CloudUpload, Eraser, Info, RotateCcw, Save, Trash2 } from "lucide-react";
import type { Messages } from "../../i18n";
import type {
  DynamicCapabilitiesPresentation,
  DynamicObjectPresentation,
  DynamicObservation,
  PreviewDeviceState,
  PreviewNotice,
  Scenario,
} from "../../types/scenario";
import { SelectField } from "../../components/SelectField";
import { dynamicTtlPresets } from "../../utils/dynamic";
import {
  type ScenarioBlocker,
  hasScenarioContent,
  isScenarioDirty,
  objectLimits,
  scenarioByteLength,
} from "../../utils/scenario";
import { DynamicCapabilityDetails } from "./DynamicCapabilityDetails";
import { DynamicTargetSelector } from "./DynamicTargetSelector";

type ScenarioEditorProps = {
  copy: Messages;
  scenario: Scenario;
  device: PreviewDeviceState;
  staticLocked: boolean;
  notice: PreviewNotice;
  capability: DynamicCapabilitiesPresentation | null;
  observation: DynamicObservation;
  targetObject: DynamicObjectPresentation | null;
  targetIndex: number;
  uploadBlockers: ScenarioBlocker[];
  clearBlockers: ScenarioBlocker[];
  onNameChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onTtlChange: (value: number | null) => void;
  onKeepChange: (value: boolean) => void;
  onTargetChange: (objectId: string | null) => void;
  onSave: () => void;
  onUploadRequest: () => void;
  onClearRequest: () => void;
  onDeleteRequest: () => void;
  onResetObservation: () => void;
};

function deviceStateLabel(copy: Messages, device: PreviewDeviceState): string {
  if (device === "ready") return copy.dynamicDeviceReady;
  if (device === "disconnected") return copy.statusDisconnected;
  if (device === "discovering") return copy.dynamicStatusDiscovering;
  if (device === "unsupported") return copy.dynamicStatusUnsupported;
  return copy.dynamicStatusUnknown;
}

function observationTitle(copy: Messages, observation: DynamicObservation): string {
  if (observation.status === "uploading") return copy.dynamicStatusUploading;
  if (observation.status === "committed") return copy.dynamicStatusCommitted;
  if (observation.status === "clearing") return copy.dynamicStatusClearing;
  if (observation.status === "cleared") return copy.dynamicStatusCleared;
  if (observation.status === "error") return copy.dynamicStatusError;
  return copy.dynamicStatusUnknown;
}

function observationMessage(copy: Messages, observation: DynamicObservation): string {
  if (observation.status === "uploading") return copy.dynamicObservationUploading;
  if (observation.status === "committed") return copy.dynamicObservationCommitted;
  if (observation.status === "clearing") return copy.dynamicObservationClearing;
  if (observation.status === "cleared") return copy.dynamicObservationCleared;
  if (observation.status === "error") {
    if (observation.errorKind === "timeout") return copy.dynamicObservationErrorTimeout;
    if (observation.errorKind === "unsupported") return copy.dynamicObservationErrorUnsupported;
    return copy.dynamicObservationErrorInterrupted;
  }
  return copy.dynamicObservationNone;
}

function blockerMessage(copy: Messages, blocker: ScenarioBlocker, maximum: number | null): string {
  switch (blocker) {
    case "deviceDisconnected":
      return copy.dynamicBlockerDisconnected;
    case "deviceUnknown":
      return copy.dynamicBlockerUnknown;
    case "capabilityDiscovering":
      return copy.dynamicStatusDiscovering;
    case "dynamicUnsupported":
      return copy.dynamicUnsupportedHelp;
    case "operationInProgress":
      return copy.dynamicBlockerOperating;
    case "targetMissing":
      return copy.dynamicTargetMissingHelp;
    case "textEmpty":
      return copy.dynamicTextRequired;
    case "textUnsupported":
      return copy.dynamicUnsupportedText;
    case "textTooLong":
      return maximum === null ? copy.dynamicTextRequired : copy.dynamicTextTooLong(maximum);
    case "ttlInvalid":
      return copy.dynamicTtlInvalid;
    default:
      return copy.dynamicScenarioKeepUnsupported;
  }
}

function observationTargetLabel(
  copy: Messages,
  capability: DynamicCapabilitiesPresentation | null,
  observation: DynamicObservation,
): string | null {
  if (!observation.targetObjectId) return null;
  const index = capability ? capability.objects.findIndex((object) => object.objectId === observation.targetObjectId) : -1;
  return index >= 0 ? copy.dynamicObjectLabel(index + 1) : copy.dynamicTargetUnavailable;
}

/**
 * Right column of the workspace: the selected scenario, its upload target and
 * the local observation. Text and TTL stay in React memory only.
 */
export function ScenarioEditor({
  copy,
  scenario,
  device,
  staticLocked,
  notice,
  capability,
  observation,
  targetObject,
  targetIndex,
  uploadBlockers,
  clearBlockers,
  onNameChange,
  onTextChange,
  onTtlChange,
  onKeepChange,
  onTargetChange,
  onSave,
  onUploadRequest,
  onClearRequest,
  onDeleteRequest,
  onResetObservation,
}: ScenarioEditorProps) {
  const dirty = isScenarioDirty(scenario);
  const saveable = dirty && hasScenarioContent(scenario);
  const byteCount = scenarioByteLength(scenario.draft.text);
  const limits = targetObject ? objectLimits(targetObject) : null;
  const presets = limits ? dynamicTtlPresets(limits) : [];
  const ttlSelection = scenario.draft.ttlSeconds === null ? "default" : presets.includes(scenario.draft.ttlSeconds) ? String(scenario.draft.ttlSeconds) : "custom";
  const ttlOptions: ReadonlyArray<{ value: string; label: string }> = limits
    ? [
      { value: "default", label: copy.dynamicTtlDefault(limits.defaultTtlSeconds) },
      { value: "custom", label: copy.dynamicTtlCustom },
      ...presets.map((seconds) => ({ value: String(seconds), label: `${seconds} ${copy.seconds}` })),
    ]
    : [];
  const oversize = limits !== null && byteCount > limits.maxBytes;
  const keepBlocked = scenario.draft.keepAfterExecute && targetObject !== null && !targetObject.supportsKeepAfterExecute;
  const controlsDisabled = device !== "ready" || !targetObject;
  const keepDisabled = controlsDisabled || !targetObject.supportsKeepAfterExecute;
  const blockers = uploadBlockers.length > 0 ? uploadBlockers.slice(0, 3) : clearBlockers.slice(0, 1);
  const informationalOnly = blockers.every((blocker) => blocker === "capabilityDiscovering");
  const observationTarget = observationTargetLabel(copy, capability, observation);
  const canResetObservation = observation.status === "committed" || observation.status === "cleared" || observation.status === "error";

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-labelledby="scenario-heading">
      <div className="flex-1 overflow-y-auto px-10 py-8">
        <div className="mx-auto max-w-[820px]">
          <header className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{copy.dynamicScenarioEyebrow}</p>
              <h1 id="scenario-heading" className="mt-1.5 truncate text-2xl font-semibold text-ink">{scenario.draft.name.trim() || copy.dynamicUntitledScenario}</h1>
            </div>
            <p className={`mt-1 shrink-0 text-xs ${dirty ? "text-warning" : "text-ink-subtle"}`} aria-live="polite">
              {scenario.isNew ? copy.neverSaved : dirty ? copy.unsavedChanges : copy.dynamicScenarioSavedLocally}
            </p>
          </header>

          <div className="mt-8">
            <label htmlFor="scenario-name" className="text-sm font-medium text-ink-muted">{copy.dynamicScenarioName}</label>
            <input
              id="scenario-name"
              type="text"
              value={scenario.draft.name}
              maxLength={64}
              autoComplete="off"
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={copy.dynamicUntitledScenario}
              className="mt-2.5 h-12 w-full rounded-xl border border-line-strong bg-surface px-4 text-base text-ink placeholder:text-ink-subtle"
            />
            <p className="mt-2 text-xs text-ink-subtle">{copy.dynamicScenarioNameHelp}</p>
          </div>

          <div className="mt-9">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">{copy.dynamicMacroText}</h2>
              <span className={`font-mono text-xs ${oversize ? "text-danger" : "text-ink-subtle"}`}>
                {limits ? copy.dynamicBytes(byteCount, limits.maxBytes) : copy.bytes(byteCount)}
              </span>
            </div>
            <textarea
              id="scenario-text"
              value={scenario.draft.text}
              rows={6}
              spellCheck={false}
              aria-label={copy.dynamicMacroText}
              aria-invalid={oversize}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder={copy.dynamicMacroPlaceholder}
              className={`mt-3.5 min-h-[176px] w-full resize-y rounded-2xl border bg-surface px-5 py-4 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-subtle ${oversize ? "border-danger" : "border-line"}`}
            />
            <small className="mt-2 block text-xs text-ink-subtle">{limits ? copy.dynamicMacroTextHelp(limits.maxBytes) : copy.dynamicTextHelpPending}</small>
          </div>

          <div className="mt-9 rounded-2xl border border-line bg-surface-2 px-5 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">{copy.dynamicTarget}</h2>
              <span className="flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5 text-xs text-ink-muted" role="status">
                {device === "ready" ? <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" /> : <AlertCircle className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />}
                {deviceStateLabel(copy, device)}
              </span>
            </div>

            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <div className="min-w-0">
                <span className="block text-sm font-medium text-ink">{copy.dynamicTargetDevice}</span>
                <p className="mt-2.5 flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm text-ink">
                  <span className="truncate font-mono">{copy.dynamicPreviewDeviceName}</span>
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">{copy.dynamicTargetDeviceHelp}</p>
              </div>
              <DynamicTargetSelector
                copy={copy}
                capability={capability}
                device={device}
                targetObjectId={scenario.draft.targetObjectId}
                disabled={device !== "ready"}
                onTargetChange={onTargetChange}
              />
            </div>

            {staticLocked ? (
              <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-muted" role="status">
                {copy.dynamicStaticLockedNote}
              </p>
            ) : null}

            {notice === "capabilityChanged" ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-xs leading-relaxed text-warning" role="status">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {copy.dynamicCapabilityChangedNotice}
              </p>
            ) : null}
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="min-w-0">
              <span id="scenario-ttl-label" className="block text-sm font-medium text-ink">{copy.dynamicTtl}</span>
              <div className="mt-2.5">
                {limits ? (
                  <>
                    <SelectField
                      id="scenario-ttl"
                      value={ttlSelection}
                      options={ttlOptions}
                      labelledBy="scenario-ttl-label"
                      disabled={controlsDisabled}
                      onChange={(value) => onTtlChange(value === "default" ? null : value === "custom" ? Number.NaN : Number(value))}
                    />
                    {ttlSelection === "custom" && scenario.draft.ttlSeconds !== null ? (
                      <input
                        type="number"
                        min={limits.minTtlSeconds}
                        max={limits.maxTtlSeconds}
                        step={1}
                        value={Number.isFinite(scenario.draft.ttlSeconds) ? scenario.draft.ttlSeconds : ""}
                        onChange={(event) => onTtlChange(event.target.value.trim() === "" ? Number.NaN : Number(event.target.value))}
                        disabled={controlsDisabled}
                        aria-label={copy.dynamicTtlCustom}
                        className="mt-2 h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-mono text-sm text-ink disabled:cursor-not-allowed disabled:bg-surface-2"
                      />
                    ) : null}
                  </>
                ) : (
                  <p className="flex h-11 items-center rounded-xl border border-line bg-surface-2 px-3.5 text-sm text-ink-subtle">{capability ? copy.dynamicNeedsTarget : copy.dynamicTargetPending}</p>
                )}
              </div>
              <small className="mt-1.5 block text-xs text-ink-subtle">{limits ? copy.dynamicTtlHelp(limits.minTtlSeconds, limits.maxTtlSeconds) : copy.dynamicNeedsTarget}</small>
            </div>

            <label className={`flex min-w-0 items-center justify-between gap-4 rounded-xl border border-line bg-surface px-3.5 py-3 ${keepDisabled && !scenario.draft.keepAfterExecute ? "opacity-60" : ""}`}>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{copy.dynamicScenarioKeep}</span>
                <small className="mt-0.5 block text-xs leading-relaxed text-ink-subtle">
                  {keepBlocked ? copy.dynamicScenarioKeepUnsupported : targetObject ? copy.dynamicScenarioKeepHelp : copy.dynamicNeedsTarget}
                </small>
              </span>
              <input
                type="checkbox"
                checked={scenario.draft.keepAfterExecute}
                onChange={(event) => onKeepChange(event.target.checked)}
                disabled={keepDisabled}
                className="h-4 w-4 shrink-0 accent-accent"
              />
            </label>
          </div>

          <DynamicCapabilityDetails copy={copy} capability={capability} object={targetObject} objectIndex={targetIndex} />

          <div className="mt-6 rounded-2xl border border-line bg-surface-2 px-5 py-4" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">{copy.dynamicObservation}</h2>
              <span className={`flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5 text-xs ${observation.status === "error" ? "text-danger" : "text-ink-muted"}`}>
                {observationTitle(copy, observation)}
              </span>
            </div>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">{observationMessage(copy, observation)}</p>
            {observationTarget ? (
              <p className="mt-2 text-xs text-ink-subtle">{copy.dynamicObservationTarget}: <span className="font-mono">{observationTarget}</span></p>
            ) : null}
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-subtle">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {copy.dynamicPreviewMockNote}
            </p>
            {canResetObservation ? (
              <button
                type="button"
                onClick={onResetObservation}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-xs font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {copy.dynamicObservationReset}
              </button>
            ) : null}
          </div>

          {blockers.length > 0 ? (
            <ul className={`mt-6 space-y-1.5 rounded-xl border px-4 py-3 text-sm leading-relaxed ${informationalOnly ? "border-line bg-surface-2 text-ink-muted" : "border-warning/40 bg-warning-soft text-warning"}`} role="note">
              {blockers.map((blocker) => (
                <li key={blocker} className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{blockerMessage(copy, blocker, limits ? limits.maxBytes : null)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <footer className="shrink-0 border-t border-line bg-surface px-10 py-5">
        <div className="mx-auto flex max-w-[820px] flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onDeleteRequest}
            className="inline-flex h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-medium text-danger transition-colors duration-150 ease-out hover:bg-danger-soft"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {copy.dynamicScenarioDeleteConfirm}
          </button>
          <button
            type="button"
            onClick={onClearRequest}
            disabled={clearBlockers.length > 0}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong px-3.5 text-sm font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Eraser className="h-4 w-4" aria-hidden="true" />
            {copy.dynamicScenarioClearDevice}
          </button>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={onSave}
              disabled={!saveable}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong px-4 text-sm font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {copy.save}
            </button>
            <button
              type="button"
              onClick={onUploadRequest}
              disabled={uploadBlockers.length > 0}
              className="inline-flex h-11 items-center gap-2.5 rounded-lg bg-accent px-6 text-sm font-semibold text-accent-ink transition-[background-color,opacity] duration-150 ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-subtle"
            >
              <CloudUpload className="h-4 w-4" aria-hidden="true" />
              {copy.dynamicScenarioSaveAndUpload}
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}
