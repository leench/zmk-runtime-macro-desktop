import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { AlertCircle, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  asCommandError,
  authenticate,
  clearSlot as clearSlotCommand,
  connectDevice as connectDeviceCommand,
  disconnectDevice as disconnectDeviceCommand,
  getConnection,
  getSettings,
  getSlot,
  listDevices,
  refreshAuthState as refreshAuthStateCommand,
  listSlots,
  lockDevice,
  setPassword as setPasswordCommand,
  setSettings as setSettingsCommand,
  setSlot as setSlotCommand,
  type AuthState,
  type ClientSettings,
  type CommandError,
  type ConnectedDevice,
  type ConnectionState,
  type DeviceCandidate,
  type SlotBytes,
  type SlotMetadata,
} from "./bridge";
import {
  getMessages,
  isLanguagePreference,
  readLanguagePreference,
  resolveLocale,
  translateCommandError,
  translateInputError,
  translateSettingsValidation,
  writeLanguagePreference,
  type InputErrorKey,
  type LanguagePreference,
  type SettingsValidationKey,
} from "./i18n";
import { DeviceSelect } from "./pages/DeviceSelect";
import { MacroWorkbench } from "./pages/MacroWorkbench";
import { Unlock } from "./pages/Unlock";
import { PasswordSetupModal } from "./components/PasswordSetupModal";
import { PreviewSettingStepper } from "./components/PreviewSettingStepper";
import type { Platform } from "./components/TitleBar";
import type { ThemeMode } from "./types/ui";
import type { SlotAction, SlotState } from "./types/workbench";
import { MAX_TEXT_BYTES, macroBytes, textFromTokens, tokensFromText } from "./utils/macro";

const disconnected: ConnectionState = { connected: false, device: null, authState: "disconnected" };
const THEME_STORAGE_KEY = "zmk-runtime-macro-theme:v1";
const SETTINGS_STORAGE_KEY = "zmk-runtime-macro-settings:v1";
const PRIVACY_PREVIEW_STORAGE_KEY = "zmk-runtime-macro-privacy-preview:v1";
const LABELS_STORAGE_PREFIX = "zmk-runtime-macro-labels:v1";
const MIN_TIMEOUT_MS = 100;
const MIN_PREVIEW_CHARACTER_COUNT = 0;
const MAX_PREVIEW_CHARACTER_COUNT = 5;
const MIN_HOVER_REVEAL_DELAY = -1;
const MAX_HOVER_REVEAL_DELAY = 5;
const MAX_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 5;
const AUTH_SESSION_TIMEOUT_MS = 5 * 60 * 1_000;
const AUTH_SESSION_POLL_MS = 5_000;
const AUTO_RECONNECT_POLL_MS = 3_000;
const AUTO_RECONNECT_MISSED_POLLS = 2;
const DEFAULT_CLIENT_SETTINGS: ClientSettings = { timeoutMs: 1_000, retries: 2, appliesNextConnection: true };

type SettingsDraft = ClientSettings;
type PrivacyPreviewSettings = {
  previewCharacterCount: number;
  hoverRevealDelay: number;
};
type SettingsError = SettingsValidationKey | CommandError;

const DEFAULT_PRIVACY_PREVIEW_SETTINGS: PrivacyPreviewSettings = {
  previewCharacterCount: MIN_PREVIEW_CHARACTER_COUNT,
  hoverRevealDelay: MIN_HOVER_REVEAL_DELAY,
};

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function readTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

function readSettings(): SettingsDraft {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_CLIENT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_CLIENT_SETTINGS;
    const value = parsed as Record<string, unknown>;
    return {
      timeoutMs: typeof value.timeoutMs === "number" && Number.isInteger(value.timeoutMs) ? value.timeoutMs : DEFAULT_CLIENT_SETTINGS.timeoutMs,
      retries: typeof value.retries === "number" && Number.isInteger(value.retries) ? value.retries : DEFAULT_CLIENT_SETTINGS.retries,
      appliesNextConnection: true,
    };
  } catch {
    return DEFAULT_CLIENT_SETTINGS;
  }
}

function writeSettings(settings: SettingsDraft): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ timeoutMs: settings.timeoutMs, retries: settings.retries }));
  } catch {
    // Preferences are optional and never affect device data.
  }
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function readPrivacyPreviewSettings(): PrivacyPreviewSettings {
  try {
    const raw = localStorage.getItem(PRIVACY_PREVIEW_STORAGE_KEY);
    if (!raw) return DEFAULT_PRIVACY_PREVIEW_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_PRIVACY_PREVIEW_SETTINGS;
    const value = parsed as Record<string, unknown>;
    return {
      previewCharacterCount: clampInteger(value.previewCharacterCount, MIN_PREVIEW_CHARACTER_COUNT, MAX_PREVIEW_CHARACTER_COUNT, DEFAULT_PRIVACY_PREVIEW_SETTINGS.previewCharacterCount),
      hoverRevealDelay: clampInteger(value.hoverRevealDelay, MIN_HOVER_REVEAL_DELAY, MAX_HOVER_REVEAL_DELAY, DEFAULT_PRIVACY_PREVIEW_SETTINGS.hoverRevealDelay),
    };
  } catch {
    return DEFAULT_PRIVACY_PREVIEW_SETTINGS;
  }
}

function writePrivacyPreviewSettings(settings: PrivacyPreviewSettings): void {
  try {
    localStorage.setItem(PRIVACY_PREVIEW_STORAGE_KEY, JSON.stringify({
      previewCharacterCount: settings.previewCharacterCount,
      hoverRevealDelay: settings.hoverRevealDelay,
    }));
  } catch {
    // Preview preferences are optional and never affect device data.
  }
}

function deviceSummaryKey(device: ConnectedDevice | DeviceCandidate | null): string | null {
  if (!device) return null;
  return [device.vendorId, device.productId, device.interfaceNumber, device.usagePage, device.usage].join(":");
}

function matchingCandidates(devices: DeviceCandidate[], key: string): DeviceCandidate[] {
  return devices.filter((device) => deviceSummaryKey(device) === key);
}

function isDirty(slot: SlotState): boolean {
  return slot.loaded && (slot.savedText !== slot.draftText || slot.savedLabel !== slot.draftLabel);
}

function canManage(connection: ConnectionState): boolean {
  return connection.connected && (connection.authState === "open" || connection.authState === "authenticated");
}

function authStateForErrorCode(code: string): AuthState | null {
  if (code === "auth_required" || code === "auth_failed" || code === "rate_limited" || code === "auth_no_challenge") return "locked";
  if (code === "auth_not_configured") return "open";
  if (code === "credential_invalid") return "credentialInvalid";
  return null;
}

function dropsConnection(code: string): boolean {
  return code === "timeout" || code === "transport_error" || code === "protocol_error" || code === "bad_version";
}

