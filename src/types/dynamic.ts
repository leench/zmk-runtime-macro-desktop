import type { CommandError } from "../bridge";

/**
 * Device-level result of the dynamic `CAPABILITIES` exchange. It is not tied to
 * a single object, so a capability refresh never overwrites per-object state.
 */
export type DynamicCapabilityStatus = "unknown" | "discovering" | "ready" | "unsupported" | "error";

/** Local observation of one dynamic object in the current session. */
export type DynamicObjectStatus = "idle" | "uploading" | "clearing" | "committed" | "cleared" | "error";

/**
 * In-memory state of one device dynamic object. `draftText` only ever lives in
 * React memory: it is never written to storage, logs, diagnostics or reports.
 */
export type DynamicObjectState = {
  /** Wire slot reported by CAPABILITIES (`0..dynamic_object_count-1`). */
  slot: number;
  draftText: string;
  /** `null` keeps the device default TTL. */
  ttlSeconds: number | null;
  keepAfterExecute: boolean;
  status: DynamicObjectStatus;
  /** 0-100 while an operation is running, otherwise `null`. */
  progress: number | null;
  error: CommandError | null;
  /** Pending inline clear confirmation for this object. */
  clearConfirm: boolean;
};
