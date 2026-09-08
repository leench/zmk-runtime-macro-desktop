import { AlertCircle, Check, CircleHelp, CloudUpload, Eraser, ShieldAlert } from "lucide-react";
import type { CommandError, DynamicCapabilities } from "../bridge";
import type { Messages } from "../i18n";
import { SelectField } from "./SelectField";
import {
  dynamicByteLength,
  MAX_DYNAMIC_BYTES,
  MAX_DYNAMIC_TTL_SECONDS,
  MIN_DYNAMIC_TTL_SECONDS,
  validateDynamicText,
  validateDynamicTtl,
  type DynamicInputError,
} from "../utils/dynamic";

export type DynamicMacroStatus = "unknown" | "discovering" | "ready" | "uploading" | "clearing" | "committed" | "cleared" | "error" | "unsupported";

type DynamicTtlSelection = "default" | "custom" | "1" | "10" | "60" | "300" | "3600" | "86400";

const DYNAMIC_TTL_VALUES = [1, 10, 60, 300, 3600, MAX_DYNAMIC_TTL_SECONDS];

export type DynamicMacroPanelProps = {
  embedded?: boolean;
  copy: Messages;
  capabilities: DynamicCapabilities | null;
  text: string;
  ttlSeconds: number | null;
  keepAfterExecute: boolean;
  status: DynamicMacroStatus;
  progress: number | null;
  error: CommandError | null;
  disabled: boolean;
  clearPending: boolean;
  onTextChange: (value: string) => void;
  onTtlChange: (value: number | null) => void;
  onKeepChange: (value: boolean) => void;
  onUpload: () => Promise<CommandError | null>;
  onClearRequest: () => void;
  onClearConfirm: () => Promise<CommandError | null>;
  onClearCancel: () => void;
};

function inputErrorMessage(copy: Messages, error: DynamicInputError | null): string | null {
  if (error === "empty") return copy.dynamicTextRequired;
  if (error === "unsupported") return copy.dynamicUnsupportedText;
  if (error === "tooLong") return copy.dynamicTextTooLong;
  if (error === "ttlInvalid") return copy.dynamicTtlInvalid;
  return null;
}

function statusLabel(copy: Messages, status: DynamicMacroStatus): string {
  if (status === "unknown") return copy.dynamicStatusUnknown;
  if (status === "discovering") return copy.dynamicStatusDiscovering;
  if (status === "ready") return copy.dynamicStatusReady;
  if (status === "uploading") return copy.dynamicStatusUploading;
  if (status === "clearing") return copy.dynamicStatusClearing;
  if (status === "committed") return copy.dynamicStatusCommitted;
  if (status === "cleared") return copy.dynamicStatusCleared;
  if (status === "unsupported") return copy.dynamicStatusUnsupported;
  return copy.dynamicStatusError;
}

