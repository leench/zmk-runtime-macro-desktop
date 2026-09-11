import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import type { Messages } from "../../i18n";
import type {
  DynamicObservation,
  PreviewFixture,
  PreviewScenarioLabels,
  PreviewStateId,
  Scenario,
  ScenarioFields,
} from "../../types/scenario";
import {
  clearBlockers,
  createScenario,
  editScenario,
  hasScenarioContent,
  isScenarioDirty,
  objectDisplayLabel,
  saveScenario,
  scenariosMatch,
  uploadBlockers,
} from "../../utils/scenario";
import { DynamicPreviewControls } from "./DynamicPreviewControls";
import { ScenarioDialog } from "./ScenarioDialog";
import { ScenarioEditor } from "./ScenarioEditor";
import { ScenarioEmptyState } from "./ScenarioEmptyState";
import { ScenarioList } from "./ScenarioList";
import { buildPreviewFixture } from "./previewFixtures";

type DynamicWorkspaceProps = {
  copy: Messages;
  onClose: () => void;
  /**
   * Opens the previous dynamic dialog. It is the temporary fallback entry until
   * the workspace passes visual review, and is omitted when the workspace is
   * opened without a connected device.
   */
  onOpenLegacyDialog?: () => void;
};

type DialogState =
  | { kind: "discard"; next: { type: "select"; id: string } | { type: "new" } }
  | { kind: "delete"; id: string }
  | { kind: "upload" }
  | { kind: "clear" };

function selectedIdFor(fixture: PreviewFixture): string | null {
  return fixture.selectedIndex === null ? null : fixture.scenarios[fixture.selectedIndex]?.id ?? null;
}

/**
 * Page-level Dynamic workspace: scenarios are the primary object on the left,
 * the selected scenario's target is a device dynamic object on the right.
 *
 * UI-only stage: every value comes from an in-memory preview fixture. There is
 * no HID access, no Tauri dynamic command, no storage write and no scenario
 * persistence; the text lives in React memory for this session only.
 */
