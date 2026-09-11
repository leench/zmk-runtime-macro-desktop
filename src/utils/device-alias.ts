/**
 * Local device aliases.
 *
 * An alias is the user's own display name for one Runtime Macro device. It is
 * stored in this machine's browser storage under the same safe device summary
 * key the rest of the app already uses for local slot labels
 * (`vendorId:productId:interfaceNumber:usagePage:usage`). It never stores a HID
 * path, a serial number, a discovered candidate id or any macro text, and it is
 * never sent to the device: the firmware has no alias concept.
 *
 * Everything here is pure except [`readDeviceAliasStore`] and
 * [`writeDeviceAliasStore`], which are no-ops outside a browser host.
 */

/** Storage key of the whole alias map; the version suffix allows a later migration. */
export const DEVICE_ALIAS_STORAGE_KEY = "zmk-runtime-macro-device-alias:v1";

/**
 * Upper bound of one alias, in UTF-8 bytes. It matches the tray display-name
 * bound so an alias can always be shown in the native menu.
 */
export const MAX_DEVICE_ALIAS_BYTES = 64;

/** One alias per safe device summary key. */
export type DeviceAliasStore = Record<string, string>;

/** Why an alias draft cannot be used. */
export type DeviceAliasError = "tooLong" | "controlCharacter" | "duplicate";

/**
 * A safe device summary key is the five numeric parts joined by colons. The key
 * is derived locally from vendor/product/interface/usage metadata and is not a
 * HID path or a serial number.
 */
const SUMMARY_KEY_PATTERN = /^-?\d+(:-?\d+){4}$/;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Byte length in the same unit the tray bound uses. */
export function deviceAliasByteLength(alias: string): number {
  return new TextEncoder().encode(alias).length;
}

/**
 * Why one alias draft is unusable, or `null` when it is fine.
 *
 * An empty (or whitespace-only) draft is not an error: it means "no alias" and
 * clears the entry.
 */
export function deviceAliasError(raw: string): DeviceAliasError | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (deviceAliasByteLength(trimmed) > MAX_DEVICE_ALIAS_BYTES) return "tooLong";
  if (hasControlCharacter(trimmed)) return "controlCharacter";
  return null;
}

/** The stored form of a draft: trimmed, or `null` when the alias is cleared. */
export function normalizeDeviceAlias(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Keep only well-formed entries of a raw stored value.
 *
 * A hand-edited or outdated store must never leak an unsafe key or an alias that
 * could not be shown in the native menu, so invalid entries are dropped instead
 * of being repaired.
 */
export function normalizeDeviceAliasStore(value: unknown): DeviceAliasStore {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const store: DeviceAliasStore = {};
  for (const [key, alias] of Object.entries(value as Record<string, unknown>)) {
    if (!SUMMARY_KEY_PATTERN.test(key)) continue;
    if (typeof alias !== "string") continue;
    if (deviceAliasError(alias) !== null) continue;
    const normalized = normalizeDeviceAlias(alias);
    if (normalized !== null) store[key] = normalized;
  }
  return store;
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Read the alias map; a missing or unreadable entry resolves to no aliases. */
export function readDeviceAliasStore(): DeviceAliasStore {
  const storage = browserStorage();
  if (storage === null) return {};
  try {
    const raw = storage.getItem(DEVICE_ALIAS_STORAGE_KEY);
    if (raw === null) return {};
    return normalizeDeviceAliasStore(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Persist the alias map. A failed write never affects device data. */
export function writeDeviceAliasStore(store: DeviceAliasStore): void {
  const storage = browserStorage();
  if (storage === null) return;
  try {
    storage.setItem(DEVICE_ALIAS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // The alias is an optional local preference, never device state.
  }
}

/**
 * Alias of one device summary key.
 *
 * The lookup is by exact summary key, so another device (or the same device with
 * a different interface/usage) never inherits an alias it was not given.
 */
export function deviceAliasFor(store: DeviceAliasStore, summaryKey: string | null): string | null {
  if (summaryKey === null) return null;
  return store[summaryKey] ?? null;
}

/**
 * The summary key that already uses `alias`, excluding `summaryKey` itself.
 *
 * Aliases are unique per machine: two devices with the same name would make the
 * Scenario device binding ambiguous.
 */
export function deviceAliasOwner(
  store: DeviceAliasStore,
  alias: string,
  summaryKey: string,
): string | null {
  for (const [key, value] of Object.entries(store)) {
    if (key !== summaryKey && value === alias) return key;
  }
  return null;
}

/** Result of applying an alias draft: either the next store or a reason to refuse. */
export type DeviceAliasUpdate =
  | { ok: true; store: DeviceAliasStore; alias: string | null }
  | { ok: false; error: DeviceAliasError };

/**
 * Apply one alias draft to a device summary key.
 *
 * An empty draft clears the entry; a duplicate alias is refused instead of
 * silently stealing it from another device.
 */
export function setDeviceAlias(
  store: DeviceAliasStore,
  summaryKey: string,
  draft: string,
): DeviceAliasUpdate {
  const error = deviceAliasError(draft);
  if (error !== null) return { ok: false, error };
  const alias = normalizeDeviceAlias(draft);
  if (alias === null) {
    const next: DeviceAliasStore = { ...store };
    delete next[summaryKey];
    return { ok: true, store: next, alias: null };
  }
  if (deviceAliasOwner(store, alias, summaryKey) !== null) {
    return { ok: false, error: "duplicate" };
  }
  return { ok: true, store: { ...store, [summaryKey]: alias }, alias };
}
