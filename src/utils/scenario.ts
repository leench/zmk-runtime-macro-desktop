/**
 * Pure scenario/dynamic-target helpers for the page-level Dynamic workspace.
 *
 * These functions only transform in-memory data: no HID, no Tauri command, no
 * storage and no logging. Dynamic text stays inside the React session until the
 * user explicitly saves a scenario, and the persisted document is produced here
 * as plain data for the App to hand to the store command.
 */

import type { DynamicCapabilities, DynamicServiceState, PersistedScenario, ScenarioStore } from "../bridge";
import type { DynamicCapabilityStatus } from "../types/dynamic";
import type {
  DynamicCapabilitiesPresentation,
  DynamicObjectPresentation,
  DynamicObservation,
  ObservationErrorKind,
  PreviewDeviceState,
  Scenario,
  ScenarioFields,
  WorkspaceTrayContext,
} from "../types/scenario";
import { dynamicByteLength, dynamicLimits, dynamicObjectSlots, validateDynamicText } from "./dynamic.ts";

/**
 * Limits enforced by the persisted scenario store. They are the on-disk schema
 * limits, not a device capability: a scenario may legitimately hold text a
 * smaller device object cannot accept.
 */
export const SCENARIO_NAME_LIMIT_BYTES = 64;
export const SCENARIO_TEXT_LIMIT_BYTES = 512;

/** Pseudo value for "no target object chosen yet". */
export const TARGET_NONE = "";
/** Pseudo value for a saved target that the current capability does not report. */
export const TARGET_MISSING = "__missing";

export function emptyScenarioFields(): ScenarioFields {
  return { name: "", text: "", ttlSeconds: null, keepAfterExecute: false, targetObjectId: null, targetDeviceId: null };
}

export function createScenario(
  id: string,
  draft: Partial<ScenarioFields> = {},
  options: { saved?: Partial<ScenarioFields>; isNew?: boolean } = {},
): Scenario {
  const fields: ScenarioFields = { ...emptyScenarioFields(), ...draft };
  return {
    id,
    draft: fields,
    saved: { ...fields, ...options.saved },
    isNew: options.isNew ?? false,
  };
}

export function editScenario(scenario: Scenario, patch: Partial<ScenarioFields>): Scenario {
  return { ...scenario, draft: { ...scenario.draft, ...patch } };
}

export function sameScenarioFields(left: ScenarioFields, right: ScenarioFields): boolean {
  return left.name === right.name
    && left.text === right.text
    && left.ttlSeconds === right.ttlSeconds
    && left.keepAfterExecute === right.keepAfterExecute
    && left.targetObjectId === right.targetObjectId
    && left.targetDeviceId === right.targetDeviceId;
}

/** A never-saved scenario is dirty until its first local save. */
export function isScenarioDirty(scenario: Scenario): boolean {
  return scenario.isNew || !sameScenarioFields(scenario.draft, scenario.saved);
}

/** Whether the draft holds anything worth saving or warning about. */
export function hasScenarioContent(scenario: Scenario): boolean {
  return scenario.draft.name.trim().length > 0 || scenario.draft.text.length > 0 || scenario.draft.targetObjectId !== null;
}

/** Save is local to this in-memory session: the draft becomes the saved snapshot. */
export function saveScenario(scenario: Scenario): Scenario {
  return { ...scenario, saved: scenario.draft, isNew: false };
}

export function scenariosMatch(left: readonly Scenario[], right: readonly Scenario[]): boolean {
  return left.length === right.length && left.every((scenario, index) => {
    const other = right[index];
    return scenario.id === other.id
      && scenario.isNew === other.isNew
      && sameScenarioFields(scenario.draft, other.draft)
      && sameScenarioFields(scenario.saved, other.saved);
  });
}

export function findTargetObject(
  capability: DynamicCapabilitiesPresentation | null,
  objectId: string | null,
): DynamicObjectPresentation | null {
  if (!capability || !objectId) return null;
  return capability.objects.find((object) => object.objectId === objectId) ?? null;
}

/** Selector value for the current target: the object id, or a pseudo value. */
export function targetSelectorValue(
  capability: DynamicCapabilitiesPresentation | null,
  targetObjectId: string | null,
): string {
  if (!targetObjectId) return TARGET_NONE;
  // Without a capability nothing can be resolved, and a saved target is never
  // silently remapped to another object.
  if (!capability) return TARGET_MISSING;
  return findTargetObject(capability, targetObjectId) ? targetObjectId : TARGET_MISSING;
}

