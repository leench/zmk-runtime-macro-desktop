import { invoke } from "@tauri-apps/api/core";

import type { Locale } from "./i18n";

export type UsageMetadataStatus = "exact" | "missing";

export type DeviceCandidate = {
  id: string;
  vendorId: number;
  productId: number;
  productName: string | null;
  interfaceNumber: number;
  usagePage: number;
  usage: number;
  usageMetadata: UsageMetadataStatus;
};

export type ConnectedDevice = Omit<DeviceCandidate, "id">;

export type AuthState =
  | "disconnected"
  | "open"
  | "locked"
  | "authenticated"
  | "credentialInvalid";

export type ConnectionState = {
  connected: boolean;
  device: ConnectedDevice | null;
  authState: AuthState;
};

export type SlotMetadata = {
  slot: number;
  length: number;
};

export type DynamicCapabilities = {
  capabilityVersion: number;
  dynamicObjectCount: number;
  lifecycleFlags: number;
  maxDynamicLength: number;
  defaultTtlSeconds: number;
  minTtlSeconds: number;
  maxTtlSeconds: number;
  transactionTimeoutSeconds: number;
  clearOnBoot: boolean;
  clearOnTtlExpiry: boolean;
  clearOnExecutionAccept: boolean;
  clearOnUsbDisconnect: boolean;
  clearOnBleProfileChange: boolean;
  clearOnSelectedEndpointChange: boolean;
  supportsKeepAfterExecute: boolean;
};

export type ClientSettings = {
  timeoutMs: number;
  retries: number;
  appliesNextConnection: boolean;
};

/** Raw protocol bytes returned for one selected slot. Never log or persist them. */
export type SlotBytes = number[];

export type CommandError = {
  code: string;
  message: string;
};

const fallbackError: CommandError = {
  code: "unknown_error",
  message: "The operation failed. Try again.",
};

/** Keep backend error codes while rejecting arbitrary invoke failures. */
export function asCommandError(error: unknown): CommandError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: error.message };
  }
  return fallbackError;
}

export function listDevices(): Promise<DeviceCandidate[]> {
  return invoke<DeviceCandidate[]>("list_devices");
}

export function connectDevice(opaqueId: string): Promise<ConnectionState> {
  return invoke<ConnectionState>("connect_device", { opaqueId });
}

export function disconnectDevice(): Promise<void> {
  return invoke("disconnect_device");
}

export function getConnection(): Promise<ConnectionState> {
  return invoke<ConnectionState>("get_connection");
}

export function refreshAuthState(): Promise<AuthState> {
  return invoke<AuthState>("refresh_auth_state");
}

/** Unlock a protected v2 session. The password is never persisted by the bridge. */
export function authenticate(password: string): Promise<AuthState> {
  return invoke<AuthState>("authenticate", { password });
}

export function unlock(password: string): Promise<AuthState> {
  return authenticate(password);
}

/** Set or change the device password; success returns a locked session. */
export function setPassword(password: string): Promise<AuthState> {
  return invoke<AuthState>("set_password", { password });
}

export function lockDevice(): Promise<AuthState> {
  return invoke<AuthState>("lock_device");
}

export function listSlots(): Promise<SlotMetadata[]> {
  return invoke<SlotMetadata[]>("list_slots");
}

export function getSlot(slot: number): Promise<SlotBytes> {
  return invoke<SlotBytes>("get_slot", { slot });
}

export function setSlot(slot: number, text: string): Promise<void> {
  return invoke("set_slot", { slot, text });
}

export function clearSlot(slot: number): Promise<void> {
  return invoke("clear_slot", { slot });
}

export function getDynamicCapabilities(): Promise<DynamicCapabilities> {
  return invoke<DynamicCapabilities>("get_dynamic_capabilities");
}

export function uploadDynamic(slot: number, text: string, ttlSeconds: number | null, keepAfterExecute: boolean): Promise<void> {
  return invoke("upload_dynamic", { slot, text, ttlSeconds, keepAfterExecute });
}

export function clearDynamic(slot: number): Promise<void> {
  return invoke("clear_dynamic", { slot });
}

/**
 * Serialized status of the Rust Dynamic service for the current session.
 *
 * These status values are the serialized backend contract. The UI-only scenario
 * model (`src/types/dynamic.ts`) keeps its own presentation vocabulary until the
 * Dynamic Workspace is wired to the real service (plan §12 stage 5).
 */
export type DynamicServiceStatus =
  | "unknown"
  | "discovering"
  | "ready"
  | "unsupported"
  | "uploading"
  | "committedLocally"
  | "clearing"
  | "clearedLocally"
  | "error";

/** Local observation status of one dynamic object in the current session. */
export type DynamicObjectStatus =
  | "unknown"
  | "uploading"
  | "committedLocally"
  | "clearing"
  | "clearedLocally"
  | "error";

/**
 * Local observation of one dynamic object. Only the byte length of the uploaded
 * text is known to the backend: there is no readback and no stored text.
 */
export type DynamicObjectObservation = {
  /** Wire slot reported by `CAPABILITIES` (`0..dynamicObjectCount-1`). */
  slot: number;
  status: DynamicObjectStatus;
  /** Byte length of the last upload, `0` after a clear, `null` when unobserved. */
  textLength: number | null;
  /** Requested TTL of the last upload; `null` for the device default. */
  ttlSeconds: number | null;
  keepAfterExecute: boolean;
};

/**
 * Body-free Dynamic service state of the connected device.
 *
 * `status` and the per-object observations are local facts of this session, not
 * firmware state: a committed/cleared object only means the device acknowledged
 * the operation. `generation` is the backend's local last-write-wins counter and
 * must never be presented as a device value.
 */
export type DynamicServiceState = {
  status: DynamicServiceStatus;
  capabilities: DynamicCapabilities | null;
  generation: number;
  objects: DynamicObjectObservation[];
  /** Sanitized error of the newest failed dynamic operation, if any. */
  error: CommandError | null;
};

/**
 * Read the observed Dynamic service state.
 *
 * The command performs no HID I/O; it reports the state of the current session
 * and returns `unknown` while no session observed anything. It never returns
 * dynamic text, HID paths or device serials.
 */
export function getDynamicState(): Promise<DynamicServiceState> {
  return invoke<DynamicServiceState>("get_dynamic_state");
}

export function getSettings(): Promise<ClientSettings> {
  return invoke<ClientSettings>("get_settings");
}

export function setSettings(timeoutMs: number, retries: number): Promise<ClientSettings> {
  return invoke<ClientSettings>("set_settings", { timeoutMs, retries });
}

/**
 * Mirrors the resolved UI locale onto the native tray menu.
 *
 * Rust accepts only the exact `en` / `zh-CN` tags and never derives a language
 * itself, so the value must be a `resolveLocale` result, never the raw language
 * preference or a navigator language.
 */
export function setTrayLocale(locale: Locale): Promise<void> {
  return invoke("set_tray_locale", { locale });
}
