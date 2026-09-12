import assert from "node:assert/strict";
import { test } from "node:test";
import { getConnection, getDynamicState, listDevices } from "../src/bridge.ts";
import { normalizeDeviceAliasStore } from "../src/utils/device-alias.ts";
import { backendSessionReport, backendSessionSync } from "../src/utils/session-sync.ts";

/**
 * Frontend half of the backend-driven session sync.
 *
 * A completed local API write opens (or reuses) the shared HID session outside
 * the window and then notifies it with one payload-free event, so the window
 * re-reads the authoritative connection answer itself. These checks pin what that
 * answer may contain, which of the window's own states it may replace, and that a
 * re-read no window can perform never invents a connection, a device or a
 * release. They never open HID, never reach a device and never carry macro text.
 */

/** One complete, body-free connection answer for a connected device. */
const CONNECTED_ANSWER = {
  connected: true,
  device: {
    vendorId: 4660,
    productId: 22136,
    productName: "Keyboard",
    interfaceNumber: 2,
    usagePage: 65376,
    usage: 97,
    usageMetadata: "exact",
  },
  authState: "authenticated",
} as const;

/** Safe summary key of the device in [`CONNECTED_ANSWER`]. */
const DEVICE_KEY = "4660:22136:2:65376:97";

/** The same device on another interface: a different summary key. */
const OTHER_DEVICE_KEY = "4660:22136:3:65376:97";

/** Field names that would mean a body, a device identity or a HID path leaked. */
const FORBIDDEN_KEYS = [
  "text",
  "draftText",
  "path",
  "devicePath",
  "serial",
  "serialNumber",
  "deviceId",
  "candidateId",
  "alias",
  "slot",
  "handles",
  "session",
  "password",
  "token",
  "raw",
] as const;

test("a complete connection answer is reduced to the safe summary key", () => {
  assert.deepEqual(backendSessionReport(CONNECTED_ANSWER), { connected: true, deviceKey: DEVICE_KEY });
  assert.deepEqual(backendSessionReport({ ...CONNECTED_ANSWER, authState: "locked" }), {
    connected: true,
    deviceKey: DEVICE_KEY,
  });
  // Every state the window renders is accepted, because the window shows it.
  for (const authState of ["open", "locked", "authenticated", "credentialInvalid"]) {
    assert.equal(backendSessionReport({ ...CONNECTED_ANSWER, authState })?.deviceKey, DEVICE_KEY);
  }
  // A closed session states no device.
  assert.deepEqual(backendSessionReport({ connected: false, device: null, authState: "disconnected" }), {
    connected: false,
    deviceKey: null,
  });
});

test("an answer the window cannot render is refused instead of guessed", () => {
  for (const answer of [
    undefined,
    null,
    "connected",
    3,
    true,
    [],
    {},
    { connected: true },
    { connected: "true", device: null, authState: "disconnected" },
    { connected: false, device: null },
    { connected: false, device: null, authState: "unlocked" },
    { connected: false, device: null, authState: null },
    { ...CONNECTED_ANSWER, authState: "unlocked" },
    { ...CONNECTED_ANSWER, device: null },
    { ...CONNECTED_ANSWER, device: {} },
    { ...CONNECTED_ANSWER, device: { ...CONNECTED_ANSWER.device, usage: "97" } },
    { ...CONNECTED_ANSWER, device: { ...CONNECTED_ANSWER.device, vendorId: 4660.5 } },
    { ...CONNECTED_ANSWER, device: { ...CONNECTED_ANSWER.device, productName: 3 } },
    { ...CONNECTED_ANSWER, device: { ...CONNECTED_ANSWER.device, usageMetadata: "unknown" } },
  ]) {
    assert.equal(backendSessionReport(answer), null, JSON.stringify(answer));
  }

  // A device without the full safe summary cannot be compared with the session the
  // window shows, so it is not usable either.
  for (const part of ["vendorId", "productId", "interfaceNumber", "usagePage", "usage"]) {
    const device: Record<string, unknown> = { ...CONNECTED_ANSWER.device };
    delete device[part];
    assert.equal(backendSessionReport({ ...CONNECTED_ANSWER, device }), null, part);
  }
});

test("a connection answer that carries a body, a path or a device identity is refused", () => {
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(
      backendSessionReport({ ...CONNECTED_ANSWER, [key]: "secret" }),
      null,
      `top level ${key} must be refused`,
    );
    assert.equal(
      backendSessionReport({ ...CONNECTED_ANSWER, device: { ...CONNECTED_ANSWER.device, [key]: "secret" } }),
      null,
      `device ${key} must be refused`,
    );
    // Nested anywhere, including inside a list the window would have to walk.
    assert.equal(backendSessionReport({ ...CONNECTED_ANSWER, extra: [{ nested: { [key]: "secret" } }] }), null, key);
  }
});

test("a session the window already shows is refreshed, not re-opened", () => {
  // The window shows the same device: the local API reused the session, so the
  // window keeps its slots (a draft cannot be dropped by a refresh) and follows
  // the management state the backend reports.
  assert.deepEqual(
    backendSessionSync({
      reported: { connected: true, deviceKey: DEVICE_KEY },
      shownConnected: true,
      shownDeviceKey: DEVICE_KEY,
      hasDirtyDraft: true,
    }),
    { kind: "adopt", deviceKey: DEVICE_KEY, preserveDraft: true },
  );
});