export function DynamicMacroPanel({
  embedded = false,
  copy,
  capabilities,
  text,
  ttlSeconds,
  keepAfterExecute,
  status,
  progress,
  error,
  disabled,
  clearPending,
  onTextChange,
  onTtlChange,
  onKeepChange,
  onUpload,
  onClearRequest,
  onClearConfirm,
  onClearCancel,
}: DynamicMacroPanelProps) {
  const textError = validateDynamicText(text);
  const ttlError = validateDynamicTtl(ttlSeconds);
  const localError = inputErrorMessage(copy, textError ?? ttlError);
  const canOperate = capabilities !== null && status !== "unsupported" && status !== "discovering";
  const canUpload = canOperate && !disabled && localError === null && status !== "uploading" && status !== "clearing";
  const canClear = canOperate && !disabled && status !== "uploading" && status !== "clearing";
  const capabilityStatus = capabilities
    ? `${copy.dynamicCapabilityVersion} ${capabilities.capabilityVersion} · ${copy.dynamicMaxBytes(capabilities.maxDynamicLength)}`
    : statusLabel(copy, status);
  const ttlSelection: DynamicTtlSelection = ttlSeconds === null
    ? "default"
    : DYNAMIC_TTL_VALUES.includes(ttlSeconds)
      ? String(ttlSeconds) as DynamicTtlSelection
      : "custom";
  const ttlOptions: ReadonlyArray<{ value: DynamicTtlSelection; label: string }> = [
    { value: "default", label: copy.dynamicTtlDefault(capabilities?.defaultTtlSeconds ?? 300) },
    { value: "custom", label: copy.dynamicTtlCustom },
    { value: "1", label: `1 ${copy.seconds}` },
    { value: "10", label: `10 ${copy.seconds}` },
    { value: "60", label: `60 ${copy.seconds}` },
    { value: "300", label: `300 ${copy.seconds}` },
    { value: "3600", label: `3600 ${copy.seconds}` },
    { value: "86400", label: `${MAX_DYNAMIC_TTL_SECONDS} ${copy.seconds}` },
  ];

  return (
    <section className={embedded ? "shrink-0 p-6" : "mx-10 my-3 shrink-0 rounded-2xl border border-line bg-surface p-5"} aria-labelledby="dynamic-macro-heading">
      <div className={`flex flex-wrap items-start justify-between gap-4 ${embedded ? "pr-12" : ""}`}>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{copy.dynamicMacro}</p>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] text-accent">RAM-only</span>
          </div>
          <h2 id="dynamic-macro-heading" className="mt-1 text-lg font-semibold text-ink">{copy.dynamicMacroTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{copy.dynamicMacroHelp}</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted" role="status">
          {status === "committed" || status === "cleared" ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : status === "error" || status === "unsupported" ? <AlertCircle className="h-3.5 w-3.5 text-danger" aria-hidden="true" /> : <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />}
          <span>{statusLabel(copy, status)}</span>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-sm leading-relaxed text-warning" role="note">
        <strong className="font-semibold">{copy.dynamicUnencryptedTitle}</strong> {copy.dynamicUnencryptedHelp}
      </div>

      {status === "unsupported" ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm text-ink-muted" role="status">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <span>{copy.dynamicUnsupportedHelp}</span>
        </div>
      ) : null}

      <div className="mt-4 grid items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.55fr)]">
        <label className="flex h-full min-w-0 flex-col" htmlFor="dynamic-macro-text">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-ink">{copy.dynamicMacroText}</span>
            <span className={`shrink-0 font-mono text-xs ${dynamicByteLength(text) > MAX_DYNAMIC_BYTES ? "text-danger" : "text-ink-subtle"}`}>{copy.dynamicBytes(dynamicByteLength(text), MAX_DYNAMIC_BYTES)}</span>
          </div>
          <textarea
            id="dynamic-macro-text"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            disabled={!canOperate || disabled || status === "uploading" || status === "clearing"}
            spellCheck={false}
            rows={3}
            aria-invalid={Boolean(localError)}
            aria-describedby={localError ? "dynamic-macro-error" : "dynamic-macro-help"}
            className={`mt-2 min-h-[132px] flex-1 resize-y rounded-xl border bg-surface px-3.5 py-3 font-mono text-sm leading-relaxed text-ink ${localError ? "border-danger" : "border-line-strong"}`}
            placeholder={copy.dynamicMacroPlaceholder}
          />
          <small id="dynamic-macro-help" className="mt-1.5 block text-xs text-ink-subtle">{copy.dynamicMacroTextHelp}</small>
          {localError ? <p id="dynamic-macro-error" className="mt-2 flex items-center gap-1.5 text-sm font-medium text-danger" role="alert"><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{localError}</p> : null}
          {error && !localError ? <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-danger" role="alert"><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{error.code === "dynamic_unsupported" ? copy.dynamicUnsupportedHelp : error.code === "dynamic_keep_unsupported" ? copy.dynamicSingleUseUnsupported : copy.dynamicOperationError}</p> : null}
        </label>

        <div className="min-w-0">
          <div className="h-full rounded-xl border border-line bg-surface-2 px-3.5 py-3">
            <p className="text-sm font-medium text-ink-subtle">{copy.dynamicCapabilityStatus}</p>
            <p className="mt-1 font-mono text-sm text-ink">{capabilityStatus}</p>
            {capabilities ? <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-muted">
              <span>{copy.dynamicLifecycleBoot}: {capabilities.clearOnBoot ? copy.dynamicYes : copy.dynamicNo}</span>
              <span>{copy.dynamicLifecycleTtl}: {capabilities.clearOnTtlExpiry ? copy.dynamicYes : copy.dynamicNo}</span>
              <span>{copy.dynamicLifecycleExecute}: {capabilities.clearOnExecutionAccept ? copy.dynamicYes : copy.dynamicNo}</span>
              <span>{copy.dynamicLifecycleUsb}: {capabilities.clearOnUsbDisconnect ? copy.dynamicYes : copy.dynamicNo}</span>
              <span>{copy.dynamicLifecycleBle}: {capabilities.clearOnBleProfileChange ? copy.dynamicYes : copy.dynamicNo}</span>
              <span>{copy.dynamicLifecycleEndpoint}: {capabilities.clearOnSelectedEndpointChange ? copy.dynamicYes : copy.dynamicNo}</span>
            </div> : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-w-0">
          <span id="dynamic-ttl-label" className="block text-sm font-medium text-ink sm:whitespace-nowrap">{copy.dynamicTtl}</span>
          <SelectField
            id="dynamic-ttl"
            labelledBy="dynamic-ttl-label"
            value={ttlSelection}
            options={ttlOptions}
            onChange={(value) => onTtlChange(value === "default" ? null : value === "custom" ? Number.NaN : Number(value))}
            disabled={!canOperate || disabled || status === "uploading" || status === "clearing"}
          />
          {ttlSeconds !== null && !DYNAMIC_TTL_VALUES.includes(ttlSeconds) ? <input type="number" min={MIN_DYNAMIC_TTL_SECONDS} max={MAX_DYNAMIC_TTL_SECONDS} step={1} value={Number.isFinite(ttlSeconds) ? ttlSeconds : ""} onChange={(event) => onTtlChange(event.target.value.trim() === "" ? Number.NaN : Number(event.target.value))} disabled={!canOperate || disabled || status === "uploading" || status === "clearing"} aria-label={copy.dynamicTtlCustom} className="mt-2 h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-mono text-sm text-ink" /> : null}
          <small className="mt-1 block text-xs text-ink-subtle sm:whitespace-nowrap">{copy.dynamicTtlHelp(MIN_DYNAMIC_TTL_SECONDS, MAX_DYNAMIC_TTL_SECONDS)}</small>
        </div>

        <label className={`flex min-w-0 items-center justify-between gap-4 rounded-xl border border-line px-3.5 py-3 ${capabilities?.supportsKeepAfterExecute ? "" : "opacity-60"}`}>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink sm:whitespace-nowrap">{copy.dynamicSingleUse}</span>
            <small className="mt-0.5 block text-xs text-ink-subtle sm:whitespace-nowrap">{capabilities?.supportsKeepAfterExecute ? copy.dynamicSingleUseHelp : copy.dynamicSingleUseUnsupported}</small>
          </span>
          <input type="checkbox" checked={!capabilities?.supportsKeepAfterExecute || !keepAfterExecute} onChange={(event) => onKeepChange(!event.target.checked)} disabled={!canOperate || !capabilities?.supportsKeepAfterExecute || disabled || status === "uploading" || status === "clearing"} className="h-4 w-4 shrink-0 accent-accent" />
        </label>
      </div>

      {progress !== null ? <div className="mt-4" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="mb-1 flex justify-between text-xs text-ink-subtle"><span>{status === "clearing" ? copy.dynamicClearing : copy.dynamicUploading}</span><span className="font-mono">{progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${progress}%` }} /></div></div> : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-subtle">{copy.dynamicCapabilityNote}</span>
        <div className="flex items-center gap-2">
          {clearPending ? (
            <div className="flex items-center gap-2" role="alert">
              <span className="mr-1 text-sm text-ink-muted">{copy.clearThisMacro}</span>
              <button type="button" onClick={onClearCancel} disabled={disabled} className="inline-flex h-11 items-center rounded-lg border border-line-strong px-3.5 text-sm font-medium text-ink-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40">{copy.cancel}</button>
              <button type="button" onClick={() => { void onClearConfirm(); }} disabled={disabled || !canOperate} className="inline-flex h-11 items-center rounded-lg bg-danger px-3.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">{copy.clear}</button>
            </div>
          ) : (
            <button type="button" onClick={onClearRequest} disabled={!canClear} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong px-3.5 text-sm font-medium text-ink-muted hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"><Eraser className="h-4 w-4" aria-hidden="true" />{copy.dynamicClear}</button>
          )}
          <button type="button" onClick={() => { void onUpload(); }} disabled={!canUpload} className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-subtle"><CloudUpload className="h-4 w-4" aria-hidden="true" />{copy.dynamicUpload}</button>
        </div>
      </div>
    </section>
  );
}
