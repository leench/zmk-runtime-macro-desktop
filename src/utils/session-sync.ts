import { isAuthState } from "../bridge.ts";

/**
 * Backend session synchronization.
 *
 * The local HTTP API can open and keep the shared HID session outside the
 * window (see `docs/DYNAMIC-AUTOMATION-PLAN.md` §10). The backend announces that
 * through one payload-free notification, so the window re-reads the
 * authoritative, body-free state itself. This module decides what such a re-read
 * means for the window's own view of the session, and it validates the answer
 * before anything is shown: it is pure, so the decision is checkable without a
 * device, a HID path or a session.
 *
 * Two rules bound the decision:
 *
 * - the window never changes the backend's device, and it never takes over a
 *   session of a device it does not already show, because that would silently
 *   switch what the user is managing;
 * - an answer that is unreadable, or an adoption that would silently drop an
 *   unsaved draft, is held instead of acted on.
 */

/**
 * Safe five-part device summary fields of one connected device.
 *
 * They are the same local identity the window, the alias map and the backend use;
 * none of them is a HID path, a serial number or a temporary candidate id.
 */
const SUMMARY_PARTS = ["vendorId", "productId", "interfaceNumber", "usagePage", "usage"] as const;

/** Usage metadata values the window renders. */
const USAGE_METADATA = ["exact", "missing"] as const;

/**
 * Field names that would mean a body, a device identity or a HID path arrived in
 * a session answer. An answer that carries one is refused instead of being shown,
 * so the window can never adopt state it is not allowed to display.
 */
const FORBIDDEN_KEYS = [
  "text",
  "draftText",
  "scenarioText",
  "macroText",
  "path",
  "devicePath",
  "hidPath",
  "serial",
  "serialNumber",
  "deviceId",
  "candidateId",
  "alias",
  "deviceAlias",
  "slot",
  "handles",
  "session",
  "password",
  "token",
  "raw",
  "report",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value carries a field the session view must never contain. */
function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, entry]) => (FORBIDDEN_KEYS as readonly string[]).includes(key) || containsForbiddenKey(entry),
  );
}

/**
 * The window's view of the session the backend reports.
 *
 * `deviceKey` is the safe summary key, so the window can compare the backend's
 * device with the one it shows without ever handling a HID path or a serial
 * number. It is `null` while the backend reports no session.
 */
export type BackendSessionReport = {
  connected: boolean;
  deviceKey: string | null;
};

/**
 * Validate one connection answer before the window acts on it.
 *
 * An answer the window cannot render as a session — a missing or wrongly typed
 * field, an unknown management state, a device without the safe summary fields, or
 * anything carrying a body, a device identity or a HID path — returns `null`, so
 * the caller keeps what it shows instead of inventing a connection.
 */
export function backendSessionReport(answer: unknown): BackendSessionReport | null {
  if (!isRecord(answer) || containsForbiddenKey(answer)) return null;
  if (typeof answer.connected !== "boolean" || !isAuthState(answer.authState)) return null;
  // A closed session states nothing about a device, so only the fact is used.
  if (!answer.connected) return { connected: false, deviceKey: null };
  const device = answer.device;
  if (!isRecord(device)) return null;
  const parts = SUMMARY_PARTS.map((part) => device[part]);
  if (!parts.every((part) => typeof part === "number" && Number.isInteger(part))) return null;
  if (device.productName !== null && typeof device.productName !== "string") return null;
  if (typeof device.usageMetadata !== "string" || !(USAGE_METADATA as readonly string[]).includes(device.usageMetadata)) {
    return null;
  }
  return { connected: true, deviceKey: parts.join(":") };
}

/** What the window has to do after one notification-driven re-read. */
export type BackendSessionSync =
  | { kind: "none" }
  | { kind: "adopt"; deviceKey: string; preserveDraft: boolean }
  | { kind: "release" }
  | { kind: "hold"; reason: "unreadableAnswer" | "otherDevice" | "draft" };

export type BackendSessionSyncInput = {
  /** The validated backend answer, or `null` when the answer was unusable. */
  reported: BackendSessionReport | null;
  /** Whether the window currently shows a device session. */
  shownConnected: boolean;
  /** Safe summary key of the session the window shows; it survives a release. */
  shownDeviceKey: string | null;
  /** Whether the window holds an unsaved static draft. */
  hasDirtyDraft: boolean;
};

/**
 * Decide what the window does with the session the backend reports.
 *
 * `adopt` mirrors the reported session: it is the device the window already shows
 * (a refresh, including a management state that changed outside the window) or a
 * session the window did not show at all (the local API opened it for its write).
 * `preserveDraft` says whether the slots the window already holds belong to that
 * same device.
 *
 * `release` drops the view of a session the backend no longer has, which is what a
 * device that disappeared or a transport failure looks like from here.
 *
 * `hold` keeps everything the window shows: an unreadable answer is never read as
 * "opened" or "released", a different device is never taken over silently, and an
 * unsaved draft is never dropped by a background re-read.
 */
export function backendSessionSync(input: BackendSessionSyncInput): BackendSessionSync {
  const { reported, shownConnected, shownDeviceKey, hasDirtyDraft } = input;
  if (reported === null) return { kind: "hold", reason: "unreadableAnswer" };
  if (!reported.connected) {
    // The backend has no session, so one the window still shows is gone. Drafts
    // stay in memory exactly like on every other drop path.
    return shownConnected ? { kind: "release" } : { kind: "none" };
  }
  const { deviceKey } = reported;
  if (deviceKey === null) return { kind: "hold", reason: "unreadableAnswer" };
  if (shownConnected) {
    return deviceKey === shownDeviceKey
      ? { kind: "adopt", deviceKey, preserveDraft: true }
      : { kind: "hold", reason: "otherDevice" };
  }
  if (hasDirtyDraft && deviceKey !== shownDeviceKey) {
    // Adopting would clear slots that belong to another device and drop the draft
    // with them; a device switch with an unsaved draft stays the user's decision.
    return { kind: "hold", reason: "draft" };
  }
  return { kind: "adopt", deviceKey, preserveDraft: deviceKey === shownDeviceKey };
}