test("a session the window did not show is adopted, and a draft of the same device survives", () => {
  // The exact case the notification exists for: the local API opened the session
  // while the window still showed "not connected". Adopting it keeps the user from
  // starting a second connection that would drop the object the API just wrote.
  assert.deepEqual(
    backendSessionSync({
      reported: { connected: true, deviceKey: DEVICE_KEY },
      shownConnected: false,
      shownDeviceKey: DEVICE_KEY,
      hasDirtyDraft: false,
    }),
    { kind: "adopt", deviceKey: DEVICE_KEY, preserveDraft: true },
  );
  // Two connections in a row: one was released, the same device comes back.
  assert.deepEqual(
    backendSessionSync({
      reported: { connected: true, deviceKey: DEVICE_KEY },
      shownConnected: false,
      shownDeviceKey: null,
      hasDirtyDraft: false,
    }),
    { kind: "adopt", deviceKey: DEVICE_KEY, preserveDraft: false },
  );
});

test("a session of another device is never taken over silently", () => {
  assert.deepEqual(
    backendSessionSync({
      reported: { connected: true, deviceKey: OTHER_DEVICE_KEY },
      shownConnected: true,
      shownDeviceKey: DEVICE_KEY,
      hasDirtyDraft: false,
    }),
    { kind: "hold", reason: "otherDevice" },
  );
  // A device switch must not drop an unsaved draft: the user's own switch keeps
  // that decision.
  assert.deepEqual(
    backendSessionSync({
      reported: { connected: true, deviceKey: OTHER_DEVICE_KEY },
      shownConnected: false,
      shownDeviceKey: DEVICE_KEY,
      hasDirtyDraft: true,
    }),
    { kind: "hold", reason: "draft" },
  );
});

test("a session the backend no longer has is dropped, and an unreadable answer changes nothing", () => {
  // Device unplugged or transport failure: the view of the session goes, the
  // drafts in memory stay.
  assert.deepEqual(
    backendSessionSync({
      reported: { connected: false, deviceKey: null },
      shownConnected: true,
      shownDeviceKey: DEVICE_KEY,
      hasDirtyDraft: true,
    }),
    { kind: "release" },
  );
  // Both sides agree that no session is open: nothing to do.
  assert.deepEqual(
    backendSessionSync({
      reported: { connected: false, deviceKey: null },
      shownConnected: false,
      shownDeviceKey: DEVICE_KEY,
      hasDirtyDraft: true,
    }),
    { kind: "none" },
  );

  // An answer the window cannot read is never read as "opened" or "released".
  for (const shownConnected of [true, false]) {
    assert.deepEqual(
      backendSessionSync({ reported: null, shownConnected, shownDeviceKey: DEVICE_KEY, hasDirtyDraft: false }),
      { kind: "hold", reason: "unreadableAnswer" },
    );
  }
  // A connected answer without a device key is unusable as well.
  assert.deepEqual(
    backendSessionSync({
      reported: { connected: true, deviceKey: null },
      shownConnected: false,
      shownDeviceKey: DEVICE_KEY,
      hasDirtyDraft: false,
    }),
    { kind: "hold", reason: "unreadableAnswer" },
  );
});

test("the adopted device key is the same safe key the candidate list and the alias map use", () => {
  const report = backendSessionReport(CONNECTED_ANSWER);
  assert.deepEqual(report, { connected: true, deviceKey: DEVICE_KEY });
  const deviceKey = report!.deviceKey!;

  // The session view, the discovery candidate list and the local alias map name a
  // device by the same five-part safe key, so a session the window adopts is a row
  // it can select and a device the local API can resolve by alias.
  assert.match(deviceKey, /^-?\d+(:-?\d+){4}$/);
  assert.deepEqual(normalizeDeviceAliasStore({ [deviceKey]: "Work keyboard" }), {
    [DEVICE_KEY]: "Work keyboard",
  });
  // Anything that is not that key — a HID path, a serial-like value — is dropped,
  // so no key shape but the safe summary can enter either map.
  assert.deepEqual(normalizeDeviceAliasStore({ "/dev/hidraw0": "Work keyboard" }), {});
  assert.deepEqual(normalizeDeviceAliasStore({ "01:23:45:67:89:ab": "Work keyboard" }), {});
});

test("the re-read uses the existing body-free commands and sends no input", async () => {
  const host = installFakeTauriHost();
  try {
    host.result = CONNECTED_ANSWER;
    const answer = await getConnection();
    // The window reads the connection through the command it already uses; the
    // answer is what the sync validates before acting on it.
    assert.deepEqual(host.calls[0], { cmd: "get_connection", args: {} });
    assert.deepEqual(Object.keys(answer!).sort(), ["authState", "connected", "device"]);

    await listDevices();
    assert.deepEqual(host.calls[1], { cmd: "list_devices", args: {} });

    await getDynamicState();
    assert.deepEqual(host.calls[2], { cmd: "get_dynamic_state", args: {} });

    // No command takes a device, a slot or any text, so the re-read cannot carry
    // one to the backend either.
    for (const call of host.calls) {
      assert.deepEqual(call.args, {}, call.cmd);
    }
  } finally {
    host.restore();
  }
});

test("without a desktop host the sync cannot fabricate a session", async () => {
  // The App only syncs behind its Tauri check; without Tauri internals every read
  // the sync depends on rejects, so a browser preview never invents a connection.
  await assert.rejects(() => getConnection());
  await assert.rejects(() => listDevices());
  await assert.rejects(() => getDynamicState());
});

/** Records the Tauri IPC calls of a fake host and answers each one. */
function installFakeTauriHost(): {
  calls: { cmd: string; args: Record<string, unknown> }[];
  result: unknown;
  restore: () => void;
} {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const host = {
    calls,
    result: {} as unknown,
    restore: () => {
      (globalThis as { window?: unknown }).window = previous;
    },
  };
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        calls.push({ cmd, args });
        return Promise.resolve(host.result);
      },
    },
  };
  return host;
}