export type TargetRowState = {
  /** Value for the read-only row or selector: object id, TARGET_NONE or TARGET_MISSING. */
  value: string;
  /** The saved target is not reported by the current capability. */
  missing: boolean;
  /** Sole object of a single-object capability; null when the count is not exactly one. */
  soleObject: DynamicObjectPresentation | null;
  /** The sole object is the resolved target, so the row may present it as the current target. */
  soleObjectBound: boolean;
};

/**
 * Presentation of the target object row against the current capability.
 *
 * A single-object capability is never adopted silently: while the saved target
 * is unresolved, its only object stays an explicit rebind action and the row
 * reports the unresolved saved state instead of a target.
 */
export function targetRowState(
  capability: DynamicCapabilitiesPresentation | null,
  targetObjectId: string | null,
): TargetRowState {
  const objects = capability?.objects ?? [];
  const value = targetSelectorValue(capability, targetObjectId);
  const soleObject = objects.length === 1 ? objects[0] : null;
  return {
    value,
    missing: capability !== null && value === TARGET_MISSING,
    soleObject,
    soleObjectBound: soleObject !== null && targetObjectId === soleObject.objectId,
  };
}

/** Capability-driven limits of one target object, in `DynamicLimits` shape. */
export function objectLimits(object: DynamicObjectPresentation) {
  return {
    maxBytes: object.maxLength,
    minTtlSeconds: object.ttl.minSeconds,
    maxTtlSeconds: object.ttl.maxSeconds,
    defaultTtlSeconds: object.ttl.defaultSeconds,
  };
}

/**
 * Rendered object label: the device alias when present, else a positional label.
 * Positions are 1-based for the user, matching the static slot list; the object
 * id stays opaque and is never derived from the label.
 */
export function objectDisplayLabel(object: DynamicObjectPresentation, index: number, fallback: (position: number) => string): string {
  return object.displayLabel || fallback(index + 1);
}

export function scenarioByteLength(text: string): number {
  return dynamicByteLength(text);
}

export type ScenarioBlocker =
  | "deviceDisconnected"
  | "deviceUnknown"
  | "capabilityDiscovering"
  | "dynamicUnsupported"
  | "operationInProgress"
  | "targetMissing"
  | "textEmpty"
  | "textUnsupported"
  | "textTooLong"
  | "ttlInvalid"
  | "keepUnsupported";

export type ScenarioGate = {
  device: PreviewDeviceState;
  capability: DynamicCapabilitiesPresentation | null;
  scenario: Scenario | null;
  observation: DynamicObservation;
};

function deviceBlockers(gate: ScenarioGate): ScenarioBlocker[] {
  const blockers: ScenarioBlocker[] = [];
  if (gate.device === "disconnected") blockers.push("deviceDisconnected");
  else if (gate.device === "unknown") blockers.push("deviceUnknown");
  else if (gate.device === "unsupported") blockers.push("dynamicUnsupported");
  else if (gate.device === "discovering" || !gate.capability) blockers.push("capabilityDiscovering");
  if (gate.observation.status === "uploading" || gate.observation.status === "clearing") blockers.push("operationInProgress");
  return blockers;
}

/**
 * Target blockers of the device actions.
 *
 * Without a capability there is nothing to judge yet, so the device gate's
 * `capabilityDiscovering` stays the only reason. With a reported capability
 * both actions address one object of the selected scenario, so a missing
 * scenario is the same unresolved target as a saved target the capability no
 * longer reports: neither upload nor clear may look available without an
 * explicit scenario and target.
 */
function targetBlockers(gate: ScenarioGate): ScenarioBlocker[] {
  if (!gate.capability) return [];
  const scenario = gate.scenario;
  if (!scenario) return ["targetMissing"];
  if (!scenario.draft.targetObjectId || !findTargetObject(gate.capability, scenario.draft.targetObjectId)) return ["targetMissing"];
  return [];
}

