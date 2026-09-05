import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Unplug,
  LockKeyhole,
  Moon,
  MoreHorizontal,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type { DeviceCandidate } from "../bridge";
import type { Messages } from "../i18n";
import type { ThemeMode } from "../types/ui";
import { ConfiguredBytesSummary } from "./ConfiguredBytesSummary";
import { DeviceSwitcher } from "./DeviceSwitcher";
import { IconButton } from "./IconButton";

type AppHeaderProps = {
  copy: Messages;
  devices: DeviceCandidate[];
  currentCandidateId?: string;
  deviceName: string;
  statusLabel: string;
  authRemainingSeconds: number | null;
  interfaceLabel: string;
  interfaceNumberLabel: (value: number) => string;
  configuredBytes: number;
  theme: ThemeMode;
  refreshing: boolean;
  protectedAuthenticated: boolean;
  isOpen: boolean;
  onThemeChange: (theme: ThemeMode) => void;
  onRefresh: () => void;
  onRefreshDevices: () => void;
  onSettings: () => void;
  onDiagnostics: () => void;
  onSetPassword: () => void;
  onChangePassword: () => void;
  onLock: () => void;
  onSwitchDevice: (id: string) => void;
  onDisconnect: () => void;
  disabled?: boolean;
};

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function AppHeader({
  copy,
  devices,
  currentCandidateId,
  deviceName,
  statusLabel,
  authRemainingSeconds,
  interfaceLabel,
  interfaceNumberLabel,
  configuredBytes,
  theme,
  refreshing,
  protectedAuthenticated,
  isOpen,
  onThemeChange,
  onRefresh,
  onRefreshDevices,
  onSettings,
  onDiagnostics,
  onSetPassword,
  onChangePassword,
  onLock,
  onSwitchDevice,
  onDisconnect,
  disabled = false,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const toggleTheme = () => onThemeChange(dark ? "light" : "dark");

  return (
    <div className="flex h-[76px] shrink-0 items-center gap-7 border-b border-line bg-surface px-5">
      <DeviceSwitcher
        devices={devices}
        currentCandidateId={currentCandidateId}
        deviceName={deviceName}
        connectedLabel={statusLabel}
        interfaceLabel={interfaceLabel}
        interfaceNumberLabel={interfaceNumberLabel}
        unnamedLabel={copy.unnamedDevice}
        menuLabel={copy.switchDevice}
        discoveredLabel={copy.discoveredDevices}
        unavailableLabel={copy.usageMetadataUnavailable}
        runtimeMacroLabel={copy.v2RuntimeMacro}
        refreshLabel={copy.refresh}
        disconnectLabel={copy.disconnect}
        lockLabel={copy.lockDevice}
        protectedAuthenticated={protectedAuthenticated}
        onSwitchDevice={onSwitchDevice}
        onRefresh={onRefreshDevices}
        onDisconnect={onDisconnect}
        onLock={onLock}
        disabled={disabled}
      />

      <ConfiguredBytesSummary
        label={copy.configuredBytes}
        valueLabel={copy.configuredBytesValue(configuredBytes)}
      />

      {protectedAuthenticated && authRemainingSeconds !== null ? (
        <span className="shrink-0 font-mono text-xs font-medium text-ink-muted" role="status" aria-live="polite">
          {copy.authSessionRemaining(authRemainingSeconds)}
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        <IconButton icon={refreshing ? Activity : RefreshCw} label={copy.refreshSlots} onClick={onRefresh} disabled={disabled || refreshing} />
        <IconButton icon={dark ? Sun : Moon} label={copy.theme} onClick={toggleTheme} disabled={disabled} />
        <IconButton icon={Settings} label={copy.settings} onClick={onSettings} disabled={disabled} />
        <div className="relative" ref={menuRef}>
          <IconButton
            icon={MoreHorizontal}
            label={copy.moreActions}
            active={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            disabled={disabled}
          />
          {menuOpen ? (
            <div className="absolute right-0 top-12 z-20 w-52 overflow-hidden rounded-xl border border-line bg-surface py-1.5 shadow-lg shadow-black/5" role="menu" aria-label={copy.moreActions}>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onDiagnostics(); }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-2"
              >
                <Activity className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                {copy.diagnostics}
              </button>
              {protectedAuthenticated || isOpen ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMenuOpen(false); protectedAuthenticated ? onChangePassword() : onSetPassword(); }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-2"
                  >
                    <ShieldCheck className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                    {protectedAuthenticated ? copy.changePassword : copy.setPassword}
                  </button>
                  {protectedAuthenticated ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setMenuOpen(false); onLock(); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-2"
                    >
                      <LockKeyhole className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                      {copy.lockDevice}
                    </button>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onDisconnect(); }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-2"
              >
                <Unplug className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                {copy.disconnect}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