function decodeSlotBytes(bytes: SlotBytes): string | null {
  if (bytes.length > MAX_TEXT_BYTES) return null;
  let text = "";
  for (const byte of bytes) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 0xff || !(byte >= 0x20 && byte <= 0x7e) && byte !== 0x08 && byte !== 0x09 && byte !== 0x0a) {
      return null;
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

function readLabels(device: ConnectedDevice | null): Record<number, string> {
  const key = deviceSummaryKey(device);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(`${LABELS_STORAGE_PREFIX}:${key}`);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const labels: Record<number, string> = {};
    for (const [slot, label] of Object.entries(parsed)) {
      const index = Number(slot);
      if (Number.isInteger(index) && index >= 0 && index <= 254 && typeof label === "string") labels[index] = label.slice(0, 64);
    }
    return labels;
  } catch {
    return {};
  }
}

function writeLabels(device: ConnectedDevice | null, labels: Record<number, string>): void {
  const key = deviceSummaryKey(device);
  if (!key) return;
  try {
    const safeLabels: Record<number, string> = {};
    for (const [slot, label] of Object.entries(labels)) safeLabels[Number(slot)] = label.slice(0, 64);
    localStorage.setItem(`${LABELS_STORAGE_PREFIX}:${key}`, JSON.stringify(safeLabels));
  } catch {
    // A local label is optional and is never sent to the device.
  }
}

function makeSlotState(metadata: SlotMetadata, labels: Record<number, string>, previous?: SlotState, preserveDirty = true): SlotState {
  if (previous && preserveDirty && isDirty(previous)) {
    return { ...previous, length: metadata.length, revealed: false, loading: false, error: null, lastAction: null };
  }
  const label = labels[metadata.slot] ?? previous?.savedLabel ?? "";
  return {
    slot: metadata.slot,
    length: metadata.length,
    savedText: "",
    draftText: "",
    savedLabel: label,
    draftLabel: label,
    loaded: metadata.length === 0,
    loading: false,
    revealed: false,
    status: "idle",
    error: null,
    lastAction: null,
    savedAt: previous?.savedAt ?? null,
  };
}