/** Reasons Save & upload stays disabled; empty means the action is available. */
export function uploadBlockers(gate: ScenarioGate): ScenarioBlocker[] {
  const blockers = [...deviceBlockers(gate), ...targetBlockers(gate)];
  const scenario = gate.scenario;
  const object = scenario ? findTargetObject(gate.capability, scenario.draft.targetObjectId) : null;
  if (scenario && object) {
    const textError = validateDynamicText(scenario.draft.text, object.maxLength);
    if (textError === "empty") blockers.push("textEmpty");
    else if (textError === "tooLong") blockers.push("textTooLong");
    else if (textError === "unsupported") blockers.push("textUnsupported");
    if (scenario.draft.ttlSeconds !== null
      && (!Number.isInteger(scenario.draft.ttlSeconds)
        || scenario.draft.ttlSeconds < object.ttl.minSeconds
        || scenario.draft.ttlSeconds > object.ttl.maxSeconds)) {
      blockers.push("ttlInvalid");
    }
    if (scenario.draft.keepAfterExecute && !object.supportsKeepAfterExecute) blockers.push("keepUnsupported");
  }
  return blockers;
}

/** Reasons Clear device stays disabled; text, TTL and keep do not matter here. */
export function clearBlockers(gate: ScenarioGate): ScenarioBlocker[] {
  return [...deviceBlockers(gate), ...targetBlockers(gate)];
}

/**
 * How the selected Scenario relates to the connected device.
 *
 * The binding compares the stored alias with the current device alias, so a
 * different device (or the same device under a different interface/usage, which
 * has no alias) never inherits a binding it was not given.
 */
export type DeviceBindingState = "aliasMissing" | "unbound" | "bound";

export function deviceBindingState(scenario: Scenario | null, deviceAlias: string | null): DeviceBindingState {
  if (deviceAlias === null) return "aliasMissing";
  return scenario !== null && scenario.draft.targetDeviceId === deviceAlias ? "bound" : "unbound";
}

/**
 * Device-binding blockers of the device actions.
 *
 * The device-free preview has no device to bind, so it is never blocked. In the
 * connected workspace, upload and clear both address the connected device and
 * therefore require an explicit binding: a missing alias (there is nothing to
 * bind to) or a Scenario bound to another alias is refused instead of being
 * silently re-bound.
 */
export function deviceBindingIssues(input: {
  mode: "preview" | "device";
  deviceAlias: string | null;
  scenario: Scenario | null;
}): DeviceBindingBlocker[] {
  if (input.mode === "preview") return [];
  if (input.deviceAlias === null) return ["deviceAliasMissing"];
  // Without a selected scenario there is no binding to judge: the target gate
  // already reports the missing scenario, so this one stays quiet.
  if (input.scenario === null) return [];
  return deviceBindingState(input.scenario, input.deviceAlias) === "bound" ? [] : ["deviceUnbound"];
}

/**
 * Bind a Scenario to the connected device.
 *
 * Only the draft changes, so the binding stays an unsaved edit until the user
 * saves the Scenario. Without an alias there is nothing to bind to and the
 * Scenario is returned unchanged.
 */
export function bindScenarioToDevice(scenario: Scenario, deviceAlias: string | null): Scenario {
  if (deviceAlias === null) return scenario;
  return editScenario(scenario, { targetDeviceId: deviceAlias });
}

/**
 * Reasons a local save cannot reach the scenario store.
 *
 * These are store schema limits, so they apply whenever a scenario is written
 * to disk: a name is required, and the stored text must fit the on-disk format.
 */
export type ScenarioStoreBlocker = "nameRequired" | "nameTooLong" | "storeTextUnsupported" | "storeTextTooLong";

/**
 * Reasons the workspace cannot act yet, independent of the current fields.
 *
 * The local store is the only place a scenario can be saved, so while it is
 * loading, corrupt or unavailable no scenario action is offered.
 */
export type ScenarioStoreStateBlocker = "storeUnavailable";

/**
 * Reasons a device action has no bound device yet.
 *
 * A Scenario stores the alias the user explicitly bound it to. Until that alias
 * exists on this machine and matches the connected device, the device actions
 * stay unavailable: a device is never selected implicitly.
 */
export type DeviceBindingBlocker = "deviceAliasMissing" | "deviceUnbound";

/** Any reason the editor has to report next to the action bar. */
export type ScenarioIssue = ScenarioBlocker | ScenarioStoreBlocker | ScenarioStoreStateBlocker | DeviceBindingBlocker;

function storedTextIsSupported(text: string): boolean {
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    if (!((byte >= 0x20 && byte <= 0x7e) || byte === 0x08 || byte === 0x09 || byte === 0x0a)) return false;
  }
  return true;
}

