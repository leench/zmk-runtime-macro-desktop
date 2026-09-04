import { useCallback, useEffect, useRef, useState } from "react";
import {
  asCommandError,
  connectDevice as connectDeviceCommand,
  disconnectDevice as disconnectDeviceCommand,
  getConnection,
  listDevices,
  listSlots,
} from "./bridge";
import type {
  CommandError,
  ConnectionState,
  DeviceCandidate,
  SlotMetadata,
} from "./bridge";
import "./App.css";

const disconnected: ConnectionState = { connected: false, device: null };

function formatHex(value: number): string {
  return `0x${value.toString(16).padStart(4, "0")}`;
}

function App() {
  const [devices, setDevices] = useState<DeviceCandidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [connection, setConnection] = useState<ConnectionState>(disconnected);
  const [slots, setSlots] = useState<SlotMetadata[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);

  const operation = useRef(0);
  const mounted = useRef(false);
  const initialised = useRef(false);

  const isCurrent = useCallback((sequence: number) => {
    return mounted.current && operation.current === sequence;
  }, []);

  const loadSlots = useCallback(
    async (sequence: number) => {
      const nextSlots = await listSlots();
      if (!isCurrent(sequence)) {
        return;
      }
      setSlots(nextSlots);
    },
    [isCurrent],
  );

  const connectDevice = useCallback(
    async (id: string, existingSequence?: number) => {
      const sequence = existingSequence ?? ++operation.current;
      if (!existingSequence) {
        setBusy(true);
        setError(null);
      }
      setSelectedId(id);

      try {
        const nextConnection = await connectDeviceCommand(id);
        if (!isCurrent(sequence)) {
          return;
        }
        setConnection(nextConnection);
        await loadSlots(sequence);
        if (isCurrent(sequence)) {
          setError(null);
        }
      } catch (caught) {
        if (isCurrent(sequence)) {
          setError(asCommandError(caught));
          setConnection(disconnected);
          setSlots([]);
        }
      } finally {
        if (isCurrent(sequence)) {
          setBusy(false);
        }
      }
    },
    [isCurrent, loadSlots],
  );

  const refreshDevices = useCallback(async () => {
    const sequence = ++operation.current;
    setBusy(true);
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
        setSlots([]);
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
      }
    }
  }, [connectDevice, isCurrent]);

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
      setSlots([]);
      setSelectedId("");
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
        setSlots([]);
      }
    } finally {
      if (isCurrent(sequence)) {
        setBusy(false);
      }
    }
  }, [isCurrent, loadSlots]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (initialised.current) {
      return;
    }
    initialised.current = true;
    void refreshDevices();
  }, [refreshDevices]);

  const selectedDevice = devices.find((device) => device.id === selectedId);

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">ZMK Runtime Macro</p>
          <h1>Device connection</h1>
        </div>
        <button type="button" onClick={() => void refreshDevices()} disabled={busy}>
          {busy ? "Working…" : "Refresh devices"}
        </button>
      </header>

      {error ? (
        <div className="error" role="alert">
          <strong>{error.code}</strong>
          <span>{error.message}</span>
        </div>
      ) : null}

      <section className="panel connection-panel" aria-labelledby="connection-heading">
        <div className="panel-heading">
          <div>
            <h2 id="connection-heading">Connection</h2>
            <p>Choose a Runtime Macro HID interface. Device paths and serial numbers are hidden.</p>
          </div>
          <span className={`status ${connection.connected ? "connected" : "disconnected"}`}>
            {connection.connected ? "Connected" : "Not connected"}
          </span>
        </div>

        {connection.device ? (
          <div className="device-summary">
            <strong>{connection.device.productName ?? "Unnamed device"}</strong>
            <span>
              VID {formatHex(connection.device.vendorId)} · PID {formatHex(connection.device.productId)} ·
              interface {connection.device.interfaceNumber}
            </span>
          </div>
        ) : null}

        <div className="candidate-list" aria-live="polite">
          {devices.length === 0 ? (
            <p className="empty">No compatible Runtime Macro HID candidates found.</p>
          ) : (
            devices.map((device) => (
              <button
                className={`candidate ${selectedId === device.id ? "selected" : ""}`}
                key={device.id}
                type="button"
                onClick={() => setSelectedId(device.id)}
                disabled={busy}
                aria-pressed={selectedId === device.id}
              >
                <span className="candidate-name">
                  {device.productName ?? "Unnamed device"}
                </span>
                <span className="candidate-details">
                  VID {formatHex(device.vendorId)} · PID {formatHex(device.productId)} · interface {device.interfaceNumber}
                </span>
                <span className="candidate-usage">
                  {device.usageMetadata === "exact"
                    ? `Usage ${formatHex(device.usagePage)} / ${formatHex(device.usage)}`
                    : "Usage metadata unavailable"}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="actions">
          <button
            type="button"
            onClick={() => void connectDevice(selectedId)}
            disabled={busy || !selectedDevice || connection.connected}
          >
            Connect selected
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => void disconnectDevice()}
            disabled={busy || !connection.connected}
          >
            Disconnect
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="slots-heading">
        <div className="panel-heading">
          <div>
            <h2 id="slots-heading">Slots</h2>
            <p>Metadata from LIST. Slot content is not read in this stage.</p>
          </div>
          <button
            className="secondary"
            type="button"
            onClick={() => void refreshSlots()}
            disabled={busy || !connection.connected}
          >
            Refresh slots
          </button>
        </div>
        {!connection.connected ? (
          <p className="empty">Connect a device to load slot metadata.</p>
        ) : slots.length === 0 ? (
          <p className="empty">The device returned no slots.</p>
        ) : (
          <ul className="slot-list">
            {slots.map((slot) => (
              <li key={slot.slot}>
                <span>Slot {slot.slot}</span>
                <strong>{slot.length} bytes</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
