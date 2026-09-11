import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ShieldAlert, X } from "lucide-react";
import {
  asCommandError,
  subscribeTrayAction,
  type CommandError,
  type ScenarioStore,
  type TrayAction,
} from "../../bridge";
import type { Messages } from "../../i18n";
import type {
  DynamicObservation,
  DynamicWorkspaceBackend,
  PreviewFixture,
  PreviewScenarioLabels,
  PreviewStateId,
  Scenario,
  ScenarioFields,
} from "../../types/scenario";
import {
  type ScenarioIssue,
  clearActionIssues,
  createScenario,
  createSerialRunner,
  DEFAULT_WORKSPACE_TRAY_CONTEXT,
  editScenario,
  hasScenarioContent,
  isScenarioDirty,
  newScenarioId,
  objectDisplayLabel,
  observationFromServiceState,
  planScenarioSave,
  saveScenario,
  scenariosFromStore,
  scenariosMatch,
  storeBlockers,
  storeFromScenarios,
  trayContextFromWorkspace,
  uploadBlockers,
} from "../../utils/scenario";
import { DynamicPreviewControls } from "./DynamicPreviewControls";
import { ScenarioDialog } from "./ScenarioDialog";
import { ScenarioEditor } from "./ScenarioEditor";
import { ScenarioEmptyState } from "./ScenarioEmptyState";
import { ScenarioList } from "./ScenarioList";
import { buildPreviewFixture } from "./previewFixtures";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type DynamicWorkspaceProps = {
  copy: Messages;
  onClose: () => void;
  /**
   * Opens the previous dynamic dialog. It is the temporary fallback entry until
   * the workspace passes visual review, and is omitted when the workspace is
   * opened without a connected device.
   */
  onOpenLegacyDialog?: () => void;
  /**
   * Real DynamicService and scenario store of a connected device. Without it the
   * workspace stays the device-free preview surface: every value comes from an
   * in-memory fixture and nothing is persisted.
   */
  backend?: DynamicWorkspaceBackend;
  /** Localizes a sanitized backend error for the failure banners. */
  formatError?: (error: CommandError) => string;
};

type DialogState =
  | { kind: "discard"; next: { type: "select"; id: string } | { type: "new" } }
  | { kind: "delete"; id: string }
  | { kind: "upload" }
  | { kind: "clear" }
  | { kind: "close" };

type StoreStatus = "loading" | "ready" | "error";
type StoreFailure = { kind: "load" | "save"; error: CommandError };

function selectedIdFor(fixture: PreviewFixture): string | null {
  return fixture.selectedIndex === null ? null : fixture.scenarios[fixture.selectedIndex]?.id ?? null;
}

/**
 * Page-level Dynamic workspace: scenarios are the primary object on the left,
 * the selected scenario's target is a device dynamic object on the right.
 *
 * Two modes share one surface. Without a `backend` this is the UI-only preview:
 * every value comes from an in-memory fixture and there is no HID access, no
 * Tauri command, no storage write and no scenario persistence. With a `backend`
 * the App supplies the mapped capability, the body-free service state and bridge
 * callbacks, so scenarios are loaded from and written to the local store and
 * upload/clear go through the one DynamicService the rest of the app uses. The
 * component itself never opens HID and never stores dynamic text anywhere except
 * the persisted scenario document the user asked to save.
 */