/** Store-schema blockers of one scenario draft; empty means it can be persisted. */
export function storeBlockers(fields: ScenarioFields): ScenarioStoreBlocker[] {
  const blockers: ScenarioStoreBlocker[] = [];
  const nameBytes = dynamicByteLength(fields.name);
  if (fields.name.trim().length === 0) blockers.push("nameRequired");
  else if (nameBytes > SCENARIO_NAME_LIMIT_BYTES) blockers.push("nameTooLong");
  const textBytes = dynamicByteLength(fields.text);
  if (textBytes > SCENARIO_TEXT_LIMIT_BYTES) blockers.push("storeTextTooLong");
  else if (!storedTextIsSupported(fields.text)) blockers.push("storeTextUnsupported");
  return blockers;
}

/**
 * Reasons `Clear device` stays disabled.
 *
 * Clearing only talks to the device: it never writes the local scenario store,
 * so an unusable store or a draft that cannot be saved (missing or oversized
 * name, unstorable text) must not disable it. The only non-device reason left is
 * an operation already in flight, which keeps the confirmation flow from
 * overlapping another device command. The workspace and the tray both derive
 * Clear from this single list, so they can never disagree about it.
 */
export function clearActionIssues(input: {
  operation: "upload" | "clear" | null;
  device: PreviewDeviceState;
  capability: DynamicCapabilitiesPresentation | null;
  scenario: Scenario | null;
  observation: DynamicObservation;
}): ScenarioIssue[] {
  const busy: ScenarioIssue[] = input.operation !== null ? ["operationInProgress"] : [];
  return [
    ...busy,
    ...clearBlockers({
      device: input.device,
      capability: input.capability,
      scenario: input.scenario,
      observation: input.observation,
    }),
  ];
}

/**
 * Stable opaque presentation id of one wire slot.
 *
 * The id is only an identifier: the wire slot always travels next to it in
 * [`DynamicObjectPresentation.wireSlot`] and is never parsed back out of the id.
 */
export function objectIdForSlot(slot: number): string {
  return `dynamic-object-${slot}`;
}

/**
 * Map the real device capability onto the workspace presentation model.
 *
 * Object count, per-object byte limit, TTL bounds and keep support all come
 * from the reported capability: nothing is hardcoded and no object is guessed.
 */
export function capabilityPresentationFromBackend(
  capabilities: DynamicCapabilities | null,
): DynamicCapabilitiesPresentation | null {
  if (!capabilities) return null;
  const limits = dynamicLimits(capabilities);
  return {
    capabilityVersion: capabilities.capabilityVersion,
    objects: dynamicObjectSlots(capabilities).map((slot) => ({
      objectId: objectIdForSlot(slot),
      wireSlot: slot,
      displayLabel: "",
      maxLength: limits.maxBytes,
      ttl: {
        defaultSeconds: limits.defaultTtlSeconds,
        minSeconds: limits.minTtlSeconds,
        maxSeconds: limits.maxTtlSeconds,
      },
      supportsKeepAfterExecute: capabilities.supportsKeepAfterExecute,
    })),
    lifecycle: {
      clearOnBoot: capabilities.clearOnBoot,
      clearOnTtlExpiry: capabilities.clearOnTtlExpiry,
      clearOnExecutionAccept: capabilities.clearOnExecutionAccept,
      clearOnUsbDisconnect: capabilities.clearOnUsbDisconnect,
      clearOnBleProfileChange: capabilities.clearOnBleProfileChange,
      clearOnSelectedEndpointChange: capabilities.clearOnSelectedEndpointChange,
    },
  };
}

/**
 * Wire slot of a target object, resolved through the capability collection.
 *
 * A saved or unknown id resolves to `null` instead of being reinterpreted, so
 * a device call can never be addressed to a guessed slot.
 */
export function objectWireSlot(
  capability: DynamicCapabilitiesPresentation | null,
  objectId: string | null,
): number | null {
  const object = findTargetObject(capability, objectId);
  return object ? object.wireSlot : null;
}

/**
 * Whether a workspace target addresses exactly the object the device reports.
 *
 * The id is resolved through the mapped capability collection and the resolved
 * wire slot must be the one the caller asked for. Neither the id nor a label is
 * ever parsed into a slot, so a stale, foreign or mismatched target is rejected
 * instead of being re-addressed to another object.
 */
