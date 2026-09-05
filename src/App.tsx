import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  type Locale,
  type SettingsValidationKey,
} from "./i18n";
import {
  asCommandError,
  clearSlot as clearSlotCommand,
  connectDevice as connectDeviceCommand,
  disconnectDevice as disconnectDeviceCommand,
  getConnection,
  getSettings,
  getSlot,
  listDevices,
  listSlots,
  setSettings as setSettingsCommand,
  setSlot as setSlotCommand,
} from "./bridge";
import type {
  ClientSettings,
  CommandError,
  ConnectedDevice,
  ConnectionState,
  DeviceCandidate,
  SlotBytes,
  SlotMetadata,
} from "./bridge";
import "./App.css";

type ThemeMode = "system" | "light" | "dark";
type OperationName =
  | "Discover"
  | "Connect"
  | "Disconnect"
  | "LIST"
  | "GET"
  | "SET"
  | "CLEAR"
  | "Settings";
type RefreshSource = "manual" | "automatic";
type SlotStatus = "idle" | "saving" | "saved" | "error";
type SlotAction = "load" | "save" | "clear";

type SlotState = {
  slot: number;
  length: number;
  savedText: string;
  draftText: string;
  savedLabel: string;
  draftLabel: string;
  loaded: boolean;
  loading: boolean;
  revealed: boolean;
  status: SlotStatus;
  error: CommandError | null;
  lastAction: SlotAction | null;
};

type UserSettings = ClientSettings & {
  autoReconnect: boolean;
};

const disconnected: ConnectionState = { connected: false, device: null };
const MAX_TEXT_BYTES = 256;
const LABELS_STORAGE_PREFIX = "zmk-runtime-macro-labels:v1";
const THEME_STORAGE_KEY = "zmk-runtime-macro-theme:v1";
const SETTINGS_STORAGE_KEY = "zmk-runtime-macro-settings:v1";
const DEFAULT_CLIENT_SETTINGS: ClientSettings = {
  timeoutMs: 1_000,
  retries: 2,
  appliesNextConnection: true,
};
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 5;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
const MAX_RECONNECT_ATTEMPTS = 8;
const CONTROL_TOKENS: Record<string, string> = {
  "↵": "\n",
  "⇥": "\t",
  "⌫": "\b",
};
const CONTROL_CHARACTERS: Record<string, string> = {
  "\n": "↵",
  "\t": "⇥",
  "\b": "⌫",
};

function formatHex(value: number): string {
  return `0x${value.toString(16).padStart(4, "0")}`;
}

function formatSlotNumber(slot: number): string {
  return String(slot + 1).padStart(2, "0");
}

function defaultLabel(slot: number, locale: Locale): string {
  const formattedSlot = formatSlotNumber(slot);
  return locale === "zh-CN" ? `插槽 ${formattedSlot}` : `Slot ${formattedSlot}`;
}

function textByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function toEditorText(text: string): string {
  let visible = "";
  for (const character of text) {
    visible += CONTROL_CHARACTERS[character] ?? character;
  }
  return visible;
}

function normalizeEditorText(value: string): string {
  return value
    .replace(/\n/g, "↵")
    .replace(/\t/g, "⇥")
    .replace(/\u0008/g, "⌫");
}

function parseEditorText(value: string):
  | { text: string; error: null }
  | { text: null; error: InputErrorKey } {
  const normalized = normalizeEditorText(value);
  let text = "";
  for (const character of normalized) {
    if (CONTROL_TOKENS[character]) {
      text += CONTROL_TOKENS[character];
      continue;
    }
    if (character >= " " && character <= "~") {
      text += character;
      continue;
    }
    return {
      text: null,
      error: "unsupportedText",
    };
  }

  if (textByteLength(text) > MAX_TEXT_BYTES) {
    return {
      text: null,
      error: "textTooLong",
    };
  }
  return { text, error: null };
}

function decodeSlotBytes(bytes: SlotBytes): string {
  let text = "";
  for (const byte of bytes) {
    if (
      !Number.isInteger(byte) ||
      byte < 0 ||
      byte > 0xff ||
      (!(byte >= 0x20 && byte <= 0x7e) &&
        byte !== 0x08 &&
        byte !== 0x09 &&
        byte !== 0x0a)
    ) {
      throw new Error("The device returned unsupported slot text.");
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

function maskText(text: string): string {
  return "•".repeat(textByteLength(text));
}

function deviceSummaryKey(device: ConnectedDevice | null): string | null {
  if (!device) {
    return null;
  }
  return [
    device.vendorId.toString(16),
    device.productId.toString(16),
    device.interfaceNumber,
    device.usagePage.toString(16),
    device.usage.toString(16),
  ].join(":");
}

function sameDevice(
  first: ConnectedDevice | null,
  second: ConnectedDevice | null,
): boolean {
  const firstKey = deviceSummaryKey(first);
  return firstKey !== null && firstKey === deviceSummaryKey(second);
}

function labelsStorageKey(device: ConnectedDevice): string {
  return [LABELS_STORAGE_PREFIX, deviceSummaryKey(device)].join(":");
}

function readLabels(device: ConnectedDevice | null): Record<number, string> {
  if (!device) {
    return {};
  }
  try {
    const raw = localStorage.getItem(labelsStorageKey(device));
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const labels: Record<number, string> = {};
    for (const [slot, label] of Object.entries(parsed)) {
      const slotNumber = Number(slot);
      if (
        Number.isInteger(slotNumber) &&
        slotNumber >= 0 &&
        slotNumber <= 254 &&
        typeof label === "string"
      ) {
        labels[slotNumber] = label.slice(0, 64);
      }
    }
    return labels;
  } catch {
    return {};
  }
}

function writeLabels(
  device: ConnectedDevice | null,
  labels: Record<number, string>,
): void {
  if (!device) {
    return;
  }
  try {
    const safeLabels: Record<number, string> = {};
    for (const [slot, label] of Object.entries(labels)) {
      safeLabels[Number(slot)] = label.slice(0, 64);
    }
    localStorage.setItem(labelsStorageKey(device), JSON.stringify(safeLabels));
  } catch {
    // A local label is useful but not required for the device operation.
  }
}

function readTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "system" || value === "light" || value === "dark") {
      return value;
    }
  } catch {
    // Fall back to the system theme when storage is unavailable.
  }
  return "system";
}

function readUserSettings(): UserSettings {
  const defaults: UserSettings = {
    ...DEFAULT_CLIENT_SETTINGS,
    autoReconnect: true,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return defaults;
    }
    const candidate = parsed as Record<string, unknown>;
    const timeoutMs = candidate.timeoutMs;
    const retries = candidate.retries;
    const autoReconnect = candidate.autoReconnect;
    return {
      ...defaults,
      ...(typeof timeoutMs === "number" &&
      Number.isInteger(timeoutMs) &&
      timeoutMs >= MIN_TIMEOUT_MS &&
      timeoutMs <= MAX_TIMEOUT_MS
        ? { timeoutMs }
        : {}),
      ...(typeof retries === "number" &&
      Number.isInteger(retries) &&
      retries >= 0 &&
      retries <= MAX_RETRIES
        ? { retries }
        : {}),
      ...(typeof autoReconnect === "boolean" ? { autoReconnect } : {}),
    };
  } catch {
    return defaults;
  }
}

function writeUserSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        timeoutMs: settings.timeoutMs,
        retries: settings.retries,
        autoReconnect: settings.autoReconnect,
      }),
    );
  } catch {
    // Local preferences are optional and never affect device operations.
  }
}

function validateUserSettings(settings: UserSettings): SettingsValidationKey | null {
  if (
    !Number.isInteger(settings.timeoutMs) ||
    settings.timeoutMs < MIN_TIMEOUT_MS ||
    settings.timeoutMs > MAX_TIMEOUT_MS
  ) {
    return "timeout";
  }
  if (
    !Number.isInteger(settings.retries) ||
    settings.retries < 0 ||
    settings.retries > MAX_RETRIES
  ) {
    return "retries";
  }
  return null;
}

function isTextDirty(slot: SlotState): boolean {
  return slot.loaded && slot.draftText !== slot.savedText;
}

function isLabelDirty(slot: SlotState): boolean {
  return slot.loaded && slot.draftLabel !== slot.savedLabel;
}

function isDirty(slot: SlotState): boolean {
  return isTextDirty(slot) || isLabelDirty(slot);
}

function createSlotState(
  metadata: SlotMetadata,
  labels: Record<number, string>,
  previous?: SlotState,
  preserveDirtyDraft = true,
): SlotState {
  const label = labels[metadata.slot] ?? "";
  if (previous && preserveDirtyDraft && isTextDirty(previous)) {
    return {
      ...previous,
      length: metadata.length,
      error: null,
      lastAction: null,
    };
  }

  const preservedLabel =
    previous && preserveDirtyDraft && isLabelDirty(previous)
      ? {
          savedLabel: previous.savedLabel,
          draftLabel: previous.draftLabel,
        }
      : { savedLabel: label, draftLabel: label };
  const empty = metadata.length === 0;
  return {
    slot: metadata.slot,
    length: metadata.length,
    savedText: "",
    draftText: "",
    ...preservedLabel,
    loaded: empty,
    loading: false,
    revealed: false,
    status: "idle",
    error: null,
    lastAction: null,
  };
}

type SettingsError = SettingsValidationKey | CommandError;