export function DynamicWorkspace({ copy, onClose, onOpenLegacyDialog, backend, formatError }: DynamicWorkspaceProps) {
  const previewMode = backend === undefined;
  const format = formatError ?? ((error: CommandError) => error.message);

  const scenarioLabels = useMemo<PreviewScenarioLabels>(() => ({
    workTerminal: copy.dynamicSampleScenarioWork,
    buildWatch: copy.dynamicSampleScenarioBuild,
    scratch: copy.dynamicSampleScenarioScratch,
  }), [copy.dynamicSampleScenarioWork, copy.dynamicSampleScenarioBuild, copy.dynamicSampleScenarioScratch]);

  const [previewState, setPreviewState] = useState<PreviewStateId>("ready");
  const fixture = useMemo(() => buildPreviewFixture(previewState, scenarioLabels), [previewState, scenarioLabels]);

  const [scenarios, setScenarios] = useState<Scenario[]>(() => (previewMode ? fixture.scenarios : []));
  const [selectedId, setSelectedId] = useState<string | null>(() => (previewMode ? selectedIdFor(fixture) : null));
  const [previewObservation, setPreviewObservation] = useState<DynamicObservation>(fixture.observation);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [storeStatus, setStoreStatus] = useState<StoreStatus>(previewMode ? "ready" : "loading");
  const [storeFailure, setStoreFailure] = useState<StoreFailure | null>(null);
  const [operation, setOperation] = useState<"upload" | "clear" | null>(null);
  const [storePending, setStorePending] = useState(false);
  /** Newest sanitized device failure, kept with the target it belongs to. */
  const [deviceError, setDeviceError] = useState<{ objectId: string; error: CommandError } | null>(null);

  const scenariosRef = useRef(scenarios);
  const appliedFixtureRef = useRef(fixture);
  const appliedStateRef = useRef(previewState);
  const mountedRef = useRef(true);
  const serialRef = useRef<ReturnType<typeof createSerialRunner> | null>(null);
  if (serialRef.current === null) serialRef.current = createSerialRunner();
  scenariosRef.current = scenarios;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const applyFixture = useCallback((next: PreviewFixture) => {
    appliedFixtureRef.current = next;
    setScenarios(next.scenarios);
    setSelectedId(selectedIdFor(next));
    setPreviewObservation(next.observation);
  }, []);

  useEffect(() => {
    if (!previewMode) return;
    const stateChanged = appliedStateRef.current !== previewState;
    const untouched = scenariosMatch(scenariosRef.current, appliedFixtureRef.current.scenarios);
    appliedStateRef.current = previewState;
    if (stateChanged || (untouched && appliedFixtureRef.current !== fixture)) applyFixture(fixture);
  }, [applyFixture, fixture, previewMode, previewState]);

  // The loader identity is stable in the App, so this runs once per mount and
  // never reloads over in-memory edits. A missing file resolves to an empty
  // store; a failure is reported and never fabricated into an empty one.
  const loadStore = backend?.loadScenarios ?? null;
  useEffect(() => {
    if (!loadStore) return undefined;
    let active = true;
    setStoreStatus("loading");
    void loadStore()
      .then((store) => {
        if (!active || !mountedRef.current) return;
        const loaded = scenariosFromStore(store);
        setScenarios(loaded);
        setSelectedId(loaded[0]?.id ?? null);
        setStoreStatus("ready");
        setStoreFailure(null);
      })
      .catch((caught: unknown) => {
        if (!active || !mountedRef.current) return;
        setScenarios([]);
        setSelectedId(null);
        setStoreStatus("error");
        setStoreFailure({ kind: "load", error: asCommandError(caught) });
      });
    return () => { active = false; };
  }, [loadStore]);

  const device = backend ? backend.device : fixture.device;
  const staticLocked = backend ? backend.staticLocked : fixture.staticLocked;
  const notice = backend ? null : fixture.notice;
  const capability = backend ? backend.capability : fixture.capability;
  const deviceName = backend ? backend.deviceName : copy.dynamicPreviewDeviceName;

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedId) ?? null;
  const targetObjectId = selectedScenario?.draft.targetObjectId ?? null;
  const targetIndex = capability && targetObjectId
    ? capability.objects.findIndex((object) => object.objectId === targetObjectId)
    : -1;
  const targetObject = capability && targetIndex >= 0 ? capability.objects[targetIndex] : null;
  const targetLabel = targetObject
    ? objectDisplayLabel(targetObject, targetIndex, (index) => copy.dynamicObjectLabel(index))
    : copy.dynamicScenarioNoTarget;

  // A running operation reports its own pending observation immediately; the
  // settled result always comes from the backend service state afterwards.
  const observation: DynamicObservation = backend
    ? operation !== null
      ? { status: operation === "upload" ? "uploading" : "clearing", targetObjectId: targetObject?.objectId ?? null, errorKind: null }
      : observationFromServiceState(
        backend.serviceState,
        targetObject ? { objectId: targetObject.objectId, wireSlot: targetObject.wireSlot } : null,
      )
    : previewObservation;

  // A failure of the current target is reported even before the service state
  // was re-read; an error of another target is never borrowed.
  const activeDeviceError = deviceError && targetObject?.objectId === deviceError.objectId ? deviceError.error : null;

  const errorDetail = activeDeviceError
    ? format(activeDeviceError)
    : backend && observation.status === "error" && backend.serviceState?.error
      ? format(backend.serviceState.error)
      : null;

  const busyIssues: ScenarioIssue[] = operation !== null || storePending ? ["operationInProgress"] : [];
  // The local store is the only place a scenario can be saved, so a store that is
  // still loading or failed blocks saving and uploading. Clearing is a device-only
  // action and never touches the store, so it is derived separately below.
  const storeReadyIssues: ScenarioIssue[] = !previewMode && storeStatus !== "ready" ? ["storeUnavailable"] : [];
  const storeIssues: ScenarioIssue[] = [
    ...storeReadyIssues,
    ...(backend && selectedScenario ? storeBlockers(selectedScenario.draft) : []),
  ];
  const uploadReasons: ScenarioIssue[] = [
    ...busyIssues,
    ...storeIssues,
    ...uploadBlockers({ device, capability, scenario: selectedScenario, observation }),
  ];
  // Clear device only talks to the device: store availability and the save-schema
  // limits of the current draft never disable it.
  const clearReasons: ScenarioIssue[] = clearActionIssues({ operation, device, capability, scenario: selectedScenario, observation });
  const saveReasons: ScenarioIssue[] = [...busyIssues, ...storeIssues];

  // The native tray mirrors this workspace through a bounded summary: the
  // scenario display name and the same three action flags the footer uses. Only
  // the connected workspace reports; the device-free preview never does.
  const reportTrayContext = backend?.reportTrayContext ?? null;
  const trayContext = trayContextFromWorkspace({
    scenario: selectedScenario,
    operation,
    uploadBlockers: uploadReasons,
    clearBlockers: clearReasons,
  });
  const trayScenarioName = trayContext.scenarioName;
  const trayCanChoose = trayContext.canChooseScenario;
  const trayCanUpload = trayContext.canUploadScenario;
  const trayCanClear = trayContext.canClearDynamic;
  useEffect(() => {
    if (!reportTrayContext) return;
    reportTrayContext({ scenarioName: trayScenarioName, canChooseScenario: trayCanChoose, canUploadScenario: trayCanUpload, canClearDynamic: trayCanClear });
  }, [reportTrayContext, trayCanChoose, trayCanClear, trayCanUpload, trayScenarioName]);

  // Leaving the workspace (Unlock, disconnect, closing the page) must not leave a
  // stale scenario name or a stale enabled action in the native menu. The reset is
  // an unmount cleanup only, so an ordinary context update never clears the
  // summary it just published. The device-free preview has no reporter and never
  // touches the tray.
  useEffect(() => {
    if (!reportTrayContext) return undefined;
    return () => reportTrayContext(DEFAULT_WORKSPACE_TRAY_CONTEXT);
  }, [reportTrayContext]);

  // Tray actions ask the window to run one of the three real flows. The handler
  // lives in a ref so the subscription is created once and still uses the newest
  // blockers: a blocked action stays a safe no-op instead of bypassing the dirty,
  // target or store checks the window itself would show.
  const trayHandlerRef = useRef<(action: TrayAction) => void>(() => {});
  trayHandlerRef.current = (action: TrayAction) => {
    if (!backend) return;
    if (action === "chooseScenario") {
      backend.openWorkspace();
      return;
    }
    if (action === "uploadScenario") {
      if (uploadReasons.length > 0) return;
      backend.openWorkspace();
      setDialog({ kind: "upload" });
      return;
    }
    if (clearReasons.length > 0) return;
    backend.openWorkspace();
    setDialog({ kind: "clear" });
  };
  const trayActionsAvailable = backend !== undefined;
  useEffect(() => {
    if (!trayActionsAvailable || !inTauri()) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;
    void subscribeTrayAction((action) => trayHandlerRef.current(action))
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [trayActionsAvailable]);

  const updateSelected = (patch: Partial<ScenarioFields>) => {
    if (!selectedId) return;
    setScenarios((previous) => previous.map((scenario) => scenario.id === selectedId ? editScenario(scenario, patch) : scenario));
  };

  const addScenario = () => {
    const next = createScenario(newScenarioId(scenariosRef.current.map((scenario) => scenario.id)), {}, { isNew: true });
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

  const requestClose = () => {
    // A dirty draft is never dropped silently: the same confirmation style as a
    // scenario switch protects closing the workspace.
    if (scenarios.some((scenario) => isScenarioDirty(scenario) && hasScenarioContent(scenario))) {
      setDialog({ kind: "close" });
      return;
    }
    onClose();
  };

  /** Write one store document, serialized after every earlier write. */
  const persistStore = useCallback(async (store: ScenarioStore): Promise<boolean> => {
    if (!backend) return true;
    const serial = serialRef.current ?? createSerialRunner();
    serialRef.current = serial;
    setStorePending(true);
    try {
      await serial(() => backend.saveScenarios(store));
      if (mountedRef.current) setStoreFailure(null);
      return true;
    } catch (caught) {
      // A failed write must never look persisted: the caller keeps its dirty
      // draft and reports the sanitized store error.
      if (mountedRef.current) setStoreFailure({ kind: "save", error: asCommandError(caught) });
      return false;
    } finally {
      if (mountedRef.current) setStorePending(false);
    }
  }, [backend]);

  /**
   * Save the selected scenario locally. Returns the committed scenario only when
   * the store write succeeded, so Save & upload can refuse to upload a scenario
   * that is not on disk.
   */
  const commitSelectedSave = async (): Promise<Scenario | null> => {
    const scenario = selectedScenario;
    if (!scenario) return null;
    if (!backend) {
      const committed = saveScenario(scenario);
      setScenarios((previous) => previous.map((item) => item.id === committed.id ? committed : item));
      return committed;
    }
    const plan = planScenarioSave(scenariosRef.current, scenario.id, backend.schemaVersion);
    if (!plan) return null;
    if (!await persistStore(plan.store)) return null;
    if (mountedRef.current) setScenarios(plan.scenarios);
    return plan.committed;
  };

  const deleteScenario = async (id: string) => {
    const index = scenariosRef.current.findIndex((scenario) => scenario.id === id);
    if (index < 0) return;
    const remaining = scenariosRef.current.filter((scenario) => scenario.id !== id);
    if (backend && !await persistStore(storeFromScenarios(remaining, backend.schemaVersion, null))) return;
    if (!mountedRef.current) return;
    setScenarios(remaining);
    if (selectedId === id) setSelectedId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
  };

  const uploadSelected = async () => {
    const target = targetObject;
    if (!backend || !target) return;
    setDeviceError(null);
    // The scenario is persisted first; only then does the device see the upload.
    const committed = await commitSelectedSave();
    if (!committed) return;
    setOperation("upload");
    try {
      const error = await backend.upload({
        objectId: target.objectId,
        wireSlot: target.wireSlot,
        text: committed.draft.text,
        ttlSeconds: committed.draft.ttlSeconds,
        keepAfterExecute: committed.draft.keepAfterExecute,
      });
      if (mountedRef.current) setDeviceError(error ? { objectId: target.objectId, error } : null);
    } finally {
      if (mountedRef.current) setOperation(null);
    }
  };

  const clearSelected = async () => {
    const target = targetObject;
    if (!backend || !target) return;
    setOperation("clear");
    setDeviceError(null);
    try {
      const error = await backend.clear({ objectId: target.objectId, wireSlot: target.wireSlot });
      if (mountedRef.current) setDeviceError(error ? { objectId: target.objectId, error } : null);
    } finally {
      if (mountedRef.current) setOperation(null);
    }
  };

  const resetObservation = () => {
    setPreviewObservation({ status: "none", targetObjectId: null, errorKind: null });
    setDeviceError(null);
  };

  const confirmDialog = () => {
    const current = dialog;
    setDialog(null);
    if (!current) return;
    if (current.kind === "close") {
      onClose();
      return;
    }
    if (current.kind === "discard") {
      if (current.next.type === "new") addScenario();
      else setSelectedId(current.next.id);
      return;
    }
    if (current.kind === "delete") {
      void deleteScenario(current.id);
      return;
    }
    if (current.kind === "upload") {
      if (backend) {
        void uploadSelected();
        return;
      }
      if (selectedScenario) {
        const uploaded = selectedScenario;
        setScenarios((previous) => previous.map((scenario) => scenario.id === uploaded.id ? saveScenario(scenario) : scenario));
        setPreviewObservation({ status: "committed", targetObjectId: uploaded.draft.targetObjectId, errorKind: null });
      }
      return;
    }
    if (backend) {
      void clearSelected();
      return;
    }
    setPreviewObservation({ status: "cleared", targetObjectId, errorKind: null });
  };

  const scenarioName = (scenario: Scenario | null) => scenario?.draft.name.trim() || copy.dynamicUntitledScenario;

  const renderDialog = () => {
    if (!dialog) return null;
    const cancel = () => setDialog(null);
    if (dialog.kind === "close") {
      return (
        <ScenarioDialog
          copy={copy}
          eyebrow={copy.unsavedChanges}
          title={copy.switchUnsavedTitle}
          message={copy.dynamicScenarioCloseMessage}
          confirmLabel={copy.dynamicScenarioCloseAnyway}
          danger
          onConfirm={confirmDialog}
          onCancel={cancel}
        />
      );
    }
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
          message={backend
            ? copy.dynamicScenarioDeleteMessageDevice(scenarioName(scenario))
            : copy.dynamicScenarioDeleteMessage(scenarioName(scenario))}
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
          eyebrow={backend ? copy.dynamicMacro : copy.dynamicPreviewBadge}
          title={backend ? copy.dynamicConfirmUploadTitleDevice : copy.dynamicConfirmUploadTitle}
          message={backend
            ? copy.dynamicConfirmUploadMessageDevice(scenarioName(selectedScenario), targetLabel)
            : copy.dynamicConfirmUploadMessage(scenarioName(selectedScenario), targetLabel)}
          confirmLabel={backend ? copy.dynamicConfirmUploadConfirmDevice : copy.dynamicConfirmUploadConfirm}
          onConfirm={confirmDialog}
          onCancel={cancel}
        />
      );
    }
    return (
      <ScenarioDialog
        copy={copy}
        eyebrow={backend ? copy.dynamicMacro : copy.dynamicPreviewBadge}
        title={backend ? copy.dynamicConfirmClearTitleDevice : copy.dynamicConfirmClearTitle}
        message={backend ? copy.dynamicConfirmClearMessageDevice(targetLabel) : copy.dynamicConfirmClearMessage(targetLabel)}
        confirmLabel={backend ? copy.dynamicConfirmClearConfirmDevice : copy.dynamicConfirmClearConfirm}
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
            onClick={requestClose}
            aria-label={copy.close}
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-subtle transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {previewMode ? (
        <DynamicPreviewControls copy={copy} state={previewState} onChange={(state) => { setDialog(null); setPreviewState(state); }} />
      ) : null}

      <p className="flex shrink-0 items-start gap-2 border-b border-warning/40 bg-warning-soft px-10 py-2.5 text-xs leading-relaxed text-warning" role="note">
        <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span><strong className="font-semibold">{copy.dynamicWorkspaceWarningTitle}</strong> {copy.dynamicWorkspaceWarning}</span>
      </p>

      {storeFailure ? (
        <p className="flex shrink-0 items-start gap-2 border-b border-danger/40 bg-danger-soft px-10 py-2.5 text-xs leading-relaxed text-danger" role="alert">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold">{storeFailure.kind === "load" ? copy.dynamicStoreLoadFailedTitle : copy.dynamicStoreSaveFailedTitle}</strong>{" "}
            {format(storeFailure.error)}
          </span>
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ScenarioList
          copy={copy}
          scenarios={scenarios}
          selectedId={selectedId}
          capability={capability}
          onSelect={requestScenario}
          onNewScenario={requestNewScenario}
        />
        {storeStatus === "loading" ? (
          <section className="flex min-w-0 flex-1 items-center justify-center bg-canvas px-8 text-center">
            <p className="text-sm text-ink-muted" role="status">{copy.dynamicStoreLoading}</p>
          </section>
        ) : selectedScenario ? (
          <ScenarioEditor
            copy={copy}
            mode={previewMode ? "preview" : "device"}
            deviceName={deviceName}
            scenario={selectedScenario}
            device={device}
            staticLocked={staticLocked}
            notice={notice}
            capability={capability}
            observation={observation}
            errorDetail={errorDetail}
            targetObject={targetObject}
            targetIndex={targetIndex}
            uploadBlockers={uploadReasons}
            clearBlockers={clearReasons}
            saveBlockers={saveReasons}
            onNameChange={(value) => updateSelected({ name: value })}
            onTextChange={(value) => updateSelected({ text: value })}
            onTtlChange={(value) => updateSelected({ ttlSeconds: value })}
            onKeepChange={(value) => updateSelected({ keepAfterExecute: value })}
            onTargetChange={(objectId) => updateSelected({ targetObjectId: objectId })}
            onSave={() => { void commitSelectedSave(); }}
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
