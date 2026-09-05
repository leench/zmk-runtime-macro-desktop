import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Keyboard, LockKeyhole, RefreshCw, Unplug } from "lucide-react";
import type { DeviceCandidate } from "../bridge";

type DeviceSwitcherProps = {
  devices: DeviceCandidate[];
  currentCandidateId?: string;
  deviceName: string;
  connectedLabel: string;
  interfaceLabel: string;
  interfaceNumberLabel: (value: number) => string;
  unnamedLabel: string;
  menuLabel: string;
  discoveredLabel: string;
  unavailableLabel: string;
  runtimeMacroLabel: string;
  refreshLabel: string;
  disconnectLabel: string;
  lockLabel?: string;
  protectedAuthenticated: boolean;
  onSwitchDevice: (id: string) => void;
  onRefresh: () => void;
  onDisconnect: () => void;
  onLock: () => void;
  disabled?: boolean;
  initialOpen?: boolean;
};

function candidateName(candidate: DeviceCandidate, fallback: string): string {
  return candidate.productName || fallback;
}

function formatHex(value: number): string {
  return value.toString(16).padStart(4, "0");
}

export function DeviceSwitcher({
  devices,
  currentCandidateId,
  deviceName,
  connectedLabel,
  interfaceLabel,
  interfaceNumberLabel,
  unnamedLabel,
  menuLabel,
  discoveredLabel,
  unavailableLabel,
  runtimeMacroLabel,
  refreshLabel,
  disconnectLabel,
  lockLabel,
  protectedAuthenticated,
  onSwitchDevice,
  onRefresh,
  onDisconnect,
  onLock,
  disabled = false,
  initialOpen = false,
}: DeviceSwitcherProps) {
  const [open, setOpen] = useState(initialOpen);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div className="relative min-w-0" ref={containerRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className={`flex items-center gap-3 rounded-xl border py-2 pl-2 pr-3 text-left transition-colors duration-150 ease-out ${open ? "border-line-strong bg-surface-2" : "border-transparent hover:bg-surface-2"}`}
      >
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
          <Keyboard className="h-[22px] w-[22px]" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-ink">{deviceName}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
            {connectedLabel} · {interfaceLabel}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 text-ink-subtle transition-transform duration-150 ease-out ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open ? (
        <div role="menu" aria-label={menuLabel} className="absolute left-0 top-[68px] z-20 w-[340px] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl shadow-black/10">
          <p className="px-4 pb-2 pt-3.5 text-xs font-medium uppercase tracking-wide text-ink-subtle">{discoveredLabel}</p>
          <ul className="pb-1.5">
            {devices.map((candidate) => {
              const current = candidate.id === currentCandidateId;
              return (
                <li key={candidate.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      if (!current) onSwitchDevice(candidate.id);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 ease-out hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                    disabled={disabled}
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center">
                      {current ? <Check className="h-4 w-4 text-accent" aria-hidden="true" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-ink">{candidateName(candidate, unnamedLabel)}</span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-xs text-ink-subtle">
                        {`${formatHex(candidate.vendorId)} / ${formatHex(candidate.productId)} · ${interfaceNumberLabel(candidate.interfaceNumber)} · ${candidate.usageMetadata === "exact" ? runtimeMacroLabel : unavailableLabel}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-line py-1.5">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onRefresh(); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-2" disabled={disabled}>
              <RefreshCw className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              {refreshLabel}
            </button>
            {protectedAuthenticated && lockLabel ? (
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onLock(); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-2" disabled={disabled}>
                <LockKeyhole className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                {lockLabel}
              </button>
            ) : null}
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onDisconnect(); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-danger hover:bg-danger-soft" disabled={disabled}>
              <Unplug className="h-4 w-4 text-danger" aria-hidden="true" />
              {disconnectLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