function App() {
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(
    readLanguagePreference,
  );
  const locale: Locale = resolveLocale(languagePreference);
  const copy = getMessages(locale);
  const [devices, setDevices] = useState<DeviceCandidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [connection, setConnection] = useState<ConnectionState>(disconnected);
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const [inputError, setInputError] = useState<InputErrorKey | null>(null);
  const [clearConfirm, setClearConfirm] = useState<number | null>(null);
  const [settings, setSettings] = useState<UserSettings>(() => readUserSettings());
  const [settingsDraft, setSettingsDraft] = useState<UserSettings>(() => readUserSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<SettingsError | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastOperation, setLastOperation] = useState<OperationName | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const operation = useRef(0);
  const lastDevice = useRef<ConnectedDevice | null>(null);
  const dirtyRef = useRef(false);
  const slotRequest = useRef(0);
  const mounted = useRef(false);
  const initialised = useRef(false);
  const settingsInitialised = useRef(false);
  const settingsLoad = useRef<Promise<void> | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const mutationRequest = useRef(0);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectAttempt = useRef(0);
  const autoReconnectSuppressed = useRef(false);
  const autoReconnectRef = useRef(settings.autoReconnect);
  const connectionRef = useRef(connection.connected);
  const refreshDevicesRef = useRef<((source?: RefreshSource) => Promise<void>) | null>(null);
  const closeConfirmOpenRef = useRef(false);

  autoReconnectRef.current = settings.autoReconnect;
  connectionRef.current = connection.connected;
  dirtyRef.current = slots.some(isDirty);

  const isCurrent = useCallback((sequence: number) => {
    return mounted.current && operation.current === sequence;
  }, []);

  const recordOperation = useCallback((name: OperationName) => {
    setLastOperation(name);
  }, []);

  const commandError = useCallback((caught: unknown): CommandError => {
    const error = asCommandError(caught);
    setLastErrorCode(error.code);
    return error;
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimer.current !== null) {
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const requestReconnect = useCallback(() => {
    if (autoReconnectRef.current && !autoReconnectSuppressed.current) {
      setReconnecting(true);
    }
  }, []);

  const applySlotList = useCallback(
    (
      metadata: SlotMetadata[],
      nextLabels: Record<number, string>,
      preserveDirtyDrafts = true,
    ) => {
      setSlots((previous) =>
        metadata.map((item) =>
          createSlotState(
            item,
            nextLabels,
            preserveDirtyDrafts
              ? previous.find((slot) => slot.slot === item.slot)
              : undefined,
            preserveDirtyDrafts,
          ),
        ),
      );
      setSelectedSlot((current) =>
        current !== null && metadata.some((item) => item.slot === current)
          ? current
          : metadata[0]?.slot ?? null,
      );
    },
    [],
  );

  const loadSlots = useCallback(
    async (
      sequence: number,
      nextLabels = labels,
      preserveDirtyDrafts = true,
    ) => {
      recordOperation("LIST");
      const metadata = await listSlots();
      if (!isCurrent(sequence)) {
        return;
      }
      applySlotList(metadata, nextLabels, preserveDirtyDrafts);
    },
    [applySlotList, isCurrent, labels, recordOperation],
  );

  const connectDevice = useCallback(
    async (id: string, existingSequence?: number) => {
      const sequence = existingSequence ?? ++operation.current;
      const ownsBusyState = existingSequence === undefined;
      if (ownsBusyState) {
        autoReconnectSuppressed.current = false;
        reconnectAttempt.current = 0;
        clearReconnectTimer();
        setBusy(true);
        setChecking(true);
        setReconnecting(false);
        setError(null);
      }
      recordOperation("Connect");
      setSelectedId(id);
      setClearConfirm(null);
      setConnection(disconnected);
      setSlots((previous) =>
        previous.map((slot) =>
          slot.revealed ? { ...slot, revealed: false } : slot,
        ),
      );
      setInputError(null);

      try {
        const nextConnection = await connectDeviceCommand(id);
        if (!isCurrent(sequence)) {
          return;
        }
        const preserveDirtyDrafts = sameDevice(
          lastDevice.current,
          nextConnection.device,
        );
        lastDevice.current = nextConnection.device;
        if (!preserveDirtyDrafts) {
          setSlots([]);
          setSelectedSlot(null);
        }
        const nextLabels = readLabels(nextConnection.device);
        setConnection(nextConnection);
        setLabels(nextLabels);
        await loadSlots(sequence, nextLabels, preserveDirtyDrafts);
        if (isCurrent(sequence)) {
          setError(null);
          setReconnecting(false);
          reconnectAttempt.current = 0;
        }
      } catch (caught) {
        if (isCurrent(sequence)) {
          const nextError = commandError(caught);
          setError(nextError);
          setConnection(disconnected);
          requestReconnect();
        }
      } finally {
        if (ownsBusyState && isCurrent(sequence)) {
          setBusy(false);
          setChecking(false);
        }
      }
    },
    [clearReconnectTimer, commandError, isCurrent, loadSlots, recordOperation, requestReconnect],
  );

  const refreshDevices = useCallback(async (source: RefreshSource = "manual") => {
    if (
      source === "automatic" &&
      (!autoReconnectRef.current || autoReconnectSuppressed.current)
    ) {
      return;
    }
    const sequence = ++operation.current;
    if (source === "manual") {
      autoReconnectSuppressed.current = false;
      reconnectAttempt.current = 0;
      clearReconnectTimer();
    }
    setBusy(true);
    setChecking(true);
    setReconnecting(source === "automatic");
    if (source === "manual") {
      setError(null);
    }
    recordOperation("Discover");

    try {
      const [nextDevices, nextConnection] = await Promise.all([
        listDevices(),
        getConnection(),
      ]);
      if (!isCurrent(sequence)) {
        return;
      }

      setDevices(nextDevices);
      setConnection(nextConnection);
      setSelectedId((current) =>
        nextDevices.some((device) => device.id === current) ? current : "",
      );
      if (!nextConnection.connected) {
        setSlots((previous) =>
          previous.map((slot) =>
            slot.revealed ? { ...slot, revealed: false } : slot,
          ),
        );
      }
      if (nextConnection.connected) {
        const nextLabels = readLabels(nextConnection.device);
        lastDevice.current = nextConnection.device;
        setLabels(nextLabels);
        try {
          await loadSlots(sequence, nextLabels);
        } catch (caught) {
          if (isCurrent(sequence)) {
            const nextError = commandError(caught);
            setConnection(disconnected);
            setSlots((previous) =>
              previous.map((slot) =>
                slot.revealed ? { ...slot, revealed: false } : slot,
              ),
            );
            setError(nextError);
            requestReconnect();
          }
          return;
        }
        if (isCurrent(sequence)) {
          setReconnecting(false);
          reconnectAttempt.current = 0;
        }
      }

      const exactDevices = nextDevices.filter(
        (device) => device.usageMetadata === "exact",
      );
      if (!nextConnection.connected && nextDevices.length === 0) {
        const noDeviceError: CommandError = {
          code: "no_device",
          message: "No compatible Runtime Macro HID device was found.",
        };
        setLastErrorCode(noDeviceError.code);
        setError(noDeviceError);
      } else if (
        !nextConnection.connected &&
        nextDevices.length > 0 &&
        exactDevices.length === 0
      ) {
        autoReconnectSuppressed.current = true;
        setReconnecting(false);
        const metadataError: CommandError = {
          code: "usage_metadata_missing",
          message: "HID Usage metadata is unavailable; choose a device explicitly.",
        };
        setLastErrorCode(metadataError.code);
        setError(metadataError);
      } else if (!nextConnection.connected && exactDevices.length === 1) {
        await connectDevice(exactDevices[0].id, sequence);
      } else if (!nextConnection.connected && exactDevices.length > 1) {
        autoReconnectSuppressed.current = true;
        setReconnecting(false);
        const ambiguousError: CommandError = {
          code: "ambiguous_devices",
          message: "Multiple compatible HID devices were found; choose one explicitly.",
        };
        setLastErrorCode(ambiguousError.code);
        setError(ambiguousError);
      }
    } catch (caught) {
      if (isCurrent(sequence)) {
        const nextError = commandError(caught);
        setError(nextError);
        requestReconnect();
      }
    } finally {
      if (isCurrent(sequence)) {
        setBusy(false);
        setChecking(false);
      }
    }
  }, [clearReconnectTimer, commandError, connectDevice, isCurrent, loadSlots, recordOperation, requestReconnect]);

  refreshDevicesRef.current = refreshDevices;

  const disconnectDevice = useCallback(async () => {
    const sequence = ++operation.current;
    autoReconnectSuppressed.current = true;
    reconnectAttempt.current = 0;
    clearReconnectTimer();
    setReconnecting(false);
    setBusy(true);
    setError(null);
    recordOperation("Disconnect");
    try {
      await disconnectDeviceCommand();
      if (!isCurrent(sequence)) {
        return;
      }
      setConnection(disconnected);
      setSlots((previous) =>
        previous.map((slot) =>
          slot.revealed ? { ...slot, revealed: false } : slot,
        ),
      );
      setSelectedId("");
      setClearConfirm(null);
    } catch (caught) {
      if (isCurrent(sequence)) {
        setError(commandError(caught));
      }
    } finally {
      if (isCurrent(sequence)) {
        setBusy(false);
      }
    }
  }, [clearReconnectTimer, commandError, isCurrent, recordOperation]);

  const refreshSlots = useCallback(async () => {
    const sequence = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      await loadSlots(sequence);
    } catch (caught) {
      if (isCurrent(sequence)) {
        const nextError = commandError(caught);
        setError(nextError);
        setConnection(disconnected);
        setSlots((previous) =>
          previous.map((slot) =>
            slot.revealed ? { ...slot, revealed: false } : slot,
          ),
        );
        requestReconnect();
      }
    } finally {
      if (isCurrent(sequence)) {
        setBusy(false);
      }
    }
  }, [commandError, isCurrent, loadSlots, requestReconnect]);

  const loadSlotContent = useCallback(
    async (slotNumber: number) => {
      const sequence = operation.current;
      const request = ++slotRequest.current;
      setSlots((previous) =>
        previous.map((slot) =>
          slot.slot === slotNumber
            ? {
                ...slot,
                loading: true,
                error: null,
                lastAction: null,
              }
            : slot,
        ),
      );
      setInputError(null);
      recordOperation("GET");

      try {
        const bytes = await getSlot(slotNumber);
        const text = decodeSlotBytes(bytes);
        if (!isCurrent(sequence)) {
          return;
        }
        if (slotRequest.current !== request || selectedSlot !== slotNumber) {
          setSlots((previous) =>
            previous.map((slot) =>
              slot.slot === slotNumber ? { ...slot, loading: false } : slot,
            ),
          );
          return;
        }
        setSlots((previous) =>
          previous.map((slot) =>
            slot.slot === slotNumber
              ? {
                  ...slot,
                  length: bytes.length,
                  savedText: text,
                  draftText: text,
                  loaded: true,
                  loading: false,
                  revealed: false,
                  status: "idle",
                  error: null,
                  lastAction: null,
                }
              : slot,
          ),
        );
      } catch (caught) {
        if (!isCurrent(sequence)) {
          return;
        }
        const nextError = commandError(caught);
        setConnection(disconnected);
        setSlots((previous) =>
          previous.map((slot) => {
            if (slot.slot === slotNumber) {
              const isCurrentSlotRequest =
                slotRequest.current === request && selectedSlot === slotNumber;
              return {
                ...slot,
                loading: false,
                revealed: false,
                ...(isCurrentSlotRequest
                  ? {
                      status: "error" as const,
                      error: nextError,
                      lastAction: "load" as const,
                    }
                  : {
                      status: "idle" as const,
                      error: null,
                      lastAction: null,
                    }),
              };
            }
            return slot.revealed ? { ...slot, revealed: false } : slot;
          }),
        );
        setError(nextError);
        requestReconnect();
      }
    },
    [commandError, isCurrent, recordOperation, requestReconnect, selectedSlot],
  );

  const selectedState = useMemo(
    () => slots.find((slot) => slot.slot === selectedSlot) ?? null,
    [selectedSlot, slots],
  );

  useEffect(() => {
    if (!connection.connected || selectedSlot === null) {
      return;
    }
    const slot = slots.find((item) => item.slot === selectedSlot);
    if (!slot || slot.loaded || slot.loading || slot.error) {
      return;
    }
    if (slot.length === 0) {
      setSlots((previous) =>
        previous.map((item) =>
          item.slot === selectedSlot ? { ...item, loaded: true } : item,
        ),
      );
      return;
    }
    void loadSlotContent(selectedSlot);
  }, [connection.connected, loadSlotContent, selectedSlot, slots]);

  const updateSelectedSlot = useCallback(
    (update: (slot: SlotState) => SlotState) => {
      if (selectedSlot === null) {
        return;
      }
      setSlots((previous) =>
        previous.map((slot) =>
          slot.slot === selectedSlot
            ? update({
                ...slot,
                status: "idle",
                error: null,
                lastAction: null,
              })
            : slot,
        ),
      );
    },
    [selectedSlot],
  );

  const updateLabel = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value.slice(0, 64);
      updateSelectedSlot((slot) => ({ ...slot, draftLabel: value }));
    },
    [updateSelectedSlot],
  );

  const updateEditor = useCallback(
    (value: string) => {
      const parsed = parseEditorText(value);
      if (parsed.error || parsed.text === null) {
        setInputError(parsed.error ?? "parseFailed");
        return;
      }
      setInputError(null);
      updateSelectedSlot((slot) => ({ ...slot, draftText: parsed.text }));
    },
    [updateSelectedSlot],
  );

  const insertControlToken = useCallback(
    (token: string) => {
      if (!selectedState?.loaded) {
        return;
      }
      const currentValue = toEditorText(selectedState.draftText);
      const input = editorRef.current;
      const start = input?.selectionStart ?? currentValue.length;
      const end = input?.selectionEnd ?? start;
      const nextValue = currentValue.slice(0, start) + token + currentValue.slice(end);
      const parsed = parseEditorText(nextValue);
      if (parsed.error || parsed.text === null) {
        setInputError(parsed.error ?? "parseFailed");
        return;
      }
      setInputError(null);
      updateSelectedSlot((slot) => ({ ...slot, draftText: parsed.text }));
      window.requestAnimationFrame(() => {
        if (editorRef.current) {
          const caret = start + token.length;
          editorRef.current.focus();
          editorRef.current.setSelectionRange(caret, caret);
        }
      });
    },
    [selectedState, updateSelectedSlot],
  );

  const saveSlot = useCallback(
    async (slotNumber = selectedSlot) => {
      if (
        slotNumber === null ||
        !connection.connected ||
        mutationBusy
      ) {
        return;
      }
      const slot = slots.find((item) => item.slot === slotNumber);
      if (!slot || !slot.loaded || !isDirty(slot)) {
        return;
      }
      const request = ++mutationRequest.current;
      setMutationBusy(true);
      setClearConfirm(null);
      setSlots((previous) =>
        previous.map((item) =>
          item.slot === slotNumber
            ? { ...item, status: "saving", error: null, lastAction: null }
            : item,
        ),
      );
      try {
        if (slot.draftText !== slot.savedText) {
          recordOperation("SET");
          await setSlotCommand(slotNumber, slot.draftText);
        }
        if (!mounted.current || mutationRequest.current !== request) {
          return;
        }
        const nextLabels = {
          ...labels,
          [slotNumber]: slot.draftLabel,
        };
        writeLabels(connection.device, nextLabels);
        setLabels(nextLabels);
        setSlots((previous) =>
          previous.map((item) =>
            item.slot === slotNumber
              ? {
                  ...item,
                  length: textByteLength(slot.draftText),
                  savedText: slot.draftText,
                  savedLabel: slot.draftLabel,
                  status: "saved",
                  error: null,
                  lastAction: null,
                }
              : item,
          ),
        );
        window.setTimeout(() => {
          if (mounted.current) {
            setSlots((previous) =>
              previous.map((item) =>
                item.slot === slotNumber && item.status === "saved"
                  ? { ...item, status: "idle" }
                  : item,
              ),
            );
          }
        }, 2200);
      } catch (caught) {
        if (!mounted.current || mutationRequest.current !== request) {
          return;
        }
        const nextError = commandError(caught);
        setConnection(disconnected);
        setError(nextError);
        setSlots((previous) =>
          previous.map((item) =>
            item.slot === slotNumber
              ? {
                  ...item,
                  revealed: false,
                  status: "error",
                  error: nextError,
                  lastAction: "save",
                }
              : item,
          ),
        );
        requestReconnect();
      } finally {
        if (mounted.current && mutationRequest.current === request) {
          setMutationBusy(false);
        }
      }
    },
    [commandError, connection, labels, mutationBusy, recordOperation, requestReconnect, selectedSlot, slots],
  );

  const clearSlot = useCallback(
    async (slotNumber: number) => {
      if (!connection.connected || mutationBusy) {
        return;
      }
      const slot = slots.find((item) => item.slot === slotNumber);
      if (!slot || !slot.loaded || textByteLength(slot.draftText) === 0) {
        return;
      }
      const request = ++mutationRequest.current;
      setMutationBusy(true);
      setClearConfirm(null);
      setSlots((previous) =>
        previous.map((item) =>
          item.slot === slotNumber
            ? { ...item, status: "saving", error: null, lastAction: null }
            : item,
        ),
      );
      try {
        recordOperation("CLEAR");
        await clearSlotCommand(slotNumber);
        if (!mounted.current || mutationRequest.current !== request) {
          return;
        }
        setSlots((previous) =>
          previous.map((item) =>
            item.slot === slotNumber
              ? {
                  ...item,
                  length: 0,
                  savedText: "",
                  draftText: "",
                  loaded: true,
                  revealed: false,
                  status: "saved",
                  error: null,
                  lastAction: null,
                }
              : item,
          ),
        );
        window.setTimeout(() => {
          if (mounted.current) {
            setSlots((previous) =>
              previous.map((item) =>
                item.slot === slotNumber && item.status === "saved"
                  ? { ...item, status: "idle" }
                  : item,
              ),
            );
          }
        }, 2200);
      } catch (caught) {
        if (!mounted.current || mutationRequest.current !== request) {
          return;
        }
        const nextError = commandError(caught);
        setConnection(disconnected);
        setError(nextError);
        setSlots((previous) =>
          previous.map((item) =>
            item.slot === slotNumber
              ? {
                  ...item,
                  revealed: false,
                  status: "error",
                  error: nextError,
                  lastAction: "clear",
                }
              : item,
          ),
        );
        requestReconnect();
      } finally {
        if (mounted.current && mutationRequest.current === request) {
          setMutationBusy(false);
        }
      }
    },
    [commandError, connection.connected, mutationBusy, recordOperation, requestReconnect, slots],
  );

  const retrySlotAction = useCallback(
    (slot: SlotState) => {
      if (slot.lastAction === "load") {
        void loadSlotContent(slot.slot);
      } else if (slot.lastAction === "save") {
        void saveSlot(slot.slot);
      } else if (slot.lastAction === "clear") {
        setClearConfirm(slot.slot);
      }
    },
    [loadSlotContent, saveSlot],
  );

  const selectSlot = useCallback(
    (slotNumber: number) => {
      if (mutationBusy || selectedSlot === slotNumber) {
        return;
      }
      const currentSlot = slots.find((slot) => slot.slot === selectedSlot);
      if (currentSlot && isDirty(currentSlot)) {
        const confirmed = window.confirm(copy.switchUnsavedMessage);
        if (!confirmed) {
          return;
        }
      }
      slotRequest.current += 1;
      setSelectedSlot(slotNumber);
      setClearConfirm(null);
      setInputError(null);
    },
    [copy.switchUnsavedMessage, mutationBusy, selectedSlot, slots],
  );

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveSlot();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        insertControlToken("↵");
      } else if (event.key === "Tab") {
        event.preventDefault();
        insertControlToken("⇥");
      }
    },
    [insertControlToken, saveSlot],
  );

  const addMacro = useCallback(() => {
    if (!selectedState?.loaded) {
      return;
    }
    setInputError(null);
    updateSelectedSlot((slot) => ({ ...slot, revealed: true }));
    window.requestAnimationFrame(() => editorRef.current?.focus());
  }, [selectedState, updateSelectedSlot]);

  const updateSettingsDraft = useCallback((update: Partial<UserSettings>) => {
    setSettingsDraft((previous) => ({ ...previous, ...update }));
    setSettingsError(null);
    setSettingsSaved(false);
  }, []);

  const updateLanguagePreference = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextPreference = event.target.value;
      if (!isLanguagePreference(nextPreference)) {
        return;
      }
      setLanguagePreference(nextPreference);
      writeLanguagePreference(nextPreference);
    },
    [],
  );

  const saveSettings = useCallback(async () => {
    const validation = validateUserSettings(settingsDraft);
    if (validation) {
      setSettingsError(validation);
      setSettingsSaved(false);
      return;
    }
    setSettingsBusy(true);
    setSettingsError(null);
    setSettingsSaved(false);
    recordOperation("Settings");
    try {
      const nextTransport = await setSettingsCommand(
        settingsDraft.timeoutMs,
        settingsDraft.retries,
      );
      const nextSettings: UserSettings = {
        ...nextTransport,
        autoReconnect: settingsDraft.autoReconnect,
      };
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);
      writeUserSettings(nextSettings);
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 2200);
    } catch (caught) {
      const nextError = commandError(caught);
      setSettingsError(nextError);
    } finally {
      setSettingsBusy(false);
    }
  }, [commandError, recordOperation, settingsDraft]);

  const cancelCloseRequest = useCallback(() => {
    closeConfirmOpenRef.current = false;
    setCloseConfirmOpen(false);
  }, []);

  const closeWithoutSaving = useCallback(() => {
    closeConfirmOpenRef.current = false;
    setCloseConfirmOpen(false);
    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }
    void getCurrentWindow().destroy().catch(() => {
      if (mounted.current) {
        closeConfirmOpenRef.current = true;
        setCloseConfirmOpen(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!closeConfirmOpen) {
      return;
    }
    const handleCloseKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelCloseRequest();
      }
    };
    window.addEventListener("keydown", handleCloseKeyDown);
    return () => window.removeEventListener("keydown", handleCloseKeyDown);
  }, [cancelCloseRequest, closeConfirmOpen]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearReconnectTimer();
    };
  }, [clearReconnectTimer]);

  useEffect(() => {
    if (settingsInitialised.current) {
      return;
    }
    settingsInitialised.current = true;
    const stored = readUserSettings();
    settingsLoad.current = (async () => {
      recordOperation("Settings");
      try {
        const backend = await getSettings();
        const transport =
          backend.timeoutMs !== stored.timeoutMs || backend.retries !== stored.retries
            ? await setSettingsCommand(stored.timeoutMs, stored.retries)
            : backend;
        const nextSettings: UserSettings = {
          ...transport,
          autoReconnect: stored.autoReconnect,
        };
        setSettings(nextSettings);
        setSettingsDraft(nextSettings);
        writeUserSettings(nextSettings);
      } catch (caught) {
        setSettingsError(commandError(caught));
      }
    })();
  }, [commandError, recordOperation]);

  useEffect(() => {
    if (
      connection.connected ||
      !settings.autoReconnect ||
      autoReconnectSuppressed.current
    ) {
      clearReconnectTimer();
      if (!connection.connected) {
        setReconnecting(false);
      }
      return;
    }
    if (
      !mounted.current ||
      checking ||
      busy ||
      reconnectTimer.current !== null
    ) {
      return;
    }
    if (reconnectAttempt.current >= MAX_RECONNECT_ATTEMPTS) {
      setReconnecting(false);
      return;
    }

    const delay =
      RECONNECT_DELAYS_MS[
        Math.min(reconnectAttempt.current, RECONNECT_DELAYS_MS.length - 1)
      ];
    setReconnecting(true);
    reconnectTimer.current = window.setTimeout(() => {
      reconnectTimer.current = null;
      if (
        !mounted.current ||
        connectionRef.current ||
        !autoReconnectRef.current ||
        autoReconnectSuppressed.current
      ) {
        setReconnecting(false);
        return;
      }
      reconnectAttempt.current += 1;
      void refreshDevicesRef.current?.("automatic");
    }, delay);
  }, [busy, checking, clearReconnectTimer, connection.connected, settings.autoReconnect]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    const installBrowserFallback = () => {
      window.addEventListener("beforeunload", beforeUnload);
    };
    const removeBrowserFallback = () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };

    if (!("__TAURI_INTERNALS__" in window)) {
      installBrowserFallback();
      return removeBrowserFallback;
    }

    let active = true;
    let unlisten: (() => void) | undefined;
    try {
      const appWindow = getCurrentWindow();
      void appWindow
        .onCloseRequested((event) => {
          if (!dirtyRef.current) {
            return;
          }
          event.preventDefault();
          if (!closeConfirmOpenRef.current) {
            closeConfirmOpenRef.current = true;
            setCloseConfirmOpen(true);
          }
        })
        .then((stopListening) => {
          if (active) {
            unlisten = stopListening;
          } else {
            stopListening();
          }
        })
        .catch(() => {
          if (active) {
            installBrowserFallback();
          }
        });
    } catch {
      installBrowserFallback();
    }

    return () => {
      active = false;
      unlisten?.();
      closeConfirmOpenRef.current = false;
      removeBrowserFallback();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = locale;
    return () => {
      delete document.documentElement.dataset.theme;
      document.documentElement.lang = "";
    };
  }, [locale, theme]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme preference is optional.
    }
  }, [theme]);

  useEffect(() => {
    if (initialised.current) {
      return;
    }
    initialised.current = true;
    void (async () => {
      await settingsLoad.current;
      if (mounted.current) {
        await refreshDevices();
      }
    })();
  }, [refreshDevices]);

  const selectedDevice = devices.find((device) => device.id === selectedId);
  const mutationInProgress = mutationBusy || slots.some((slot) => slot.status === "saving");
  const selectedDirty = selectedState ? isDirty(selectedState) : false;
  const canSave = Boolean(
    selectedState &&
      selectedState.loaded &&
      selectedDirty &&
      connection.connected &&
      !busy &&
      !mutationInProgress,
  );
  const selectedByteLength = selectedState
    ? selectedState.loaded
      ? textByteLength(selectedState.draftText)
      : selectedState.length
    : 0;
  const inputErrorMessage = inputError
    ? translateInputError(inputError, locale)
    : null;
  const settingsErrorMessage = settingsError
    ? typeof settingsError === "string"
      ? translateSettingsValidation(
          settingsError,
          locale,
          MIN_TIMEOUT_MS,
          MAX_TIMEOUT_MS,
          MAX_RETRIES,
        )
      : translateCommandError(settingsError.code, locale)
    : null;

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{copy.appName}</span>
        </div>
        <div className="topbar-actions">
          <div className="connection-summary" aria-live="polite">
            {reconnecting ? (
              <span className="status status-checking">
                <span className="status-dot" aria-hidden="true" /> {copy.statusReconnecting}
              </span>
            ) : checking ? (
              <span className="status status-checking">
                <span className="status-dot" aria-hidden="true" /> {copy.statusChecking}
              </span>
            ) : connection.connected ? (
              <>
                <span className="device-name">
                  {connection.device?.productName ?? copy.runtimeMacroDevice}
                </span>
                <span className="status status-connected">
                  <span className="status-dot" aria-hidden="true" /> {copy.statusConnected}
                </span>
              </>
            ) : (
              <span className="status status-disconnected">
                <span className="status-dot" aria-hidden="true" /> {copy.statusDisconnected}
              </span>
            )}
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void refreshDevices()}
            disabled={busy || mutationInProgress}
            aria-label={connection.connected ? copy.reconnectOrRefresh : copy.reconnectDevice}
          >
            {busy ? "…" : "↻"}
          </button>
          <button
            className={`icon-button ${settingsOpen ? "active" : ""}`}
            type="button"
            onClick={() => {
              setSettingsOpen((open) => !open);
              setSettingsDraft(settings);
              setSettingsError(null);
              setSettingsSaved(false);
            }}
            aria-label={copy.settings}
            aria-expanded={settingsOpen}
          >
            ⚙
          </button>
          <label className="theme-control">
            <span className="sr-only">{copy.theme}</span>
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value as ThemeMode)}
              aria-label={copy.theme}
            >
              <option value="system">{copy.themeSystem}</option>
              <option value="light">{copy.themeLight}</option>
              <option value="dark">{copy.themeDark}</option>
            </select>
          </label>
        </div>
      </header>

      {settingsOpen ? (
        <section className="settings-panel" aria-labelledby="settings-heading">
          <div className="settings-heading">
            <div>
              <p className="eyebrow">{copy.preferences}</p>
              <h2 id="settings-heading">{copy.connectionSettings}</h2>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => setSettingsOpen(false)}
              disabled={settingsBusy}
            >
              {copy.close}
            </button>
          </div>
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={settingsDraft.autoReconnect}
              onChange={(event) =>
                updateSettingsDraft({ autoReconnect: event.target.checked })
              }
              disabled={settingsBusy}
            />
            <span>
              <strong>{copy.autoReconnect}</strong>
              <small>{copy.autoReconnectHelp}</small>
            </span>
          </label>
          <div className="settings-grid">
            <label className="setting-field" htmlFor="language-setting">
              <span>{copy.language}</span>
              <select
                id="language-setting"
                value={languagePreference}
                onChange={updateLanguagePreference}
                disabled={settingsBusy}
              >
                <option value="system">{copy.languageFollowSystem}</option>
                <option value="zh-CN">{copy.languageChinese}</option>
                <option value="en">{copy.languageEnglish}</option>
              </select>
              <small>{copy.languageHelp}</small>
            </label>
            <label className="setting-field" htmlFor="timeout-setting">
              <span>{copy.requestTimeout}</span>
              <input
                id="timeout-setting"
                type="number"
                min={MIN_TIMEOUT_MS}
                max={MAX_TIMEOUT_MS}
                step={1}
                value={Number.isNaN(settingsDraft.timeoutMs) ? "" : settingsDraft.timeoutMs}
                onChange={(event) =>
                  updateSettingsDraft({ timeoutMs: Number(event.target.value) })
                }
                disabled={settingsBusy}
                aria-describedby="settings-help"
              />
              <small>{copy.millisecondsRange(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)}</small>
            </label>
            <label className="setting-field" htmlFor="retries-setting">
              <span>{copy.retries}</span>
              <input
                id="retries-setting"
                type="number"
                min={0}
                max={MAX_RETRIES}
                step={1}
                value={Number.isNaN(settingsDraft.retries) ? "" : settingsDraft.retries}
                onChange={(event) =>
                  updateSettingsDraft({ retries: Number(event.target.value) })
                }
                disabled={settingsBusy}
                aria-describedby="settings-help"
              />
              <small>{copy.transportRetriesRange(MAX_RETRIES)}</small>
            </label>
          </div>
          <p id="settings-help" className="field-help settings-help">
            {copy.settingsHelp}
          </p>
          {settingsErrorMessage ? (
            <p className="field-error" role="alert">{settingsErrorMessage}</p>
          ) : null}
          <div className="settings-actions">
            {settingsSaved ? <span className="settings-saved">{copy.saved}</span> : null}
            <button
              className="button-primary"
              type="button"
              onClick={() => void saveSettings()}
              disabled={settingsBusy}
            >
              {settingsBusy ? copy.saving : copy.saveSettings}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="inline-message message-error" role="alert">
          <span>{translateCommandError(error.code, locale)}</span>
          {!connection.connected ? (
            <button
              className="text-button"
              type="button"
              onClick={() => void refreshDevices()}
              disabled={busy || mutationInProgress}
            >
              {copy.reconnect}
            </button>
          ) : null}
        </div>
      ) : null}

      {!connection.connected ? (
        <section className="device-picker" aria-labelledby="device-picker-heading">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">{copy.connection}</p>
              <h1 id="device-picker-heading">{copy.chooseInterface}</h1>
            </div>
            <span className={`status ${checking ? "status-checking" : "status-disconnected"}`}>
              {checking ? copy.statusChecking : copy.notConnected}
            </span>
          </div>
          {devices.length === 0 ? (
            <p className="muted-copy">
              {checking
                ? copy.checkingCompatibleDevices
                : copy.noCompatibleDevice}
            </p>
          ) : (
            <div className="candidate-list" aria-live="polite">
              {devices.map((device) => (
                <button
                  className={`candidate-row ${selectedId === device.id ? "selected" : ""}`}
                  key={device.id}
                  type="button"
                  onClick={() => setSelectedId(device.id)}
                  disabled={busy || mutationInProgress}
                  aria-pressed={selectedId === device.id}
                >
                  <span className="candidate-copy">
                    <strong>{device.productName ?? copy.unnamedDevice}</strong>
                    <span>
                      {formatHex(device.vendorId)} / {formatHex(device.productId)} · {copy.interfaceNumber(device.interfaceNumber)}
                    </span>
                  </span>
                  <span className="candidate-meta">
                    {device.usageMetadata === "exact" ? copy.runtimeMacro : copy.usageMetadataUnavailable}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="picker-actions">
            <button
              className="button-primary"
              type="button"
              onClick={() => void connectDevice(selectedId)}
              disabled={busy || mutationInProgress || !selectedDevice}
            >
              {copy.connectSelected}
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => void refreshDevices()}
              disabled={busy || mutationInProgress}
            >
              {copy.refresh}
            </button>
          </div>
        </section>
      ) : null}

      <section className="macro-section" aria-labelledby="slots-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{copy.configuration}</p>
            <h1 id="slots-heading">{copy.macroSlots}</h1>
          </div>
          <div className="section-actions">
            <span className="slot-count">{copy.slotCount(slots.length)}</span>
            {connection.device ? (
              <span className="device-detail">
                {formatHex(connection.device.vendorId)} / {formatHex(connection.device.productId)} · {copy.interfaceNumber(connection.device.interfaceNumber)}
              </span>
            ) : null}
            {connection.connected ? (
              <button
                className="text-button"
                type="button"
                onClick={() => void refreshSlots()}
                disabled={busy || mutationInProgress}
              >
                {copy.refreshSlots}
              </button>
            ) : null}
            {connection.connected ? (
              <button
                className="text-button"
                type="button"
                onClick={() => void disconnectDevice()}
                disabled={busy || mutationInProgress}
              >
                {copy.disconnect}
              </button>
            ) : null}
            <button
              className="text-button"
              type="button"
              onClick={() => setDiagnosticsOpen((open) => !open)}
              aria-expanded={diagnosticsOpen}
            >
              {copy.diagnostics}
            </button>
          </div>
        </div>

        {diagnosticsOpen ? (
          <section className="diagnostics-panel" aria-labelledby="diagnostics-heading">
            <div className="diagnostics-heading">
              <div>
                <p className="eyebrow">{copy.diagnostics}</p>
                <h2 id="diagnostics-heading">{copy.connectionDetails}</h2>
              </div>
              <span className={`status ${connection.connected ? "status-connected" : "status-disconnected"}`}>
                {connection.connected ? copy.connected : copy.disconnected}
              </span>
            </div>
            <dl className="diagnostics-grid">
              <div><dt>{copy.protocol}</dt><dd>Runtime Macro v1</dd></div>
              <div><dt>{copy.transport}</dt><dd>USB HID</dd></div>
              <div><dt>{copy.device}</dt><dd>{connection.device?.productName ?? "—"}</dd></div>
              <div><dt>{copy.vidPid}</dt><dd>{connection.device ? `${formatHex(connection.device.vendorId)} / ${formatHex(connection.device.productId)}` : "—"}</dd></div>
              <div><dt>{copy.interface}</dt><dd>{connection.device?.interfaceNumber ?? "—"}</dd></div>
              <div><dt>{copy.usage}</dt><dd>{connection.device ? `${formatHex(connection.device.usagePage)} / ${formatHex(connection.device.usage)}` : "—"}</dd></div>
              <div><dt>{copy.slotCountLabel}</dt><dd>{slots.length}</dd></div>
              <div><dt>{copy.lastOperation}</dt><dd>{lastOperation ?? copy.none}</dd></div>
              <div><dt>{copy.lastErrorCode}</dt><dd>{lastErrorCode ?? copy.none}</dd></div>
            </dl>
            <p className="field-help diagnostics-help">
              {copy.diagnosticsHelp}
            </p>
          </section>
        ) : null}

        <div className="workspace">
          <aside className="slot-list" aria-label={copy.macroSlotsAria}>
            {slots.length === 0 ? (
              <p className="muted-copy slot-list-empty">
                {connection.connected ? copy.noSlotsReturned : copy.connectToLoadSlots}
              </p>
            ) : (
              slots.map((slot) => {
                const dirty = isDirty(slot);
                const displayedLength = slot.loaded ? textByteLength(slot.draftText) : slot.length;
                return (
                  <button
                    className={`slot-row ${selectedSlot === slot.slot ? "selected" : ""}`}
                    key={slot.slot}
                    type="button"
                    onClick={() => selectSlot(slot.slot)}
                    disabled={mutationInProgress}
                    aria-pressed={selectedSlot === slot.slot}
                  >
                    <span className="slot-index">{formatSlotNumber(slot.slot)}</span>
                    <span className="slot-copy">
                      <strong>{slot.draftLabel || defaultLabel(slot.slot, locale)}</strong>
                      <span>{displayedLength === 0 ? copy.empty : copy.bytes(displayedLength)}</span>
                    </span>
                    {dirty ? (
                      <span className="dirty-dot" aria-label={copy.unsavedChanges} />
                    ) : null}
                  </button>
                );
              })
            )}
          </aside>

          <section className="inspector" aria-labelledby="inspector-heading">
            {!selectedState ? (
              <div className="inspector-empty">
                <p className="eyebrow">{copy.inspector}</p>
                <h2 id="inspector-heading">{copy.selectSlot}</h2>
                <p className="muted-copy">{copy.chooseSlotHelp}</p>
              </div>
            ) : (
              <>
                <div className="inspector-heading">
                  <div>
                    <p className="eyebrow">{copy.slotLabel(formatSlotNumber(selectedState.slot))}</p>
                    <h2 id="inspector-heading">{selectedState.draftLabel || defaultLabel(selectedState.slot, locale)}</h2>
                  </div>
                  <span className={`edit-status status-${selectedDirty ? "modified" : selectedState.status}`}>
                    {selectedState.status === "saving"
                      ? copy.saving
                      : selectedState.status === "saved"
                        ? copy.saved
                        : selectedDirty
                          ? copy.unsavedChanges
                          : copy.lastSaved}
                  </span>
                </div>

                <label className="field-label" htmlFor="slot-label">
                  {copy.name}
                </label>
                <input
                  id="slot-label"
                  className="text-input"
                  type="text"
                  value={selectedState.draftLabel}
                  onChange={updateLabel}
                  maxLength={64}
                  disabled={!selectedState.loaded || mutationInProgress}
                  autoComplete="off"
                  placeholder={defaultLabel(selectedState.slot, locale)}
                />
                <p className="field-help">{copy.localLabelHelp}</p>

                <div className="field-heading">
                  <label className="field-label" htmlFor="macro-editor">
                    {copy.macro}
                  </label>
                  <span className="byte-count">{copy.bytes(selectedByteLength)}</span>
                </div>

                {selectedState.loading ? (
                  <div className="editor-placeholder" aria-live="polite">{copy.loadingSlot}</div>
                ) : selectedState.error && selectedState.lastAction === "load" ? (
                  <div className="editor-placeholder editor-error" role="alert">
                    <span>{translateCommandError(selectedState.error.code, locale)}</span>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => retrySlotAction(selectedState)}
                      disabled={busy || mutationInProgress || !connection.connected}
                    >
                      {copy.retry}
                    </button>
                  </div>
                ) : !selectedState.revealed && selectedState.draftText.length === 0 ? (
                  <div className="empty-editor">
                    <p>{copy.noMacroConfigured}</p>
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={addMacro}
                      disabled={!selectedState.loaded || mutationInProgress || !connection.connected}
                    >
                      {copy.addMacro}
                    </button>
                  </div>
                ) : (
                  <div className={`editor-shell ${selectedState.revealed ? "revealed" : "masked"}`}>
                    <textarea
                      id="macro-editor"
                      ref={editorRef}
                      className="macro-editor"
                      value={selectedState.revealed ? toEditorText(selectedState.draftText) : maskText(selectedState.draftText)}
                      onChange={(event) => updateEditor(event.target.value)}
                      onKeyDown={handleEditorKeyDown}
                      readOnly={!selectedState.revealed || mutationInProgress || !connection.connected}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label={copy.macroContent}
                      aria-describedby="macro-help"
                    />
                    <button
                      className="reveal-button"
                      type="button"
                      onClick={() => {
                        setInputError(null);
                        updateSelectedSlot((slot) => ({ ...slot, revealed: !slot.revealed }));
                      }}
                      disabled={mutationInProgress || !connection.connected}
                      aria-label={selectedState.revealed ? copy.hideMacroContent : copy.revealMacroContent}
                      aria-pressed={selectedState.revealed}
                    >
                      {selectedState.revealed ? copy.hide : copy.reveal}
                    </button>
                  </div>
                )}
                <p id="macro-help" className="field-help control-help">
                  {copy.macroControlHelp}
                </p>
                {selectedState.revealed ? (
                  <div className="control-actions" aria-label={copy.insertControlCharacter}>
                    <button className="text-button" type="button" onClick={() => insertControlToken("↵")} disabled={mutationInProgress || !connection.connected}>{copy.insertLf}</button>
                    <button className="text-button" type="button" onClick={() => insertControlToken("⇥")} disabled={mutationInProgress || !connection.connected}>{copy.insertTab}</button>
                    <button className="text-button" type="button" onClick={() => insertControlToken("⌫")} disabled={mutationInProgress || !connection.connected}>{copy.insertBackspace}</button>
                  </div>
                ) : null}
                {inputErrorMessage ? <p className="field-error" role="alert">{inputErrorMessage}</p> : null}

                {selectedState.error && selectedState.lastAction !== "load" ? (
                  <div className="inline-message message-error slot-error" role="alert">
                    <span>{translateCommandError(selectedState.error.code, locale)}</span>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => retrySlotAction(selectedState)}
                      disabled={busy || mutationInProgress || !connection.connected}
                    >
                      {copy.retry}
                    </button>
                  </div>
                ) : null}

                <div className="inspector-actions">
                  <div className="secondary-actions">
                    <button
                      className="button-danger"
                      type="button"
                      onClick={() => setClearConfirm(selectedState.slot)}
                      disabled={
                        !connection.connected ||
                        !selectedState.loaded ||
                        selectedByteLength === 0 ||
                        mutationInProgress
                      }
                    >
                      {copy.clearMacro}
                    </button>
                  </div>
                  <button
                    className="button-primary"
                    type="button"
                    onClick={() => void saveSlot()}
                    disabled={!canSave}
                  >
                    {selectedState.status === "saving" ? copy.saving : copy.save}
                  </button>
                </div>

                {clearConfirm === selectedState.slot ? (
                  <div className="confirm-row" role="alert">
                    <span>{copy.clearThisMacro}</span>
                    <button className="button-secondary" type="button" onClick={() => setClearConfirm(null)} disabled={mutationInProgress}>{copy.cancel}</button>
                    <button className="button-danger filled" type="button" onClick={() => void clearSlot(selectedState.slot)} disabled={mutationInProgress}>{copy.clear}</button>
                  </div>
                ) : null}

                {!connection.connected ? (
                  <p className="disconnect-note">{copy.disconnectNote}</p>
                ) : null}
              </>
            )}
          </section>
        </div>
      </section>

      {closeConfirmOpen ? (
        <div className="modal-backdrop">
          <section
            className="close-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-dialog-title"
            aria-describedby="close-dialog-message"
          >
            <p className="eyebrow">{copy.closeUnsavedTitle}</p>
            <h2 id="close-dialog-title">{copy.closeUnsavedTitle}</h2>
            <p id="close-dialog-message" className="muted-copy">
              {copy.closeUnsavedMessage}
            </p>
            <div className="dialog-actions">
              <button
                className="button-secondary"
                type="button"
                onClick={cancelCloseRequest}
                autoFocus
              >
                {copy.cancel}
              </button>
              <button
                className="button-danger filled"
                type="button"
                onClick={closeWithoutSaving}
              >
                {copy.closeWithoutSaving}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