export function targetMatchesCapability(
  capabilities: DynamicCapabilities | null,
  objectId: string,
  wireSlot: number,
): boolean {
  const presentation = capabilityPresentationFromBackend(capabilities);
  if (!presentation) return false;
  return objectWireSlot(presentation, objectId) === wireSlot;
}

function observationErrorKind(errorCode: string): ObservationErrorKind {
  if (errorCode === "timeout") return "timeout";
  if (errorCode === "dynamic_unsupported") return "unsupported";
  return "interrupted";
}

function observationStatusFromService(
  status: DynamicServiceState["status"] | NonNullable<DynamicServiceState["objects"][number]>["status"],
): DynamicObservation["status"] {
  switch (status) {
    case "uploading":
      return "uploading";
    case "committedLocally":
      return "committed";
    case "clearing":
      return "clearing";
    case "clearedLocally":
      return "cleared";
    case "error":
      return "error";
    default:
      return "none";
  }
}

/**
 * Map the body-free DynamicService state onto the workspace observation.
 *
 * With a resolved target, only that object's own observation is reported: an
 * operation on another object never shows up as this target's result. Without a
 * target, the service-level status is the only available fact. Nothing here is a
 * readback: a committed/cleared status only repeats the local acknowledgement of
 * this session, and `none` means nothing was observed.
 */
export function observationFromServiceState(
  state: DynamicServiceState | null,
  target: { objectId: string; wireSlot: number } | null,
): DynamicObservation {
  if (!state) return { status: "none", targetObjectId: null, errorKind: null };
  const errorKind = state.error ? observationErrorKind(state.error.code) : null;
  if (target) {
    const object = state.objects.find((entry) => entry.slot === target.wireSlot) ?? null;
    if (!object) return { status: "none", targetObjectId: null, errorKind: null };
    const mapped = observationStatusFromService(object.status);
    if (mapped === "none") return { status: "none", targetObjectId: null, errorKind: null };
    return { status: mapped, targetObjectId: target.objectId, errorKind: mapped === "error" ? errorKind : null };
  }
  const mapped = observationStatusFromService(state.status);
  if (mapped === "none") return { status: "none", targetObjectId: null, errorKind: null };
  return { status: mapped, targetObjectId: null, errorKind: mapped === "error" ? errorKind : null };
}

/** Local device state as the workspace shows it, derived from the connection. */
export function serviceDeviceState(
  connected: boolean,
  status: DynamicCapabilityStatus,
): PreviewDeviceState {
  if (!connected) return "disconnected";
  if (status === "ready") return "ready";
  if (status === "discovering") return "discovering";
  if (status === "unsupported") return "unsupported";
  return "unknown";
}

