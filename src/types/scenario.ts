/**
 * Presentation model for the page-level Dynamic workspace.
 *
 * Scenarios are user-named desktop templates and dynamic objects are upload
 * targets. The workspace has two sources with the same shapes: a device-free
 * in-memory preview fixture, and the real path where the App passes in the
 * mapped capability, the body-free service state and bridge callbacks. This
 * file itself reads no device, no Tauri command and no storage.
 */

import type { CommandError, DynamicServiceState, ScenarioStore } from "../bridge";

export type DynamicObjectTtl = {
  defaultSeconds: number;
  minSeconds: number;
  maxSeconds: number;
};

/** One upload target reported by the device capability (never a guessed slot). */
export type DynamicObjectPresentation = {
  /** Opaque id from the capability/fixture; the UI never parses a number out of it. */
  objectId: string;
  /**
   * Wire slot this object must be addressed with. It is the only source for a
   * device call: neither `objectId` nor `displayLabel` is ever parsed back into
   * a slot.
   */
  wireSlot: number;
  /** Device-provided alias; empty means the UI falls back to a positional label. */
  displayLabel: string;
  maxLength: number;
  ttl: DynamicObjectTtl;
  supportsKeepAfterExecute: boolean;
};

export type DynamicLifecyclePresentation = {
  clearOnBoot: boolean;
  clearOnTtlExpiry: boolean;
  clearOnExecutionAccept: boolean;
  clearOnUsbDisconnect: boolean;
  clearOnBleProfileChange: boolean;
  clearOnSelectedEndpointChange: boolean;
};

export type DynamicCapabilitiesPresentation = {
  capabilityVersion: number;
  objects: DynamicObjectPresentation[];
  lifecycle: DynamicLifecyclePresentation;
};

/** Editable scenario fields; the draft and the last saved snapshot share them. */
export type ScenarioFields = {
  name: string;
  text: string;
  /** `null` keeps the device default TTL. */
  ttlSeconds: number | null;
  keepAfterExecute: boolean;
  /** Target object id or `null` while no target has been chosen. */
  targetObjectId: string | null;
  /**
   * Alias of the device this Scenario is bound to, or `null` while it is not
   * bound to any device. It is the user's local alias, never a serial number or
   * a HID path, and it is only set by an explicit user action.
   */
  targetDeviceId: string | null;
};

export type Scenario = {
  /** In-memory id; it is a React key, not a persisted or protocol identifier. */
  id: string;
  draft: ScenarioFields;
  saved: ScenarioFields;
  /** True until the scenario is saved once in this in-memory session. */
  isNew: boolean;
};

export type PreviewDeviceState = "disconnected" | "unknown" | "discovering" | "ready" | "unsupported";

/** Local observation of a preview upload/clear. This is never a device readback. */
export type ObservedStatus = "none" | "uploading" | "committed" | "clearing" | "cleared" | "error";

/** Presentation-friendly error kinds: no codes, frames, paths or serial numbers. */
export type ObservationErrorKind = "interrupted" | "timeout" | "unsupported";

export type DynamicObservation = {
  status: ObservedStatus;
  /** Object this observation belongs to, or `null` when nothing was observed. */
  targetObjectId: string | null;
  errorKind: ObservationErrorKind | null;
};

export type PreviewNotice = "capabilityChanged" | null;

/** Preview states the UI can demonstrate without a device. */
export const PREVIEW_STATES = [
  "empty",
  "new",
  "dirty",
  "disconnected",
  "unknown",
  "discovering",
  "unsupported",
  "ready",
  "uploading",
  "committed",
  "clearing",
  "cleared",
  "error",
  "staticLocked",
  "keepUnsupported",
  "targetMissing",
  "capabilityChanged",
  "oversize",
] as const;

export type PreviewStateId = (typeof PREVIEW_STATES)[number];

/** Sample scenario names used by the fixtures; the component injects localized text. */
export type PreviewScenarioLabels = {
  workTerminal: string;
  buildWatch: string;
  scratch: string;
};

export type ScenarioSeed = {
  draft: Partial<ScenarioFields>;
  /** Defaults to the draft when omitted; differ from it to seed a dirty scenario. */
  saved?: Partial<ScenarioFields>;
  isNew?: boolean;
};

export type PreviewFixture = {
  device: PreviewDeviceState;
  /** Static management may be locked while dynamic objects stay available. */
  staticLocked: boolean;
  notice: PreviewNotice;
  capability: DynamicCapabilitiesPresentation | null;
  observation: DynamicObservation;
  scenarios: Scenario[];
  selectedIndex: number | null;
};

/**
 * One object as the workspace addresses it on the wire.
 *
 * `wireSlot` comes from the capability mapping, never from the opaque id.
 */
export type DynamicUploadTarget = {
  objectId: string;
  wireSlot: number;
  text: string;
  ttlSeconds: number | null;
  keepAfterExecute: boolean;
};

export type DynamicClearTarget = {
  objectId: string;
  wireSlot: number;
};

/**
 * Tray-visible summary of the connected workspace.
 *
 * It carries only a display name and three booleans, so the native tray can show
 * the current scenario and enable `choose`, `upload` and `clear` exactly when the
 * window would. The scenario text never leaves the workspace.
 */
export type WorkspaceTrayContext = {
  /** Display name of the selected scenario, already bounded and control-free. */
  scenarioName: string | null;
  canChooseScenario: boolean;
  canUploadScenario: boolean;
  canClearDynamic: boolean;
};

/**
 * Real DynamicService and scenario store behind a connected workspace.
 *
 * The App owns every Tauri command and passes the results in; the workspace
 * never opens HID, never calls a command directly and never stores dynamic text
 * anywhere but the persisted scenario document the user asked to save.
 */
export type DynamicWorkspaceBackend = {
  /** On-disk store version the App persists with. */
  schemaVersion: number;
  /** Safe connected-device display name; never a HID path or serial. */
  deviceName: string;
  /**
   * Alias of the connected device, or `null` while it has none. Scenario upload
   * and clear require the selected Scenario to be bound to exactly this alias.
   */
  deviceAlias: string | null;
  device: PreviewDeviceState;
  /** Static management may be locked while dynamic objects stay available. */
  staticLocked: boolean;
  capability: DynamicCapabilitiesPresentation | null;
  /** Body-free local observation of the current session, or `null` before one. */
  serviceState: DynamicServiceState | null;
  loadScenarios: () => Promise<ScenarioStore>;
  saveScenarios: (store: ScenarioStore) => Promise<ScenarioStore>;
  upload: (target: DynamicUploadTarget) => Promise<CommandError | null>;
  clear: (target: DynamicClearTarget) => Promise<CommandError | null>;
  /** Opens (or re-raises) this workspace in the main window. */
  openWorkspace: () => void;
  /** Publishes the bounded tray summary; called on every context change. */
  reportTrayContext: (context: WorkspaceTrayContext) => void;
};
