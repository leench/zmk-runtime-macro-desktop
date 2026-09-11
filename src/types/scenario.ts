/**
 * Presentation model for the page-level Dynamic workspace.
 *
 * Everything here is UI-side data: scenarios are user-named desktop templates
 * and dynamic objects are upload targets. The current capability/observation
 * values come from an in-memory preview fixture; the same shapes are intended to
 * carry real values once the backend service stage starts. Nothing in this file
 * reads a device, a Tauri command or storage, and dynamic text never leaves the
 * React session.
 */

export type DynamicObjectTtl = {
  defaultSeconds: number;
  minSeconds: number;
  maxSeconds: number;
};

/** One upload target reported by the device capability (never a guessed slot). */
export type DynamicObjectPresentation = {
  /** Opaque id from the capability/fixture; the UI never parses a number out of it. */
  objectId: string;
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
