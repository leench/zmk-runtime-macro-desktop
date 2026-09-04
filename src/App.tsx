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
  asCommandError,
  clearSlot as clearSlotCommand,
  connectDevice as connectDeviceCommand,
  disconnectDevice as disconnectDeviceCommand,
  getConnection,
  getSlot,
  listDevices,
  listSlots,
  setSlot as setSlotCommand,
} from "./bridge";
import type {
  CommandError,
  ConnectedDevice,
  ConnectionState,
  DeviceCandidate,
  SlotBytes,
  SlotMetadata,
} from "./bridge";
import "./App.css";

type ThemeMode = "system" | "light" | "dark";
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

const disconnected: ConnectionState = { connected: false, device: null };
const MAX_TEXT_BYTES = 256;
const LABELS_STORAGE_PREFIX = "zmk-runtime-macro-labels:v1";
const THEME_STORAGE_KEY = "zmk-runtime-macro-theme:v1";
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

function defaultLabel(slot: number): string {
  return `Slot ${formatSlotNumber(slot)}`;
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
  | { text: null; error: string } {
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
      error:
        "Macro text supports printable US ASCII, LF, Tab, and Backspace only.",
    };
  }

  if (textByteLength(text) > MAX_TEXT_BYTES) {
    return {
      text: null,
      error: "Macro text cannot exceed 256 bytes.",
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
  const label = labels[metadata.slot] ?? defaultLabel(metadata.slot);
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

function errorMessage(error: CommandError): string {
  if (error.code === "storage_error") {
    return "Applied for this session, but could not be saved permanently.";
  }
  return error.message;
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
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
  const [inputError, setInputError] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState<number | null>(null);

  const operation = useRef(0);
  const lastDevice = useRef<ConnectedDevice | null>(null);
  const dirtyRef = useRef(false);
  const slotRequest = useRef(0);
  const mounted = useRef(false);
  const initialised = useRef(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const mutationRequest = useRef(0);

  dirtyRef.current = slots.some(isDirty);

  const isCurrent = useCallback((sequence: number) => {
    return mounted.current && operation.current === sequence;
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
      const metadata = await listSlots();
      if (!isCurrent(sequence)) {
        return;
      }
      applySlotList(metadata, nextLabels, preserveDirtyDrafts);
    },
    [applySlotList, isCurrent, labels],
  );

  const connectDevice = useCallback(
    async (id: string, existingSequence?: number) => {
      const sequence = existingSequence ?? ++operation.current;
      const ownsBusyState = existingSequence === undefined;
      if (ownsBusyState) {
        setBusy(true);
        setChecking(true);
        setError(null);
      }
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
        }
      } catch (caught) {
        if (isCurrent(sequence)) {
          setError(asCommandError(caught));
          setConnection(disconnected);
        }
      } finally {
        if (ownsBusyState && isCurrent(sequence)) {
          setBusy(false);
          setChecking(false);
        }
      }
    },
    [isCurrent, loadSlots],
  );

  const refreshDevices = useCallback(async () => {
    const sequence = ++operation.current;
    setBusy(true);
    setChecking(true);
    setError(null);

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
            setConnection(disconnected);
            setSlots((previous) =>
              previous.map((slot) =>
                slot.revealed ? { ...slot, revealed: false } : slot,
              ),
            );
            setError(asCommandError(caught));
          }
          return;
        }
      }

      const exactDevices = nextDevices.filter(
        (device) => device.usageMetadata === "exact",
      );
      if (!nextConnection.connected && exactDevices.length === 1) {
        await connectDevice(exactDevices[0].id, sequence);
      }
    } catch (caught) {
      if (isCurrent(sequence)) {
        setError(asCommandError(caught));
      }
    } finally {
      if (isCurrent(sequence)) {
        setBusy(false);
        setChecking(false);
      }
    }
  }, [connectDevice, isCurrent, loadSlots]);

  const disconnectDevice = useCallback(async () => {
    const sequence = ++operation.current;
    setBusy(true);
    setError(null);
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
        setError(asCommandError(caught));
      }
    } finally {
      if (isCurrent(sequence)) {
        setBusy(false);
      }
    }
  }, [isCurrent]);

  const refreshSlots = useCallback(async () => {
    const sequence = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      await loadSlots(sequence);
    } catch (caught) {
      if (isCurrent(sequence)) {
        setError(asCommandError(caught));
        setConnection(disconnected);
        setSlots((previous) =>
          previous.map((slot) =>
            slot.revealed ? { ...slot, revealed: false } : slot,
          ),
        );
      }
    } finally {
      if (isCurrent(sequence)) {
        setBusy(false);
      }
    }
  }, [isCurrent, loadSlots]);

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
        const commandError = asCommandError(caught);
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
                      error: commandError,
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
        setError(commandError);
      }
    },
    [isCurrent, selectedSlot],
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
        setInputError(parsed.error ?? "Macro text could not be parsed.");
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
        setInputError(parsed.error ?? "Macro text could not be parsed.");
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
        const commandError = asCommandError(caught);
        setConnection(disconnected);
        setError(commandError);
        setSlots((previous) =>
          previous.map((item) =>
            item.slot === slotNumber
              ? {
                  ...item,
                  revealed: false,
                  status: "error",
                  error: commandError,
                  lastAction: "save",
                }
              : item,
          ),
        );
      } finally {
        if (mounted.current && mutationRequest.current === request) {
          setMutationBusy(false);
        }
      }
    },
    [connection, labels, mutationBusy, selectedSlot, slots],
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
        const commandError = asCommandError(caught);
        setConnection(disconnected);
        setError(commandError);
        setSlots((previous) =>
          previous.map((item) =>
            item.slot === slotNumber
              ? {
                  ...item,
                  revealed: false,
                  status: "error",
                  error: commandError,
                  lastAction: "clear",
                }
              : item,
          ),
        );
      } finally {
        if (mounted.current && mutationRequest.current === request) {
          setMutationBusy(false);
        }
      }
    },
    [connection.connected, mutationBusy, slots],
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
        const confirmed = window.confirm(
          "This slot has unsaved changes. Switch slots anyway?",
        );
        if (!confirmed) {
          return;
        }
      }
      slotRequest.current += 1;
      setSelectedSlot(slotNumber);
      setClearConfirm(null);
      setInputError(null);
    },
    [mutationBusy, selectedSlot, slots],
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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
          if (
            dirtyRef.current &&
            !window.confirm("This window has unsaved changes. Close anyway?")
          ) {
            event.preventDefault();
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
      removeBrowserFallback();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

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
    void refreshDevices();
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

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">ZMK Runtime Macro</span>
        </div>
        <div className="topbar-actions">
          <div className="connection-summary" aria-live="polite">
            {checking ? (
              <span className="status status-checking">
                <span className="status-dot" aria-hidden="true" /> Checking device…
              </span>
            ) : connection.connected ? (
              <>
                <span className="device-name">
                  {connection.device?.productName ?? "Runtime Macro device"}
                </span>
                <span className="status status-connected">
                  <span className="status-dot" aria-hidden="true" /> Connected
                </span>
              </>
            ) : (
              <span className="status status-disconnected">
                <span className="status-dot" aria-hidden="true" /> Device disconnected
              </span>
            )}
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void refreshDevices()}
            disabled={busy || mutationInProgress}
            aria-label={connection.connected ? "Reconnect or refresh device" : "Reconnect device"}
          >
            {busy ? "…" : "↻"}
          </button>
          <label className="theme-control">
            <span className="sr-only">Theme</span>
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value as ThemeMode)}
              aria-label="Theme"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </header>

      {error ? (
        <div className="inline-message message-error" role="alert">
          <span>{errorMessage(error)}</span>
          {!connection.connected ? (
            <button
              className="text-button"
              type="button"
              onClick={() => void refreshDevices()}
              disabled={busy || mutationInProgress}
            >
              Reconnect
            </button>
          ) : null}
        </div>
      ) : null}

      {!connection.connected ? (
        <section className="device-picker" aria-labelledby="device-picker-heading">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Connection</p>
              <h1 id="device-picker-heading">Choose a Runtime Macro interface</h1>
            </div>
            <span className={`status ${checking ? "status-checking" : "status-disconnected"}`}>
              {checking ? "Checking device…" : "Not connected"}
            </span>
          </div>
          {devices.length === 0 ? (
            <p className="muted-copy">
              {checking
                ? "Checking for compatible Runtime Macro devices…"
                : "No compatible Runtime Macro device found."}
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
                    <strong>{device.productName ?? "Unnamed device"}</strong>
                    <span>
                      {formatHex(device.vendorId)} / {formatHex(device.productId)} · Interface {device.interfaceNumber}
                    </span>
                  </span>
                  <span className="candidate-meta">
                    {device.usageMetadata === "exact" ? "Runtime Macro" : "Usage metadata unavailable"}
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
              Connect selected
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => void refreshDevices()}
              disabled={busy || mutationInProgress}
            >
              Refresh
            </button>
          </div>
        </section>
      ) : null}

      <section className="macro-section" aria-labelledby="slots-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Configuration</p>
            <h1 id="slots-heading">Macro Slots</h1>
          </div>
          <div className="section-actions">
            <span className="slot-count">{slots.length} slots</span>
            {connection.device ? (
              <span className="device-detail">
                {formatHex(connection.device.vendorId)} / {formatHex(connection.device.productId)} · Interface {connection.device.interfaceNumber}
              </span>
            ) : null}
            {connection.connected ? (
              <button
                className="text-button"
                type="button"
                onClick={() => void refreshSlots()}
                disabled={busy || mutationInProgress}
              >
                Refresh slots
              </button>
            ) : null}
            {connection.connected ? (
              <button
                className="text-button"
                type="button"
                onClick={() => void disconnectDevice()}
                disabled={busy || mutationInProgress}
              >
                Disconnect
              </button>
            ) : null}
          </div>
        </div>

        <div className="workspace">
          <aside className="slot-list" aria-label="Macro slots">
            {slots.length === 0 ? (
              <p className="muted-copy slot-list-empty">
                {connection.connected ? "The device returned no slots." : "Connect a device to load slots."}
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
                      <strong>{slot.draftLabel || defaultLabel(slot.slot)}</strong>
                      <span>{displayedLength === 0 ? "Empty" : `${displayedLength} bytes`}</span>
                    </span>
                    {dirty ? (
                      <span className="dirty-dot" aria-label="Unsaved changes" />
                    ) : null}
                  </button>
                );
              })
            )}
          </aside>

          <section className="inspector" aria-labelledby="inspector-heading">
            {!selectedState ? (
              <div className="inspector-empty">
                <p className="eyebrow">Inspector</p>
                <h2 id="inspector-heading">Select a slot</h2>
                <p className="muted-copy">Choose a slot to view and edit its macro.</p>
              </div>
            ) : (
              <>
                <div className="inspector-heading">
                  <div>
                    <p className="eyebrow">Slot {formatSlotNumber(selectedState.slot)}</p>
                    <h2 id="inspector-heading">{selectedState.draftLabel || defaultLabel(selectedState.slot)}</h2>
                  </div>
                  <span className={`edit-status status-${selectedDirty ? "modified" : selectedState.status}`}>
                    {selectedState.status === "saving"
                      ? "Saving…"
                      : selectedState.status === "saved"
                        ? "✓ Saved"
                        : selectedDirty
                          ? "● Unsaved changes"
                          : "Last saved"}
                  </span>
                </div>

                <label className="field-label" htmlFor="slot-label">
                  Name
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
                />
                <p className="field-help">Local label · not written to the keyboard</p>

                <div className="field-heading">
                  <label className="field-label" htmlFor="macro-editor">
                    Macro
                  </label>
                  <span className="byte-count">{selectedByteLength} bytes</span>
                </div>

                {selectedState.loading ? (
                  <div className="editor-placeholder" aria-live="polite">Loading slot…</div>
                ) : selectedState.error && selectedState.lastAction === "load" ? (
                  <div className="editor-placeholder editor-error" role="alert">
                    <span>{errorMessage(selectedState.error)}</span>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => retrySlotAction(selectedState)}
                      disabled={busy || mutationInProgress || !connection.connected}
                    >
                      Retry
                    </button>
                  </div>
                ) : !selectedState.revealed && selectedState.draftText.length === 0 ? (
                  <div className="empty-editor">
                    <p>No macro configured</p>
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={addMacro}
                      disabled={!selectedState.loaded || mutationInProgress || !connection.connected}
                    >
                      Add macro
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
                      aria-label="Macro content"
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
                      aria-label={selectedState.revealed ? "Hide macro content" : "Reveal macro content"}
                      aria-pressed={selectedState.revealed}
                    >
                      {selectedState.revealed ? "Hide" : "Reveal"}
                    </button>
                  </div>
                )}
                <p id="macro-help" className="field-help control-help">
                  Reveal to edit. Enter inserts ↵ · Tab inserts ⇥ · use the button below for ⌫.
                </p>
                {selectedState.revealed ? (
                  <div className="control-actions" aria-label="Insert control character">
                    <button className="text-button" type="button" onClick={() => insertControlToken("↵")} disabled={mutationInProgress || !connection.connected}>Insert LF</button>
                    <button className="text-button" type="button" onClick={() => insertControlToken("⇥")} disabled={mutationInProgress || !connection.connected}>Insert Tab</button>
                    <button className="text-button" type="button" onClick={() => insertControlToken("⌫")} disabled={mutationInProgress || !connection.connected}>Insert Backspace</button>
                  </div>
                ) : null}
                {inputError ? <p className="field-error" role="alert">{inputError}</p> : null}

                {selectedState.error && selectedState.lastAction !== "load" ? (
                  <div className="inline-message message-error slot-error" role="alert">
                    <span>{errorMessage(selectedState.error)}</span>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => retrySlotAction(selectedState)}
                      disabled={busy || mutationInProgress || !connection.connected}
                    >
                      Retry
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
                      Clear macro…
                    </button>
                  </div>
                  <button
                    className="button-primary"
                    type="button"
                    onClick={() => void saveSlot()}
                    disabled={!canSave}
                  >
                    {selectedState.status === "saving" ? "Saving…" : "Save"}
                  </button>
                </div>

                {clearConfirm === selectedState.slot ? (
                  <div className="confirm-row" role="alert">
                    <span>Clear this macro?</span>
                    <button className="button-secondary" type="button" onClick={() => setClearConfirm(null)} disabled={mutationInProgress}>Cancel</button>
                    <button className="button-danger filled" type="button" onClick={() => void clearSlot(selectedState.slot)} disabled={mutationInProgress}>Clear</button>
                  </div>
                ) : null}

                {!connection.connected ? (
                  <p className="disconnect-note">Device disconnected. Your unsaved changes remain in memory.</p>
                ) : null}
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

export default App;
