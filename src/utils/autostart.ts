/**
 * Presentation state of the login-autostart row in the settings modal.
 *
 * The row has exactly one source of truth: the operating-system entry that the
 * official autostart plugin reports. There is no second, local switch, so a
 * failed read can never be shown as "off" and a rejected change can never look
 * applied. Everything here is pure: the settings modal owns the calls.
 */

import type { CommandError } from "../bridge";

/** Everything the settings row needs to render. */
export type AutostartView = {
  /** `true`/`false` as reported by the operating system, `null` while unknown. */
  enabled: boolean | null;
  /** This host can read and change the login entry. */
  supported: boolean;
  /** A read or a change is in flight. */
  busy: boolean;
  /** Sanitized reason of the newest failed read or change. */
  error: CommandError | null;
};

/** A host without an autostart surface, such as the browser preview. */
export const AUTOSTART_UNSUPPORTED_VIEW: AutostartView = {
  enabled: null,
  supported: false,
  busy: false,
  error: null,
};

/** A supported host whose state has not been read yet. */
export const AUTOSTART_LOADING_VIEW: AutostartView = {
  enabled: null,
  supported: true,
  busy: false,
  error: null,
};

/** Result of a read or of a finished change: the confirmed state, or a failure. */
export type AutostartResult = { ok: true; enabled: boolean } | { ok: false; error: CommandError };

/** The row while a read or a change is in flight; a pending change clears an old error. */
export function autostartPendingView(current: AutostartView): AutostartView {
  return { ...current, busy: true, error: null };
}

/**
 * Apply a finished read or change.
 *
 * A success replaces the row with the state the operating system confirms, so
 * the toggle can never drift from the real entry. A failure keeps the previous
 * state and only adds the sanitized error.
 */
export function autostartResultView(current: AutostartView, result: AutostartResult): AutostartView {
  if (!result.ok) return { ...current, busy: false, error: result.error };
  return { enabled: result.enabled, supported: true, busy: false, error: null };
}

/**
 * Whether the toggle may be operated.
 *
 * A change is only offered once the current state is known and no read or change
 * is running, so the user never toggles a state the app cannot describe.
 */
export function autostartToggleEnabled(view: AutostartView): boolean {
  return view.supported && !view.busy && view.enabled !== null;
}

/** Which status text the row shows next to the toggle. */
export type AutostartStatusKind = "unavailable" | "enabled" | "disabled" | "unknown";

export function autostartStatusKind(view: AutostartView): AutostartStatusKind {
  if (!view.supported) return "unavailable";
  if (view.enabled === true) return "enabled";
  if (view.enabled === false) return "disabled";
  return "unknown";
}
