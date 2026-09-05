import { ArrowRight, Check, Keyboard, RefreshCw, Usb } from "lucide-react";
import type { DeviceCandidate } from "../bridge";
import type { Messages } from "../i18n";
import { TitleBar, type Platform } from "../components/TitleBar";

function formatHex(value: number): string {
  return value.toString(16).padStart(4, "0");
}

type DeviceSelectProps = {
  copy: Messages;
  platform: Platform;
  devices: DeviceCandidate[];
  selectedId: string;
  checking: boolean;
  busy: boolean;
  errorMessage: string | null;
  errorCode: string | null;
  dirtyDraft: boolean;
  onSelect: (id: string) => void;
  onConnect: () => void;
  onRefresh: () => void;
};

export function DeviceSelect({ copy, platform, devices, selectedId, checking, busy, errorMessage, errorCode, dirtyDraft, onSelect, onConnect, onRefresh }: DeviceSelectProps) {
  const selected = devices.some((device) => device.id === selectedId);
  const upgradeError = errorCode === "bad_version";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      <TitleBar platform={platform} title={copy.appName} labels={{ close: copy.close, minimize: copy.minimize, maximize: copy.maximize }} />
      <main className="flex flex-1 items-center justify-center overflow-y-auto px-8 py-10">
        <div className="w-full max-w-[560px]">
          <div className="text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Keyboard className="h-7 w-7" aria-hidden="true" />
            </span>
            <h1 className="mt-5 text-2xl font-semibold text-ink">{copy.chooseDevice}</h1>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-ink-muted">
              <Usb className="h-4 w-4" aria-hidden="true" />
              {copy.discoveredDevicesCount(devices.length)}
            </p>
          </div>

          {errorMessage ? (
            <div className={`mt-6 rounded-xl border px-4 py-3 text-sm ${upgradeError ? "border-warning bg-warning-soft text-warning" : "border-danger bg-danger-soft text-danger"}`} role="alert">
              <strong className="block font-semibold">{upgradeError ? copy.oldFirmwareTitle : copy.connectionFailed}</strong>
              <span className="mt-1 block leading-relaxed">{upgradeError ? copy.oldFirmwareHelp : errorMessage}</span>
            </div>
          ) : null}
          {dirtyDraft ? <p className="mt-4 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning" role="status">{copy.disconnectNote}</p> : null}

          {devices.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center" aria-live="polite">
              <p className="text-sm text-ink-muted">{checking ? copy.checkingCompatibleDevices : copy.noCompatibleDevice}</p>
              {!checking ? <button type="button" onClick={onRefresh} disabled={busy} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-medium text-ink-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="h-4 w-4" aria-hidden="true" />{copy.refresh}</button> : null}
            </div>
          ) : (
            <ul className="mt-8 space-y-2.5" role="radiogroup" aria-label={copy.availableDevices}>
              {devices.map((device) => {
                const isSelected = device.id === selectedId;
                return (
                  <li key={device.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => onSelect(device.id)}
                      disabled={busy}
                      className={`flex w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-55 ${isSelected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong"}`}
                    >
                      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${isSelected ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-muted"}`}>
                        <Keyboard className="h-[22px] w-[22px]" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium text-ink">{device.productName || copy.unnamedDevice}</span>
                        <span className="mt-0.5 block truncate font-mono text-xs text-ink-subtle">
                          {formatHex(device.vendorId)} / {formatHex(device.productId)} · {copy.interfaceNumber(device.interfaceNumber)} · {device.usageMetadata === "exact" ? copy.v2RuntimeMacro : copy.usageMetadataUnavailable}
                        </span>
                      </span>
                      {isSelected ? <Check className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-8 flex items-center justify-between gap-4">
            <button type="button" onClick={onRefresh} disabled={busy} className="inline-flex h-12 items-center gap-2 rounded-xl px-4 text-sm font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
              {checking ? copy.checking : copy.refresh}
            </button>
            <button type="button" disabled={busy || !selected} onClick={onConnect} className="inline-flex h-12 items-center gap-2.5 rounded-xl bg-accent px-7 text-sm font-semibold text-accent-ink transition-[background-color,opacity] duration-150 ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-subtle">
              {copy.connectSelected}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-5 text-center text-xs text-ink-subtle">{copy.v2OnlyHelp}</p>
        </div>
      </main>
    </div>
  );
}
