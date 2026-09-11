/**
 * Dynamic Protocol v2 objects are independent RAM-only buffers; a device
 * reports its object count and max length through CAPABILITIES.
 */
export const MAX_DYNAMIC_BYTES = 512;
/** The backend probes capabilities with this object and the current UI targets it. */
export const FIRST_DYNAMIC_SLOT = 0;
export const MIN_DYNAMIC_TTL_SECONDS = 1;
export const MAX_DYNAMIC_TTL_SECONDS = 86_400;

export type DynamicInputError = "empty" | "unsupported" | "tooLong" | "ttlInvalid";

export function dynamicByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function validateDynamicText(text: string): DynamicInputError | null {
  if (text.length === 0) return "empty";
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_DYNAMIC_BYTES) return "tooLong";
  for (const byte of bytes) {
    if (!((byte >= 0x20 && byte <= 0x7e) || byte === 0x08 || byte === 0x09 || byte === 0x0a)) {
      return "unsupported";
    }
  }
  return null;
}

export function validateDynamicTtl(ttlSeconds: number | null): DynamicInputError | null {
  if (ttlSeconds === null) return null;
  return Number.isInteger(ttlSeconds)
    && ttlSeconds >= MIN_DYNAMIC_TTL_SECONDS
    && ttlSeconds <= MAX_DYNAMIC_TTL_SECONDS
    ? null
    : "ttlInvalid";
}
