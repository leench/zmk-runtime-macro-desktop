import type { DynamicCapabilities } from "../bridge";
import type { DynamicObjectState } from "../types/dynamic";

/**
 * Dynamic Protocol v2 objects are independent RAM-only buffers; a device
 * reports its object count, object size and TTL range through CAPABILITIES.
 * The constants below are UI fallbacks that only apply until the device has
 * reported that capability.
 */
export const MAX_DYNAMIC_BYTES = 512;
export const MIN_DYNAMIC_TTL_SECONDS = 1;
export const MAX_DYNAMIC_TTL_SECONDS = 86_400;
export const DEFAULT_DYNAMIC_TTL_SECONDS = 300;
/** Initial target object; the first object always exists on a supported device. */
export const FIRST_DYNAMIC_SLOT = 0;

export type DynamicLimits = {
  maxBytes: number;
  minTtlSeconds: number;
  maxTtlSeconds: number;
  defaultTtlSeconds: number;
};

export type DynamicInputError = "empty" | "unsupported" | "tooLong" | "ttlInvalid";

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Capability-driven limits, with fallbacks only while the capability is unknown. */
export function dynamicLimits(capabilities: DynamicCapabilities | null): DynamicLimits {
  const maxBytes = capabilities?.maxDynamicLength;
  const minTtl = capabilities?.minTtlSeconds;
  const maxTtl = capabilities?.maxTtlSeconds;
  const defaultTtl = capabilities?.defaultTtlSeconds;
  return {
    maxBytes: positiveInteger(maxBytes) ? maxBytes : MAX_DYNAMIC_BYTES,
    minTtlSeconds: positiveInteger(minTtl) ? minTtl : MIN_DYNAMIC_TTL_SECONDS,
    maxTtlSeconds: positiveInteger(maxTtl) ? maxTtl : MAX_DYNAMIC_TTL_SECONDS,
    defaultTtlSeconds: positiveInteger(defaultTtl) ? defaultTtl : DEFAULT_DYNAMIC_TTL_SECONDS,
  };
}

/** Wire slots for the reported object count; empty while the capability is unknown. */
export function dynamicObjectSlots(capabilities: DynamicCapabilities | null): number[] {
  const count = capabilities?.dynamicObjectCount;
  if (!positiveInteger(count)) return [];
  return Array.from({ length: count }, (_, index) => index);
}

/** TTL presets inside the reported range; the device maximum replaces the fallback. */
export function dynamicTtlPresets(limits: DynamicLimits): number[] {
  const candidates = [1, 10, 60, 300, 3600, limits.maxTtlSeconds];
  return [...new Set(candidates.filter((value) => value >= limits.minTtlSeconds && value <= limits.maxTtlSeconds))].sort((a, b) => a - b);
}

export function createDynamicObjectState(slot: number): DynamicObjectState {
  return {
    slot,
    draftText: "",
    ttlSeconds: null,
    keepAfterExecute: false,
    status: "idle",
    progress: null,
    error: null,
    clearConfirm: false,
  };
}

/** Drop transient operation feedback; drafts and confirmed observations are kept. */
export function clearDynamicObjectFeedback(state: DynamicObjectState): DynamicObjectState {
  const status = state.status === "error" ? "idle" : state.status;
  if (state.progress === null && state.error === null && status === state.status) return state;
  return { ...state, status, progress: null, error: null };
}

/** Reset operation state after a connection loss; the in-memory draft survives. */
export function resetDynamicObjectOperation(state: DynamicObjectState): DynamicObjectState {
  return state.status === "idle" && state.progress === null && state.error === null && !state.clearConfirm
    ? state
    : { ...state, status: "idle", progress: null, error: null, clearConfirm: false };
}

/**
 * Align the object collection with the reported capability: keep the state of
 * objects that still exist, create the missing ones and drop the rest.
 */
export function normalizeDynamicObjects(
  previous: DynamicObjectState[],
  slots: number[],
  supportsKeepAfterExecute: boolean,
): DynamicObjectState[] {
  return slots.map((slot) => {
    const base = previous.find((state) => state.slot === slot) ?? createDynamicObjectState(slot);
    return base.keepAfterExecute && !supportsKeepAfterExecute ? { ...base, keepAfterExecute: false } : base;
  });
}

export function dynamicByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function validateDynamicText(text: string, maxBytes: number): DynamicInputError | null {
  if (text.length === 0) return "empty";
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > maxBytes) return "tooLong";
  for (const byte of bytes) {
    if (!((byte >= 0x20 && byte <= 0x7e) || byte === 0x08 || byte === 0x09 || byte === 0x0a)) {
      return "unsupported";
    }
  }
  return null;
}

export function validateDynamicTtl(
  ttlSeconds: number | null,
  limits: Pick<DynamicLimits, "minTtlSeconds" | "maxTtlSeconds">,
): DynamicInputError | null {
  if (ttlSeconds === null) return null;
  return Number.isInteger(ttlSeconds)
    && ttlSeconds >= limits.minTtlSeconds
    && ttlSeconds <= limits.maxTtlSeconds
    ? null
    : "ttlInvalid";
}