/** Stable opaque id for a new scenario; ascii, bounded and unused. */
export function newScenarioId(existing: readonly string[] = []): string {
  const taken = new Set(existing);
  let candidate = "";
  do {
    const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null;
    candidate = random ? `scenario-${random}` : `scenario-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  } while (taken.has(candidate));
  return candidate.slice(0, SCENARIO_NAME_LIMIT_BYTES);
}

/**
 * One scenario as it comes back from the store: draft and saved snapshot are the
 * stored values, so a freshly loaded scenario is never dirty.
 */
export function scenarioFromPersisted(persisted: PersistedScenario): Scenario {
  const fields: ScenarioFields = {
    name: persisted.name,
    text: persisted.text,
    ttlSeconds: persisted.ttlSeconds,
    keepAfterExecute: persisted.keepAfterExecute,
    targetObjectId: persisted.targetObject,
    targetDeviceId: persisted.targetDevice,
  };
  return { id: persisted.id, draft: { ...fields }, saved: { ...fields }, isNew: false };
}

export function scenariosFromStore(store: ScenarioStore): Scenario[] {
  return store.scenarios.map(scenarioFromPersisted);
}

/** The scenario a store write commits, or `null` for a write without one. */
export type ScenarioStoreCommit = { id: string; fields: ScenarioFields } | null;

/**
 * Build the on-disk document for one store write.
 *
 * Only the committed scenario is written from its draft: every other scenario is
 * written from its saved snapshot, so saving one scenario never persists another
 * scenario's unsaved edits. Scenarios that were never saved are not written at
 * all - except the one being committed, which is why the first save of a new
 * scenario needs a name.
 */
export function storeFromScenarios(
  scenarios: readonly Scenario[],
  schemaVersion: number,
  commit: ScenarioStoreCommit = null,
): ScenarioStore {
  const persisted: PersistedScenario[] = [];
  for (const scenario of scenarios) {
    if (scenario.isNew && scenario.id !== commit?.id) continue;
    const fields = scenario.id === commit?.id ? commit.fields : scenario.saved;
    persisted.push({
      id: scenario.id,
      name: fields.name,
      text: fields.text,
      ttlSeconds: fields.ttlSeconds,
      keepAfterExecute: fields.keepAfterExecute,
      targetDevice: fields.targetDeviceId,
      targetObject: fields.targetObjectId,
    });
  }
  return { schemaVersion, scenarios: persisted };
}

/**
 * What one local save would write and how the list looks afterwards.
 *
 * The plan is pure: nothing is applied until the store write succeeded, so a
 * failed save leaves the caller's scenarios untouched and dirty.
 */
export type ScenarioSavePlan = {
  /** The list with the committed scenario marked saved; apply only on success. */
  scenarios: Scenario[];
  /** The scenario that was committed. */
  committed: Scenario;
  /** The on-disk document for this save. */
  store: ScenarioStore;
  /** Explicit commit marker so the store uses the committed draft. */
  commit: { id: string; fields: ScenarioFields };
};

export function planScenarioSave(
  scenarios: readonly Scenario[],
  id: string,
  schemaVersion: number,
): ScenarioSavePlan | null {
  const scenario = scenarios.find((item) => item.id === id);
  if (!scenario) return null;
  const committed = saveScenario(scenario);
  const next = scenarios.map((item) => (item.id === id ? committed : item));
  const commit = { id: committed.id, fields: committed.draft };
  return { scenarios: next, committed, store: storeFromScenarios(next, schemaVersion, commit), commit };
}

/**
 * Run tasks strictly in call order, one after another.
 *
 * Used for store writes so a rapid Save / Delete / Save & Upload sequence cannot
 * interleave two file writes and leave the older document behind on disk.
 */
export type SerialRunner = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialRunner(): SerialRunner {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(task: () => Promise<T>): Promise<T> => {
    const queued = tail.then(task, task);
    tail = queued.then(() => undefined, () => undefined);
    return queued;
  };
}

/**
 * Safe native-menu display name of the selected scenario.
 *
 * The name is trimmed, bounded to the on-disk schema length in bytes and
 * rejected when it contains a control character, so arbitrary text can never
 * become a native menu label. `null` means "no scenario name to show".
 */
export function traySafeScenarioName(name: string | null): string | null {
  if (name === null) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  if (dynamicByteLength(trimmed) > SCENARIO_NAME_LIMIT_BYTES) return null;
  for (const character of trimmed) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return null;
  }
  return trimmed;
}

/** Tray summary of a window that has nothing connected and nothing selected. */
export const DEFAULT_WORKSPACE_TRAY_CONTEXT: WorkspaceTrayContext = {
  scenarioName: null,
  canChooseScenario: false,
  canUploadScenario: false,
  canClearDynamic: false,
};

export function sameWorkspaceTrayContext(left: WorkspaceTrayContext, right: WorkspaceTrayContext): boolean {
  return left.scenarioName === right.scenarioName
    && left.canChooseScenario === right.canChooseScenario
    && left.canUploadScenario === right.canUploadScenario
    && left.canClearDynamic === right.canClearDynamic;
}

/**
 * Tray summary of the connected workspace.
 *
 * The action flags are derived from the same blocker arrays the editor uses, so
 * the tray can never offer an action the window itself would refuse: a scenario
 * that cannot be uploaded (missing target, unsupported text, oversize, invalid
 * TTL, unsupported keep, running operation, unusable store) also disables the
 * tray entry. Clear is device-only, so its blocker array comes from
 * [`clearActionIssues`] and never contains a store reason.
 */
export function trayContextFromWorkspace(input: {
  scenario: Scenario | null;
  operation: "upload" | "clear" | null;
  uploadBlockers: readonly ScenarioIssue[];
  clearBlockers: readonly ScenarioIssue[];
}): WorkspaceTrayContext {
  const busy = input.operation !== null;
  return {
    scenarioName: traySafeScenarioName(input.scenario?.draft.name ?? null),
    // Choosing only re-raises this workspace, which exists while connected.
    canChooseScenario: true,
    canUploadScenario: !busy && input.uploadBlockers.length === 0,
    canClearDynamic: !busy && input.clearBlockers.length === 0,
  };
}