function platformForHost(): Platform {
  if (typeof navigator === "undefined") return "linux";
  const value = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (value.includes("mac")) return "macos";
  if (value.includes("win")) return "windows";
  return "linux";
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(readLanguagePreference);
  const locale = resolveLocale(languagePreference);
  const copy = getMessages(locale);
  const platform = useMemo(platformForHost, []);

  const [devices, setDevices] = useState<DeviceCandidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [connection, setConnection] = useState<ConnectionState>(disconnected);
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [inputError, setInputError] = useState<InputErrorKey | null>(null);
  const [clearConfirm, setClearConfirm] = useState<number | null>(null);
  const [switchConfirm, setSwitchConfirm] = useState<number | null>(null);
  const [deviceSwitchConfirm, setDeviceSwitchConfirm] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [passwordModalMode, setPasswordModalMode] = useState<"setup" | "change" | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsDraft>(() => readSettings());
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(() => readSettings());
  const [privacySettings, setPrivacySettings] = useState<PrivacyPreviewSettings>(() => readPrivacyPreviewSettings());
  const [privacyDraft, setPrivacyDraft] = useState<PrivacyPreviewSettings>(() => readPrivacyPreviewSettings());
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<SettingsError | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [lastOperation, setLastOperation] = useState<string | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [authRemainingSeconds, setAuthRemainingSeconds] = useState<number | null>(null);

  const mounted = useRef(false);
  const operation = useRef(0);
  const deviceKey = useRef<string | null>(null);
  const selectedSlotRef = useRef<number | null>(selectedSlot);
  const connectionRef = useRef<ConnectionState>(connection);
  const dirtyRef = useRef(false);
  const closeConfirmRef = useRef(false);
  const closingRef = useRef(false);
  const authDeadlineRef = useRef<number | null>(null);
  const authRefreshInFlightRef = useRef(false);
  const busyRef = useRef(false);
  const autoReconnectEnabledRef = useRef(false);
  const autoReconnectInFlightRef = useRef(false);
  const missingDevicePollsRef = useRef(0);
  selectedSlotRef.current = selectedSlot;
  connectionRef.current = connection;
  dirtyRef.current = slots.some(isDirty);
  busyRef.current = busy;

  const recordOperation = useCallback((name: string) => setLastOperation(name), []);

  const clearAuthDeadline = useCallback(() => {
    authDeadlineRef.current = null;
    setAuthRemainingSeconds(null);
  }, []);

  const markAuthenticatedActivity = useCallback((authenticated = connectionRef.current.authState === "authenticated") => {
    if (!authenticated) return;
    const deadline = Date.now() + AUTH_SESSION_TIMEOUT_MS;
    authDeadlineRef.current = deadline;
    setAuthRemainingSeconds(Math.ceil(AUTH_SESSION_TIMEOUT_MS / 1_000));
  }, []);

  const commandError = useCallback((caught: unknown): CommandError => {
    const error = asCommandError(caught);
    setLastErrorCode(error.code);
    setErrorCode(error.code);
    return error;
  }, []);

  const hideRevealed = useCallback(() => {
    setSlots((previous) => previous.map((slot) => slot.revealed ? { ...slot, revealed: false } : slot));
  }, []);

  const applyErrorState = useCallback((error: CommandError) => {
    const nextAuthState = authStateForErrorCode(error.code);
    if (nextAuthState) {
      setConnection((current) => current.connected ? { ...current, authState: nextAuthState } : current);
      clearAuthDeadline();
      hideRevealed();
    } else if (dropsConnection(error.code)) {
      setConnection(disconnected);
      clearAuthDeadline();
      hideRevealed();
      autoReconnectEnabledRef.current = error.code !== "bad_version";
      missingDevicePollsRef.current = 0;
    }
  }, [clearAuthDeadline, hideRevealed]);

  const mergeSlotMetadata = useCallback((metadata: SlotMetadata[], nextLabels: Record<number, string>, preserveDirty: boolean) => {
    setSlots((previous) => metadata.map((item) => makeSlotState(item, nextLabels, previous.find((slot) => slot.slot === item.slot), preserveDirty)));
    setSelectedSlot((current) => current !== null && metadata.some((item) => item.slot === current) ? current : metadata[0]?.slot ?? null);
    setClearConfirm(null);
  }, []);

  const loadSlots = useCallback(async (sequence: number, nextLabels: Record<number, string>, preserveDirty: boolean): Promise<boolean> => {
    recordOperation("LIST");
    const metadata = await listSlots();
    if (!mounted.current || operation.current !== sequence) return false;
    mergeSlotMetadata(metadata, nextLabels, preserveDirty);
    markAuthenticatedActivity();
    return true;
  }, [markAuthenticatedActivity, mergeSlotMetadata, recordOperation]);

  const refreshDevices = useCallback(async () => {
    const sequence = ++operation.current;
    setChecking(true);
    setBusy(true);
    setRefreshing(true);
    setErrorCode(null);
    recordOperation("Discover");
    try {
      const [nextDevices, nextConnection] = await Promise.all([listDevices(), getConnection()]);
      if (!mounted.current || operation.current !== sequence) return;
      const priorConnected = connectionRef.current.connected;
      setDevices(nextDevices);
      setConnection(nextConnection);
      // A disconnected status carries no device object. Keep the last safe summary
      // key so a later connection to that device can restore in-memory drafts.
      const nextKey = nextConnection.connected ? deviceSummaryKey(nextConnection.device) : null;
      const recoveryKey = nextKey ?? deviceKey.current;
      const preserveDirty = nextKey !== null && nextKey === deviceKey.current;
      if (nextConnection.connected && nextKey !== null) {
        if (!preserveDirty) {
          setSlots([]);
          setSelectedSlot(null);
        }
        deviceKey.current = nextKey;
        autoReconnectEnabledRef.current = false;
        missingDevicePollsRef.current = 0;
      } else if (priorConnected && !nextConnection.connected) {
        autoReconnectEnabledRef.current = true;
        missingDevicePollsRef.current = 0;
      }
      const nextLabels = readLabels(nextConnection.device);
      setLabels(nextLabels);
      setSelectedId((current) => {
        if (current && nextDevices.some((device) => device.id === current)) return current;
        const matching = nextDevices.find((device) => deviceSummaryKey(device) === recoveryKey);
        return matching?.id ?? nextDevices[0]?.id ?? "";
      });
      if (nextConnection.connected && canManage(nextConnection)) {
        if (nextConnection.authState === "authenticated" && authDeadlineRef.current === null) {
          markAuthenticatedActivity(true);
        }
        await loadSlots(sequence, nextLabels, preserveDirty);
        if (nextConnection.authState === "open" && !priorConnected) setSetupOpen(true);
      } else {
        clearAuthDeadline();
        hideRevealed();
      }
      if (!nextConnection.connected && nextDevices.length === 0) {
        setLastErrorCode("no_device");
        setErrorCode("no_device");
      }
    } catch (caught) {
      if (mounted.current && operation.current === sequence) {
        const error = commandError(caught);
        applyErrorState(error);
      }
    } finally {
      if (mounted.current && operation.current === sequence) {
        setChecking(false);
        setBusy(false);
        setRefreshing(false);
      }
    }
  }, [applyErrorState, clearAuthDeadline, commandError, hideRevealed, loadSlots, markAuthenticatedActivity, recordOperation]);

  const connectDevice = useCallback(async (id: string, automaticReconnect = false) => {
    const sequence = ++operation.current;
    autoReconnectEnabledRef.current = automaticReconnect;
    clearAuthDeadline();
    setSelectedId(id);
    setChecking(true);
    setBusy(true);
    setErrorCode(null);
    setClearConfirm(null);
    setSwitchConfirm(null);
    setDeviceSwitchConfirm(null);
    setSetupOpen(false);
    setPasswordModalMode(null);
    setConnection(disconnected);
    hideRevealed();
    recordOperation("Connect");
    try {
      const nextConnection = await connectDeviceCommand(id);
      if (!mounted.current || operation.current !== sequence) return;
      const nextKey = nextConnection.connected ? deviceSummaryKey(nextConnection.device) : null;
      const preserveDirty = nextKey !== null && nextKey === deviceKey.current;
      // Do not discard drafts until the replacement connection succeeds and its
      // safe summary is known to differ from the retained device.
      if (nextConnection.connected && nextKey !== null) {
        if (!preserveDirty) {
          setSlots([]);
          setSelectedSlot(null);
        }
        deviceKey.current = nextKey;
        autoReconnectEnabledRef.current = false;
        missingDevicePollsRef.current = 0;
      }
      const nextLabels = readLabels(nextConnection.device);
      setLabels(nextLabels);
      setConnection(nextConnection);
      markAuthenticatedActivity(nextConnection.authState === "authenticated");
      if (canManage(nextConnection)) {
        const listed = await loadSlots(sequence, nextLabels, preserveDirty);
        if (listed && nextConnection.authState === "open") setSetupOpen(true);
      }
    } catch (caught) {
      if (mounted.current && operation.current === sequence) {
        const error = commandError(caught);
        setConnection(disconnected);
        hideRevealed();
        autoReconnectEnabledRef.current = automaticReconnect && error.code !== "bad_version";
        if (error.code === "bad_version") setErrorCode("bad_version");
      }
    } finally {
      if (mounted.current && operation.current === sequence) {
        setChecking(false);
        setBusy(false);
      }
    }
  }, [clearAuthDeadline, commandError, hideRevealed, loadSlots, markAuthenticatedActivity, recordOperation]);

  const requestDeviceConnect = useCallback((id: string) => {
    const candidate = devices.find((item) => item.id === id);
    const candidateKey = deviceSummaryKey(candidate ?? null);
    if (dirtyRef.current && candidateKey !== deviceKey.current) {
      setDeviceSwitchConfirm(id);
      return;
    }
    void connectDevice(id);
  }, [connectDevice, devices]);

  const disconnectDevice = useCallback(async () => {
    const sequence = ++operation.current;
    autoReconnectEnabledRef.current = false;
    missingDevicePollsRef.current = 0;
    setBusy(true);
    setErrorCode(null);
    setSetupOpen(false);
    setPasswordModalMode(null);
    recordOperation("Disconnect");
    try {
      await disconnectDeviceCommand();
      if (!mounted.current || operation.current !== sequence) return;
      setConnection(disconnected);
      clearAuthDeadline();
      setSelectedId("");
      setClearConfirm(null);
      setSwitchConfirm(null);
      setDeviceSwitchConfirm(null);
      hideRevealed();
    } catch (caught) {
      if (mounted.current && operation.current === sequence) commandError(caught);
    } finally {
      if (mounted.current && operation.current === sequence) setBusy(false);
    }
  }, [clearAuthDeadline, commandError, hideRevealed, recordOperation]);

  const pollDeviceConnection = useCallback(async () => {
    const knownKey = deviceKey.current;
    if (!mounted.current || !knownKey || busyRef.current || autoReconnectInFlightRef.current) return;
    if (!connectionRef.current.connected && !autoReconnectEnabledRef.current) return;
    autoReconnectInFlightRef.current = true;
    try {
      const candidates = await listDevices();
      if (!mounted.current || deviceKey.current !== knownKey) return;
      setDevices(candidates);
      const matches = matchingCandidates(candidates, knownKey);
      if (connectionRef.current.connected) {
        if (matches.length === 0) {
          missingDevicePollsRef.current += 1;
          if (missingDevicePollsRef.current < AUTO_RECONNECT_MISSED_POLLS) return;
          const sequence = ++operation.current;
          await disconnectDeviceCommand().catch(() => undefined);
          if (!mounted.current || operation.current !== sequence || deviceKey.current !== knownKey) return;
          setConnection(disconnected);
          clearAuthDeadline();
          hideRevealed();
          autoReconnectEnabledRef.current = true;
          missingDevicePollsRef.current = 0;
        } else {
          missingDevicePollsRef.current = 0;
        }
        return;
      }
      missingDevicePollsRef.current = 0;
      if (!autoReconnectEnabledRef.current || matches.length !== 1) return;
      await connectDevice(matches[0].id, true);
    } catch {
      // Discovery is a background recovery probe. Keep the current UI and draft
      // intact on a transient enumeration failure; the next poll retries it.
    } finally {
      autoReconnectInFlightRef.current = false;
    }
  }, [clearAuthDeadline, connectDevice, hideRevealed]);

  useEffect(() => {
    if (!inTauri()) return undefined;
    const timer = window.setInterval(() => { void pollDeviceConnection(); }, AUTO_RECONNECT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [pollDeviceConnection]);

  const expireAuthSession = useCallback(() => {
    if (!connectionRef.current.connected || connectionRef.current.authState !== "authenticated" || authRefreshInFlightRef.current || busyRef.current) return;
    const sequence = ++operation.current;
    authRefreshInFlightRef.current = true;
    authDeadlineRef.current = null;
    setAuthRemainingSeconds(0);
    setConnection((current) => current.connected ? { ...current, authState: "locked" } : current);
    setErrorCode("auth_expired");
    hideRevealed();
    void refreshAuthStateCommand()
      .then((nextAuthState) => {
        if (!mounted.current || operation.current !== sequence || !connectionRef.current.connected) return;
        if (nextAuthState === "authenticated") {
          setConnection((current) => current.connected ? { ...current, authState: nextAuthState } : current);
          setErrorCode(null);
          markAuthenticatedActivity(true);
        } else {
          setConnection((current) => current.connected ? { ...current, authState: nextAuthState } : current);
          clearAuthDeadline();
          hideRevealed();
        }
      })
      .catch((caught) => {
        if (!mounted.current || operation.current !== sequence) return;
        const error = commandError(caught);
        applyErrorState(error);
      })
      .finally(() => {
        authRefreshInFlightRef.current = false;
      });
  }, [applyErrorState, clearAuthDeadline, commandError, hideRevealed, markAuthenticatedActivity]);

  useEffect(() => {
    if (!connection.connected || connection.authState !== "authenticated") {
      if (authDeadlineRef.current !== null) clearAuthDeadline();
      return undefined;
    }
    if (authDeadlineRef.current === null) markAuthenticatedActivity(true);
    const tick = () => {
      const deadline = authDeadlineRef.current;
      if (deadline === null) return;
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
      setAuthRemainingSeconds(remaining);
      if (remaining === 0) expireAuthSession();
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [clearAuthDeadline, connection.authState, connection.connected, expireAuthSession, markAuthenticatedActivity]);

  useEffect(() => {
    if (!connection.connected || connection.authState !== "authenticated" || !inTauri()) return undefined;
    const poll = () => {
      if (busyRef.current || authRefreshInFlightRef.current) return;
      const sequence = ++operation.current;
      authRefreshInFlightRef.current = true;
      void refreshAuthStateCommand()
        .then((nextAuthState) => {
          if (!mounted.current || operation.current !== sequence || !connectionRef.current.connected) return;
          if (nextAuthState === "authenticated") {
            if (authDeadlineRef.current === null) markAuthenticatedActivity(true);
            return;
          }
          setConnection((current) => current.connected ? { ...current, authState: nextAuthState } : current);
          clearAuthDeadline();
          hideRevealed();
          setErrorCode(nextAuthState === "locked" ? "auth_required" : null);
        })
        .catch((caught) => {
          if (!mounted.current || operation.current !== sequence) return;
          const error = commandError(caught);
          applyErrorState(error);
        })
        .finally(() => {
          authRefreshInFlightRef.current = false;
        });
    };
    const timer = window.setInterval(poll, AUTH_SESSION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [applyErrorState, clearAuthDeadline, commandError, connection.authState, connection.connected, hideRevealed, markAuthenticatedActivity]);

  const refreshSlots = useCallback(async () => {
    if (!canManage(connectionRef.current)) return;
    const sequence = ++operation.current;
    setBusy(true);
    setRefreshing(true);
    setErrorCode(null);
    try {
      const loaded = await loadSlots(sequence, labels, true);
      if (loaded && mounted.current && operation.current === sequence) hideRevealed();
    } catch (caught) {
      if (mounted.current && operation.current === sequence) {
        const error = commandError(caught);
        applyErrorState(error);
      }
    } finally {
      if (mounted.current && operation.current === sequence) {
        setBusy(false);
        setRefreshing(false);
      }
    }
  }, [applyErrorState, commandError, hideRevealed, labels, loadSlots]);

  const loadSlotContent = useCallback(async (slotNumber: number) => {
    if (!canManage(connectionRef.current)) return;
    const sequence = ++operation.current;
    setBusy(true);
    setInputError(null);
    setSlots((previous) => previous.map((slot) => slot.slot === slotNumber ? { ...slot, loading: true, error: null, lastAction: null } : slot));
    recordOperation("GET");
    try {
      const bytes = await getSlot(slotNumber);
      const text = decodeSlotBytes(bytes);
      if (text === null) {
        const error: CommandError = { code: "invalid_text", message: "" };
        setLastErrorCode(error.code);
        setErrorCode(error.code);
        throw error;
      }
      if (!mounted.current || operation.current !== sequence || selectedSlotRef.current !== slotNumber) return;
      setErrorCode(null);
      markAuthenticatedActivity();
      setSlots((previous) => previous.map((slot) => slot.slot === slotNumber ? { ...slot, length: bytes.length, savedText: text, draftText: text, loaded: true, loading: false, revealed: false, status: "idle", error: null, lastAction: null, savedAt: slot.savedAt } : slot));
    } catch (caught) {
      if (mounted.current && operation.current === sequence) {
        const error = caught && typeof caught === "object" && "code" in caught ? caught as CommandError : commandError(caught);
        if (error.code !== "invalid_text") commandError(caught);
        applyErrorState(error);
        setSlots((previous) => previous.map((slot) => slot.slot === slotNumber ? { ...slot, loading: false, revealed: false, status: "error", error, lastAction: "load" } : slot));
      }
    } finally {
      if (mounted.current && operation.current === sequence) setBusy(false);
    }
  }, [applyErrorState, commandError, markAuthenticatedActivity, recordOperation]);

  useEffect(() => {
    if (!canManage(connection) || selectedSlot === null) return;
    const selected = slots.find((slot) => slot.slot === selectedSlot);
    if (!selected || selected.loaded || selected.loading || selected.error) return;
    if (selected.length === 0) {
      setSlots((previous) => previous.map((slot) => slot.slot === selectedSlot ? { ...slot, loaded: true } : slot));
      return;
    }
    void loadSlotContent(selectedSlot);
  }, [connection, loadSlotContent, selectedSlot, slots]);

  const selectSlotImmediately = useCallback((slotNumber: number) => {
    operation.current += 1;
    setSelectedSlot(slotNumber);
    setClearConfirm(null);
    setSwitchConfirm(null);
    setInputError(null);
    hideRevealed();
  }, [hideRevealed]);

  const selectSlot = useCallback((slotNumber: number) => {
    if (busy || selectedSlot === slotNumber) return;
    const current = slots.find((slot) => slot.slot === selectedSlot);
    if (current && isDirty(current)) {
      setSwitchConfirm(slotNumber);
      return;
    }
    selectSlotImmediately(slotNumber);
  }, [busy, selectSlotImmediately, selectedSlot, slots]);

  const updateLabel = useCallback((value: string) => {
    if (selectedSlot === null) return;
    setSlots((previous) => previous.map((slot) => slot.slot === selectedSlot ? { ...slot, draftLabel: value.slice(0, 64), status: "idle", error: null, lastAction: null } : slot));
  }, [selectedSlot]);

  const appendText = useCallback((value: string) => {
    if (selectedSlot === null || !canManage(connectionRef.current)) return;
    const selected = slots.find((slot) => slot.slot === selectedSlot);
    if (!selected?.loaded) return;
    if (macroBytes(selected.draftText + value) > MAX_TEXT_BYTES) {
      setInputError("textTooLong");
      return;
    }
    setInputError(null);
    setSlots((previous) => previous.map((slot) => slot.slot === selectedSlot ? { ...slot, draftText: slot.draftText + value, status: "idle", error: null, lastAction: null } : slot));
  }, [selectedSlot, slots]);

  const appendKey = useCallback((kind: "char" | "control", label: string) => {
    if (kind === "char") {
      appendText(label);
      return;
    }
    const control = label === "LF" ? "\n" : label === "Tab" ? "\t" : "\b";
    appendText(control);
  }, [appendText]);

  const removeToken = useCallback((index: number) => {
    if (selectedSlot === null) return;
    const selected = slots.find((slot) => slot.slot === selectedSlot);
    if (!selected?.loaded) return;
    const tokens = tokensFromText(selected.draftText);
    if (index < 0 || index >= tokens.length) return;
    tokens.splice(index, 1);
    setSlots((previous) => previous.map((slot) => slot.slot === selectedSlot ? { ...slot, draftText: textFromTokens(tokens), status: "idle", error: null, lastAction: null } : slot));
    setInputError(null);
  }, [selectedSlot, slots]);

  const moveToken = useCallback((index: number, offset: number) => {
    if (selectedSlot === null) return;
    const selected = slots.find((slot) => slot.slot === selectedSlot);
    if (!selected?.loaded) return;
    const tokens = tokensFromText(selected.draftText);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= tokens.length) return;
    const [token] = tokens.splice(index, 1);
    tokens.splice(target, 0, token);
    setSlots((previous) => previous.map((slot) => slot.slot === selectedSlot ? { ...slot, draftText: textFromTokens(tokens), status: "idle", error: null, lastAction: null } : slot));
  }, [selectedSlot, slots]);

  const toggleReveal = useCallback(() => {
    if (selectedSlot === null || !canManage(connectionRef.current)) return;
    setInputError(null);
    setSlots((previous) => previous.map((slot) => slot.slot === selectedSlot && slot.loaded ? { ...slot, revealed: !slot.revealed } : slot));
  }, [selectedSlot]);

  const addMacro = useCallback(() => {
    if (selectedSlot === null || !canManage(connectionRef.current)) return;
    setInputError(null);
    setSlots((previous) => previous.map((slot) => slot.slot === selectedSlot && slot.loaded ? { ...slot, revealed: true } : slot));
  }, [selectedSlot]);

  const saveSlot = useCallback(async () => {
    if (selectedSlot === null || busy || !canManage(connectionRef.current)) return;
    const selected = slots.find((slot) => slot.slot === selectedSlot);
    if (!selected || !selected.loaded || !isDirty(selected)) return;
    const sequence = ++operation.current;
    setBusy(true);
    setClearConfirm(null);
    setSlots((previous) => previous.map((slot) => slot.slot === selectedSlot ? { ...slot, status: "saving", error: null, lastAction: null } : slot));
    try {
      if (selected.draftText !== selected.savedText) {
        recordOperation("SET");
        await setSlotCommand(selected.slot, selected.draftText);
      }
      if (!mounted.current || operation.current !== sequence) return;
      setErrorCode(null);
      markAuthenticatedActivity();
      const nextLabels = { ...labels, [selected.slot]: selected.draftLabel };
      writeLabels(connectionRef.current.device, nextLabels);
      setLabels(nextLabels);
      const now = new Date().toISOString();
      setSlots((previous) => previous.map((slot) => slot.slot === selected.slot ? { ...slot, length: macroBytes(selected.draftText), savedText: selected.draftText, savedLabel: selected.draftLabel, status: "saved", error: null, lastAction: null, savedAt: now } : slot));
      window.setTimeout(() => {
        if (mounted.current) setSlots((previous) => previous.map((slot) => slot.slot === selected.slot && slot.status === "saved" ? { ...slot, status: "idle" } : slot));
      }, 2_000);
    } catch (caught) {
      if (mounted.current && operation.current === sequence) {
        const error = commandError(caught);
        applyErrorState(error);
        setSlots((previous) => previous.map((slot) => slot.slot === selected.slot ? { ...slot, revealed: false, status: "error", error, lastAction: "save" } : slot));
      }
    } finally {
      if (mounted.current && operation.current === sequence) setBusy(false);
    }
  }, [applyErrorState, busy, commandError, labels, markAuthenticatedActivity, recordOperation, selectedSlot, slots]);

  const requestClear = useCallback(() => {
    if (selectedSlot !== null) setClearConfirm(selectedSlot);
  }, [selectedSlot]);

  const clearSlot = useCallback(async () => {
    if (selectedSlot === null || busy || !canManage(connectionRef.current)) return;
    const selected = slots.find((slot) => slot.slot === selectedSlot);
    if (!selected || !selected.loaded || macroBytes(selected.draftText) === 0) return;
    const sequence = ++operation.current;
    setBusy(true);
    setClearConfirm(null);
    setSlots((previous) => previous.map((slot) => slot.slot === selected.slot ? { ...slot, status: "saving", error: null, lastAction: null } : slot));
    try {
      recordOperation("CLEAR");
      await clearSlotCommand(selected.slot);
      if (!mounted.current || operation.current !== sequence) return;
      const now = new Date().toISOString();
      setErrorCode(null);
      markAuthenticatedActivity();
      setSlots((previous) => previous.map((slot) => slot.slot === selected.slot ? { ...slot, length: 0, savedText: "", draftText: "", loaded: true, revealed: false, status: "saved", error: null, lastAction: null, savedAt: now } : slot));
      window.setTimeout(() => {
        if (mounted.current) setSlots((previous) => previous.map((slot) => slot.slot === selected.slot && slot.status === "saved" ? { ...slot, status: "idle" } : slot));
      }, 2_000);
    } catch (caught) {
      if (mounted.current && operation.current === sequence) {
        const error = commandError(caught);
        applyErrorState(error);
        setSlots((previous) => previous.map((slot) => slot.slot === selected.slot ? { ...slot, revealed: false, status: "error", error, lastAction: "clear" } : slot));
      }
    } finally {
      if (mounted.current && operation.current === sequence) setBusy(false);
    }
  }, [applyErrorState, busy, commandError, markAuthenticatedActivity, recordOperation, selectedSlot, slots]);

  const retrySelected = useCallback(() => {
    const selected = slots.find((slot) => slot.slot === selectedSlot);
    if (!selected) return;
    const action: SlotAction | null = selected.lastAction;
    if (action === "load") void loadSlotContent(selected.slot);
    else if (action === "save") void saveSlot();
    else if (action === "clear") setClearConfirm(selected.slot);
  }, [loadSlotContent, saveSlot, selectedSlot, slots]);

  const authenticateDevice = useCallback(async (password: string): Promise<CommandError | null> => {
    if (!connectionRef.current.connected) return { code: "not_connected", message: "" };
    const sequence = ++operation.current;
    setBusy(true);
    setErrorCode(null);
    recordOperation("AUTH");
    try {
      const nextAuthState = await authenticate(password);
      if (!mounted.current) return null;
      setConnection((current) => current.connected ? { ...current, authState: nextAuthState } : current);
      if (nextAuthState === "authenticated") {
        markAuthenticatedActivity(true);
        await loadSlots(sequence, labels, true);
      } else {
        clearAuthDeadline();
        hideRevealed();
      }
      return null;
    } catch (caught) {
      const error = commandError(caught);
      applyErrorState(error);
      return error;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [applyErrorState, clearAuthDeadline, commandError, hideRevealed, labels, loadSlots, markAuthenticatedActivity, recordOperation]);

  const setPassword = useCallback(async (password: string): Promise<CommandError | null> => {
    if (!connectionRef.current.connected) return { code: "not_connected", message: "" };
    setBusy(true);
    setErrorCode(null);
    recordOperation("PASSWORD_SET");
    try {
      const nextAuthState = await setPasswordCommand(password);
      if (!mounted.current) return null;
      setConnection((current) => current.connected ? { ...current, authState: nextAuthState } : current);
      clearAuthDeadline();
      hideRevealed();
      setSetupOpen(false);
      setPasswordModalMode(null);
      return null;
    } catch (caught) {
      const error = commandError(caught);
      applyErrorState(error);
      return error;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [applyErrorState, clearAuthDeadline, commandError, hideRevealed, recordOperation]);

  const lockManagement = useCallback(async () => {
    if (!connectionRef.current.connected || connectionRef.current.authState !== "authenticated" || busy) return;
    setBusy(true);
    setErrorCode(null);
    recordOperation("LOCK");
    hideRevealed();
    try {
      const nextAuthState = await lockDevice();
      if (!mounted.current) return;
      setConnection((current) => current.connected ? { ...current, authState: nextAuthState } : current);
      clearAuthDeadline();
    } catch (caught) {
      const error = commandError(caught);
      applyErrorState(error);
      setConnection((current) => current.connected ? { ...current, authState: error.code === "credential_invalid" ? "credentialInvalid" : "locked" } : current);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [applyErrorState, busy, clearAuthDeadline, commandError, hideRevealed, recordOperation]);

  const saveSettings = useCallback(async () => {
    if (!Number.isInteger(settingsDraft.timeoutMs) || settingsDraft.timeoutMs < MIN_TIMEOUT_MS || settingsDraft.timeoutMs > MAX_TIMEOUT_MS) {
      setSettingsError("timeout");
      return;
    }
    if (!Number.isInteger(settingsDraft.retries) || settingsDraft.retries < 0 || settingsDraft.retries > MAX_RETRIES) {
      setSettingsError("retries");
      return;
    }
    setSettingsBusy(true);
    setSettingsError(null);
    setSettingsSaved(false);
    recordOperation("Settings");
    try {
      const nextSettings = await setSettingsCommand(settingsDraft.timeoutMs, settingsDraft.retries);
      const nextPrivacy = {
        previewCharacterCount: clampInteger(privacyDraft.previewCharacterCount, MIN_PREVIEW_CHARACTER_COUNT, MAX_PREVIEW_CHARACTER_COUNT, DEFAULT_PRIVACY_PREVIEW_SETTINGS.previewCharacterCount),
        hoverRevealDelay: clampInteger(privacyDraft.hoverRevealDelay, MIN_HOVER_REVEAL_DELAY, MAX_HOVER_REVEAL_DELAY, DEFAULT_PRIVACY_PREVIEW_SETTINGS.hoverRevealDelay),
      };
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);
      writeSettings(nextSettings);
      setPrivacySettings(nextPrivacy);
      setPrivacyDraft(nextPrivacy);
      writePrivacyPreviewSettings(nextPrivacy);
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 2_000);
    } catch (caught) {
      setSettingsError(commandError(caught));
    } finally {
      setSettingsBusy(false);
    }
  }, [commandError, privacyDraft, recordOperation, settingsDraft]);

  const updateTheme = useCallback((nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    try { localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch { /* optional preference */ }
  }, []);

  const updateLanguage = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (!isLanguagePreference(next)) return;
    setLanguagePreference(next);
    writeLanguagePreference(next);
  }, []);

  const cancelClose = useCallback(() => {
    closeConfirmRef.current = false;
    setCloseConfirmOpen(false);
  }, []);

  const closeWindowWithBestEffortLock = useCallback(() => {
    if (!inTauri() || closingRef.current) return;
    closingRef.current = true;
    const windowHandle = getCurrentWindow();
    const lockAttempt = disconnectDeviceCommand().catch(() => undefined);
    const closeDeadline = new Promise<void>((resolve) => { window.setTimeout(resolve, 250); });
    void Promise.race([lockAttempt, closeDeadline])
      .then(() => windowHandle.destroy())
      .catch(() => {
        closingRef.current = false;
        if (mounted.current) {
          closeConfirmRef.current = true;
          setCloseConfirmOpen(true);
        }
      });
  }, []);

  const closeWithoutSaving = useCallback(() => {
    closeConfirmRef.current = false;
    setCloseConfirmOpen(false);
    closeWindowWithBestEffortLock();
  }, [closeWindowWithBestEffortLock]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = locale;
    return () => { delete document.documentElement.dataset.theme; document.documentElement.lang = ""; };
  }, [locale, theme]);

  useEffect(() => {
    mounted.current = true;
    void refreshDevices();
    void getSettings().then((backend) => {
      if (!mounted.current) return;
      setSettings(backend);
      setSettingsDraft(backend);
      writeSettings(backend);
    }).catch((caught) => {
      if (mounted.current) setSettingsError(commandError(caught));
    });
    return () => {
      mounted.current = false;
    };
  }, [commandError, refreshDevices]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    if (!inTauri()) {
      window.addEventListener("beforeunload", beforeUnload);
      return () => window.removeEventListener("beforeunload", beforeUnload);
    }
    let active = true;
    let unlisten: (() => void) | undefined;
    try {
      void getCurrentWindow().onCloseRequested((event) => {
        if (closingRef.current) return;
        event.preventDefault();
        if (dirtyRef.current && !closeConfirmRef.current) {
          closeConfirmRef.current = true;
          setCloseConfirmOpen(true);
          return;
        }
        closeWindowWithBestEffortLock();
      }).then((stopListening) => {
        if (active) unlisten = stopListening;
        else stopListening();
      }).catch(() => {
        if (active) window.addEventListener("beforeunload", beforeUnload);
      });
    } catch {
      window.addEventListener("beforeunload", beforeUnload);
    }
    return () => {
      active = false;
      unlisten?.();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [closeWindowWithBestEffortLock]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s" || !connectionRef.current.connected) return;
      const selected = slots.find((slot) => slot.slot === selectedSlotRef.current);
      if (!selected || !isDirty(selected)) return;
      event.preventDefault();
      void saveSlot();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveSlot, slots]);

  const route = !connection.connected ? "select" : connection.authState === "locked" || connection.authState === "credentialInvalid" ? "unlock" : canManage(connection) ? "workbench" : "select";
  const selectedDevice = devices.find((device) => device.id === selectedId);
  const currentCandidateId = devices.find((device) => deviceSummaryKey(device) === deviceSummaryKey(connection.device))?.id;
  const deviceName = connection.device?.productName || copy.unnamedDevice;
  const configuredBytes = slots.reduce((total, slot) => total + slot.length, 0);
  const translatedError = errorCode ? translateCommandError(errorCode, locale) : null;
  const selectedInputError = inputError ? translateInputError(inputError, locale) : null;
  const settingsErrorMessage = settingsError ? typeof settingsError === "string" ? translateSettingsValidation(settingsError, locale, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, MAX_RETRIES) : translateCommandError(settingsError.code, locale) : null;
  const statusLabel = checking ? copy.statusChecking : connection.authState === "authenticated" ? copy.statusAuthenticated : copy.statusConnected;

  return (
    <>
      {route === "select" ? (
        <DeviceSelect
          copy={copy}
          platform={platform}
          devices={devices}
          selectedId={selectedDevice ? selectedDevice.id : selectedId}
          checking={checking}
          busy={busy}
          errorMessage={translatedError}
          errorCode={errorCode}
          dirtyDraft={slots.some(isDirty)}
          onSelect={setSelectedId}
          onConnect={() => { if (selectedId) requestDeviceConnect(selectedId); }}
          onRefresh={() => void refreshDevices()}
        />
      ) : null}

      {route === "unlock" && connection.device ? (
        <Unlock
          copy={copy}
          locale={locale}
          platform={platform}
          device={connection.device}
          credentialInvalid={connection.authState === "credentialInvalid"}
          busy={busy}
          externalErrorCode={errorCode}
          onBack={() => { void disconnectDevice(); }}
          onUnlock={authenticateDevice}
        />
      ) : null}

      {route === "workbench" && connection.device ? (
        <MacroWorkbench
          copy={copy}
          platform={platform}
          theme={theme}
          device={connection.device}
          devices={devices}
          currentCandidateId={currentCandidateId}
          deviceName={deviceName}
          interfaceLabel={copy.interfaceNumber(connection.device.interfaceNumber)}
          interfaceNumberLabel={copy.interfaceNumber}
          connectionStatusLabel={statusLabel}
          authRemainingSeconds={authRemainingSeconds}
          protectedAuthenticated={connection.authState === "authenticated"}
          isOpen={connection.authState === "open"}
          slots={slots}
          selectedSlot={selectedSlot}
          busy={busy}
          refreshing={refreshing}
          clearPending={clearConfirm}
          errorMessage={translatedError}
          inputErrorMessage={selectedInputError}
          lastOperation={lastOperation}
          lastErrorCode={lastErrorCode}
          configuredBytes={configuredBytes}
          previewCharacterCount={privacySettings.previewCharacterCount}
          hoverRevealDelay={privacySettings.hoverRevealDelay}
          onThemeChange={updateTheme}
          onRefresh={() => void refreshSlots()}
          onRefreshDevices={() => void refreshDevices()}
          onSettings={() => { setSettingsDraft(settings); setPrivacyDraft(privacySettings); setSettingsError(null); setSettingsOpen(true); }}
          onDiagnostics={() => setDiagnosticsOpen((value) => !value)}
          onSetPassword={() => { setPasswordModalMode("setup"); setErrorCode(null); }}
          onChangePassword={() => { setPasswordModalMode("change"); setErrorCode(null); }}
          onLock={() => void lockManagement()}
          onSwitchDevice={requestDeviceConnect}
          onDisconnect={() => void disconnectDevice()}
          onSelectSlot={selectSlot}
          onMoveSelection={(offset) => {
            const index = slots.findIndex((slot) => slot.slot === selectedSlot);
            const next = slots[Math.max(0, Math.min(slots.length - 1, index + offset))];
            if (next) selectSlot(next.slot);
          }}
          onLabelChange={updateLabel}
          onRevealToggle={toggleReveal}
          onAdd={addMacro}
          onInsertText={appendText}
          onInsertKey={appendKey}
          onRemoveToken={removeToken}
          onMoveToken={moveToken}
          onClearRequest={requestClear}
          onClearConfirm={() => void clearSlot()}
          onClearCancel={() => setClearConfirm(null)}
          onSave={() => void saveSlot()}
          onRevert={() => {
            if (selectedSlot === null) return;
            setSlots((previous) => previous.map((slot) => slot.slot === selectedSlot ? { ...slot, draftText: slot.savedText, draftLabel: slot.savedLabel, revealed: false, status: "idle", error: null, lastAction: null } : slot));
            setInputError(null);
          }}
          onRetry={retrySelected}
          onCloseDiagnostics={() => setDiagnosticsOpen(false)}
          diagnosticsOpen={diagnosticsOpen}
        />
      ) : null}

      {route === "workbench" && (setupOpen || passwordModalMode === "setup") ? (
        <PasswordSetupModal
          copy={copy}
          locale={locale}
          mode="setup"
          busy={busy}
          externalErrorCode={errorCode}
          onSkip={() => { setSetupOpen(false); setPasswordModalMode(null); setErrorCode(null); }}
          onClose={() => { setSetupOpen(false); setPasswordModalMode(null); setErrorCode(null); }}
          onSubmit={setPassword}
        />
      ) : null}

      {route === "workbench" && passwordModalMode === "change" ? (
        <PasswordSetupModal
          copy={copy}
          locale={locale}
          mode="change"
          busy={busy}
          externalErrorCode={errorCode}
          onClose={() => { setPasswordModalMode(null); setErrorCode(null); }}
          onSubmit={setPassword}
        />
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 px-6 py-8 backdrop-blur-[2px]" role="presentation">
          <section className="w-full max-w-[560px] rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/15" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="flex items-start justify-between gap-4">
              <div><p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{copy.preferences}</p><h2 id="settings-title" className="mt-1 text-xl font-semibold text-ink">{copy.settings}</h2></div>
              <button type="button" onClick={() => setSettingsOpen(false)} disabled={settingsBusy} aria-label={copy.close} className="grid h-9 w-9 place-items-center rounded-lg text-ink-subtle hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            <div className="mt-6 space-y-5">
              <label className="block" htmlFor="language-setting"><span className="text-sm font-medium text-ink">{copy.language}</span><select id="language-setting" className="mt-2.5 h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-sm text-ink" value={languagePreference} onChange={updateLanguage} disabled={settingsBusy}><option value="system">{copy.languageFollowSystem}</option><option value="zh-CN">{copy.languageChinese}</option><option value="en">{copy.languageEnglish}</option></select><small className="mt-1.5 block text-xs text-ink-subtle">{copy.languageHelp}</small></label>
              <label className="block" htmlFor="theme-setting"><span className="text-sm font-medium text-ink">{copy.theme}</span><select id="theme-setting" className="mt-2.5 h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-sm text-ink" value={theme} onChange={(event) => updateTheme(event.target.value as ThemeMode)} disabled={settingsBusy}><option value="system">{copy.themeSystem}</option><option value="light">{copy.themeLight}</option><option value="dark">{copy.themeDark}</option></select></label>
              <div className="grid grid-cols-2 gap-4">
                <label className="block" htmlFor="timeout-setting"><span className="text-sm font-medium text-ink">{copy.requestTimeout}</span><input id="timeout-setting" className="mt-2.5 h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-mono text-sm text-ink" type="number" min={MIN_TIMEOUT_MS} max={MAX_TIMEOUT_MS} step={1} value={Number.isNaN(settingsDraft.timeoutMs) ? "" : settingsDraft.timeoutMs} onChange={(event) => { setSettingsDraft((value) => ({ ...value, timeoutMs: Number(event.target.value) })); setSettingsError(null); }} disabled={settingsBusy} /><small className="mt-1.5 block text-xs text-ink-subtle">{copy.millisecondsRange(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)}</small></label>
                <label className="block" htmlFor="retries-setting"><span className="text-sm font-medium text-ink">{copy.retries}</span><input id="retries-setting" className="mt-2.5 h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-mono text-sm text-ink" type="number" min={0} max={MAX_RETRIES} step={1} value={Number.isNaN(settingsDraft.retries) ? "" : settingsDraft.retries} onChange={(event) => { setSettingsDraft((value) => ({ ...value, retries: Number(event.target.value) })); setSettingsError(null); }} disabled={settingsBusy} /><small className="mt-1.5 block text-xs text-ink-subtle">{copy.transportRetriesRange(MAX_RETRIES)}</small></label>
              </div>
              <div className="grid grid-cols-1 gap-5 border-t border-line pt-5 sm:grid-cols-2">
                <PreviewSettingStepper
                  id="preview-character-count"
                  label={copy.previewCharacterCount}
                  value={privacyDraft.previewCharacterCount}
                  displayValue={String(privacyDraft.previewCharacterCount)}
                  min={MIN_PREVIEW_CHARACTER_COUNT}
                  max={MAX_PREVIEW_CHARACTER_COUNT}
                  help={copy.previewCharacterCountHelp}
                  increaseLabel={copy.increasePreviewCharacterCount}
                  decreaseLabel={copy.decreasePreviewCharacterCount}
                  onChange={(value) => setPrivacyDraft((current) => ({ ...current, previewCharacterCount: value }))}
                />
                <PreviewSettingStepper
                  id="hover-reveal-delay"
                  label={copy.hoverRevealDelay}
                  value={privacyDraft.hoverRevealDelay}
                  displayValue={privacyDraft.hoverRevealDelay < 0 ? copy.hoverRevealDisabled : privacyDraft.hoverRevealDelay === 0 ? copy.hoverRevealImmediate : copy.hoverRevealSeconds(privacyDraft.hoverRevealDelay)}
                  min={MIN_HOVER_REVEAL_DELAY}
                  max={MAX_HOVER_REVEAL_DELAY}
                  help={copy.hoverRevealDelayHelp}
                  increaseLabel={copy.increaseHoverRevealDelay}
                  decreaseLabel={copy.decreaseHoverRevealDelay}
                  onChange={(value) => setPrivacyDraft((current) => ({ ...current, hoverRevealDelay: value }))}
                />
              </div>
            </div>
            <p className="mt-5 text-xs leading-relaxed text-ink-subtle">{copy.settingsHelp}</p>
            {settingsErrorMessage ? <p className="mt-3 flex items-center gap-1.5 text-sm text-danger" role="alert"><AlertCircle className="h-4 w-4" aria-hidden="true" />{settingsErrorMessage}</p> : null}
            <div className="mt-6 flex items-center justify-end gap-3">{settingsSaved ? <span className="mr-auto text-sm font-medium text-success">{copy.settingsSaved}</span> : null}<button type="button" onClick={() => setSettingsOpen(false)} disabled={settingsBusy} className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-medium text-ink-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40">{copy.cancel}</button><button type="button" onClick={() => void saveSettings()} disabled={settingsBusy} className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-subtle">{settingsBusy ? copy.saving : copy.saveSettings}</button></div>
          </section>
        </div>
      ) : null}

      {switchConfirm !== null ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 px-6 py-8 backdrop-blur-[2px]" role="presentation">
          <section className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/15" role="dialog" aria-modal="true" aria-labelledby="switch-dialog-title">
            <p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{copy.unsavedChanges}</p><h2 id="switch-dialog-title" className="mt-1.5 text-xl font-semibold text-ink">{copy.switchUnsavedTitle}</h2><p className="mt-3 text-sm leading-relaxed text-ink-muted">{copy.switchUnsavedMessage}</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setSwitchConfirm(null)} autoFocus className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-medium text-ink-muted hover:bg-surface-2">{copy.cancel}</button><button type="button" onClick={() => selectSlotImmediately(switchConfirm)} className="inline-flex h-11 items-center rounded-xl bg-danger px-4 text-sm font-medium text-white hover:opacity-90">{copy.switchAnyway}</button></div>
          </section>
        </div>
      ) : null}

      {deviceSwitchConfirm !== null ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 px-6 py-8 backdrop-blur-[2px]" role="presentation">
          <section className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/15" role="dialog" aria-modal="true" aria-labelledby="device-switch-dialog-title">
            <p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{copy.unsavedChanges}</p><h2 id="device-switch-dialog-title" className="mt-1.5 text-xl font-semibold text-ink">{copy.deviceSwitchUnsavedTitle}</h2><p className="mt-3 text-sm leading-relaxed text-ink-muted">{copy.deviceSwitchUnsavedMessage}</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setDeviceSwitchConfirm(null)} autoFocus className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-medium text-ink-muted hover:bg-surface-2">{copy.cancel}</button><button type="button" onClick={() => { const id = deviceSwitchConfirm; setDeviceSwitchConfirm(null); void connectDevice(id); }} className="inline-flex h-11 items-center rounded-xl bg-danger px-4 text-sm font-medium text-white hover:opacity-90">{copy.deviceSwitchAnyway}</button></div>
          </section>
        </div>
      ) : null}

      {closeConfirmOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 px-6 py-8 backdrop-blur-[2px]" role="presentation">
          <section className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/15" role="dialog" aria-modal="true" aria-labelledby="close-dialog-title" aria-describedby="close-dialog-message">
            <p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{copy.closeUnsavedTitle}</p><h2 id="close-dialog-title" className="mt-1.5 text-xl font-semibold text-ink">{copy.closeUnsavedTitle}</h2><p id="close-dialog-message" className="mt-3 text-sm leading-relaxed text-ink-muted">{copy.closeUnsavedMessage}</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={cancelClose} autoFocus className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-medium text-ink-muted hover:bg-surface-2">{copy.cancel}</button><button type="button" onClick={closeWithoutSaving} className="inline-flex h-11 items-center rounded-xl bg-danger px-4 text-sm font-medium text-white hover:opacity-90">{copy.closeWithoutSaving}</button></div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export default App;