export function DynamicWorkspace({ copy, onClose, onOpenLegacyDialog }: DynamicWorkspaceProps) {
  const scenarioLabels = useMemo<PreviewScenarioLabels>(() => ({
    workTerminal: copy.dynamicSampleScenarioWork,
    buildWatch: copy.dynamicSampleScenarioBuild,
    scratch: copy.dynamicSampleScenarioScratch,
  }), [copy.dynamicSampleScenarioWork, copy.dynamicSampleScenarioBuild, copy.dynamicSampleScenarioScratch]);

  const [previewState, setPreviewState] = useState<PreviewStateId>("ready");
  const fixture = useMemo(() => buildPreviewFixture(previewState, scenarioLabels), [previewState, scenarioLabels]);

  const [scenarios, setScenarios] = useState<Scenario[]>(() => fixture.scenarios);
  const [selectedId, setSelectedId] = useState<string | null>(() => selectedIdFor(fixture));
  const [observation, setObservation] = useState<DynamicObservation>(fixture.observation);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const scenariosRef = useRef(scenarios);
  const appliedFixtureRef = useRef(fixture);
  const appliedStateRef = useRef(previewState);
  const sequenceRef = useRef(0);
  scenariosRef.current = scenarios;

  const applyFixture = useCallback((next: PreviewFixture) => {
    appliedFixtureRef.current = next;
    setScenarios(next.scenarios);
    setSelectedId(selectedIdFor(next));
    setObservation(next.observation);
  }, []);

  useEffect(() => {
    const stateChanged = appliedStateRef.current !== previewState;
    const untouched = scenariosMatch(scenariosRef.current, appliedFixtureRef.current.scenarios);
    appliedStateRef.current = previewState;
    if (stateChanged || (untouched && appliedFixtureRef.current !== fixture)) applyFixture(fixture);
  }, [applyFixture, fixture, previewState]);

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedId) ?? null;
  const capability = fixture.capability;
  const targetObjectId = selectedScenario?.draft.targetObjectId ?? null;
  const targetIndex = capability && targetObjectId
    ? capability.objects.findIndex((object) => object.objectId === targetObjectId)
    : -1;
  const targetObject = capability && targetIndex >= 0 ? capability.objects[targetIndex] : null;
  const targetLabel = targetObject
    ? objectDisplayLabel(targetObject, targetIndex, (index) => copy.dynamicObjectLabel(index))
    : copy.dynamicScenarioNoTarget;
  const uploadReasons = uploadBlockers({ device: fixture.device, capability, scenario: selectedScenario, observation });
  const clearReasons = clearBlockers({ device: fixture.device, capability, scenario: selectedScenario, observation });

  const updateSelected = (patch: Partial<ScenarioFields>) => {
    if (!selectedId) return;
    setScenarios((previous) => previous.map((scenario) => scenario.id === selectedId ? editScenario(scenario, patch) : scenario));
  };

  const addScenario = () => {
    sequenceRef.current += 1;
    const next = createScenario(`preview-scenario-${sequenceRef.current}`, {}, { isNew: true });
    setScenarios((previous) => [...previous, next]);
    setSelectedId(next.id);
  };

  const requestScenario = (id: string) => {
    if (id === selectedId) return;
    if (selectedScenario && isScenarioDirty(selectedScenario) && hasScenarioContent(selectedScenario)) {
      setDialog({ kind: "discard", next: { type: "select", id } });
      return;
    }
    setSelectedId(id);
  };

  const requestNewScenario = () => {
    if (selectedScenario && isScenarioDirty(selectedScenario) && hasScenarioContent(selectedScenario)) {
      setDialog({ kind: "discard", next: { type: "new" } });
      return;
    }
    addScenario();
  };

  const requestUpload = () => {
    if (uploadReasons.length === 0) setDialog({ kind: "upload" });
  };

  const requestClear = () => {
    if (clearReasons.length === 0) setDialog({ kind: "clear" });
  };

  const requestDelete = () => {
    if (selectedScenario) setDialog({ kind: "delete", id: selectedScenario.id });
  };

  const resetObservation = () => {
    setObservation({ status: "none", targetObjectId: null, errorKind: null });
  };

  const confirmDialog = () => {
    const current = dialog;
    setDialog(null);
    if (!current) return;
    if (current.kind === "discard") {
      if (current.next.type === "new") addScenario();
      else setSelectedId(current.next.id);
      return;
    }
    if (current.kind === "delete") {
      const index = scenarios.findIndex((scenario) => scenario.id === current.id);
      const remaining = scenarios.filter((scenario) => scenario.id !== current.id);
      setScenarios(remaining);
      if (selectedId === current.id) setSelectedId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
      return;
    }
    if (current.kind === "upload") {
      if (selectedScenario) {
        const uploaded = selectedScenario;
        setScenarios((previous) => previous.map((scenario) => scenario.id === uploaded.id ? saveScenario(scenario) : scenario));
        setObservation({ status: "committed", targetObjectId: uploaded.draft.targetObjectId, errorKind: null });
      }
      return;
    }
    setObservation({ status: "cleared", targetObjectId, errorKind: null });
  };

  const scenarioName = (scenario: Scenario | null) => scenario?.draft.name.trim() || copy.dynamicUntitledScenario;

  const renderDialog = () => {
    if (!dialog) return null;
    const cancel = () => setDialog(null);
    if (dialog.kind === "discard") {
      return (
        <ScenarioDialog
          copy={copy}
          eyebrow={copy.unsavedChanges}
          title={copy.switchUnsavedTitle}
          message={copy.dynamicScenarioSwitchMessage}
          confirmLabel={copy.dynamicScenarioSwitchAnyway}
          danger
          onConfirm={confirmDialog}
          onCancel={cancel}
        />
      );
    }
    if (dialog.kind === "delete") {
      const scenario = scenarios.find((item) => item.id === dialog.id) ?? null;
      return (
        <ScenarioDialog
          copy={copy}
          eyebrow={copy.dynamicScenarioEyebrow}
          title={copy.dynamicScenarioDeleteTitle}
          message={copy.dynamicScenarioDeleteMessage(scenarioName(scenario))}
          confirmLabel={copy.dynamicScenarioDeleteConfirm}
          danger
          onConfirm={confirmDialog}
          onCancel={cancel}
        />
      );
    }
    if (dialog.kind === "upload") {
      return (
        <ScenarioDialog
          copy={copy}
          eyebrow={copy.dynamicPreviewBadge}
          title={copy.dynamicConfirmUploadTitle}
          message={copy.dynamicConfirmUploadMessage(scenarioName(selectedScenario), targetLabel)}
          confirmLabel={copy.dynamicConfirmUploadConfirm}
          onConfirm={confirmDialog}
          onCancel={cancel}
        />
      );
    }
    return (
      <ScenarioDialog
        copy={copy}
        eyebrow={copy.dynamicPreviewBadge}
        title={copy.dynamicConfirmClearTitle}
        message={copy.dynamicConfirmClearMessage(targetLabel)}
        confirmLabel={copy.dynamicConfirmClearConfirm}
        onConfirm={confirmDialog}
        onCancel={cancel}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-10 py-4">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{copy.dynamicWorkspaceEyebrow}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg font-semibold text-ink">{copy.dynamicWorkspace}</h1>
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] text-accent">{copy.dynamicWorkspaceSummary}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onOpenLegacyDialog ? (
            <button
              type="button"
              onClick={onOpenLegacyDialog}
              title={copy.dynamicLegacyDialogHelp}
              className="inline-flex h-9 items-center rounded-lg border border-line-strong px-3 text-xs font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink"
            >
              {copy.dynamicLegacyDialog}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-subtle transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <DynamicPreviewControls copy={copy} state={previewState} onChange={(state) => { setDialog(null); setPreviewState(state); }} />

      <p className="flex shrink-0 items-start gap-2 border-b border-warning/40 bg-warning-soft px-10 py-2.5 text-xs leading-relaxed text-warning" role="note">
        <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span><strong className="font-semibold">{copy.dynamicWorkspaceWarningTitle}</strong> {copy.dynamicWorkspaceWarning}</span>
      </p>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ScenarioList
          copy={copy}
          scenarios={scenarios}
          selectedId={selectedId}
          capability={capability}
          onSelect={requestScenario}
          onNewScenario={requestNewScenario}
        />
        {selectedScenario ? (
          <ScenarioEditor
            copy={copy}
            scenario={selectedScenario}
            device={fixture.device}
            staticLocked={fixture.staticLocked}
            notice={fixture.notice}
            capability={capability}
            observation={observation}
            targetObject={targetObject}
            targetIndex={targetIndex}
            uploadBlockers={uploadReasons}
            clearBlockers={clearReasons}
            onNameChange={(value) => updateSelected({ name: value })}
            onTextChange={(value) => updateSelected({ text: value })}
            onTtlChange={(value) => updateSelected({ ttlSeconds: value })}
            onKeepChange={(value) => updateSelected({ keepAfterExecute: value })}
            onTargetChange={(objectId) => updateSelected({ targetObjectId: objectId })}
            onSave={() => { if (selectedId) setScenarios((previous) => previous.map((scenario) => scenario.id === selectedId ? saveScenario(scenario) : scenario)); }}
            onUploadRequest={requestUpload}
            onClearRequest={requestClear}
            onDeleteRequest={requestDelete}
            onResetObservation={resetObservation}
          />
        ) : (
          <ScenarioEmptyState copy={copy} onNewScenario={requestNewScenario} />
        )}
      </div>

      {renderDialog()}
    </div>
  );
}
