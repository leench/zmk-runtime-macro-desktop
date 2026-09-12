import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_STATES,
  DYNAMIC_STATE_CHANGED_EVENT,
  isAuthState,
  prepareTrayClose,
  subscribeDynamicStateChanged,
  trayCloseOutcome,
  type TrayCloseState,
} from "../src/bridge.ts";

/**
 * Frontend half of the backend-driven session lifecycle.
 *
 * A completed local API write notifies the window through one payload-free
 * event, and a close-to-tray keeps a session the local API used. These checks
 * pin the event name, prove that nothing but the notification itself travels
 * through the event, prove that the browser preview neither subscribes nor
 * invents a close result, and keep the close-to-tray answer body-free.
 *
 * They never open HID, never reach a device and never carry macro text.
 */

/** Keys the close-to-tray answer may expose to the window. */
const CLOSE_STATE_KEYS = ["authState", "sessionRetained"] as const;

/** Keys that would mean a body, a device identifier or a HID path leaked. */
const FORBIDDEN_KEYS = [
  "text",
  "draftText",
  "scenarioText",
  "path",
  "devicePath",
  "serial",
  "serialNumber",
  "deviceId",
  "device",
  "candidateId",
  "alias",
  "deviceAlias",
  "slot",
  "handles",
  "session",
  "password",
  "token",
  "raw",
] as const;

test("the state-change event name is the stable backend event", () => {
  assert.equal(DYNAMIC_STATE_CHANGED_EVENT, "dynamic-state-changed");
  // It is not one of the other global events the window already listens to.
  assert.notEqual(DYNAMIC_STATE_CHANGED_EVENT, "tray-action");
});

test("the state-change listener forwards the notification and reads no payload", async () => {
  const host = installFakeTauriHost();
  const received: number[] = [];
  try {
    const unlisten = await subscribeDynamicStateChanged((...args) => received.push(args.length));
    assert.equal(host.calls[0].cmd, "plugin:event|listen");
    assert.equal(host.calls[0].args.event, DYNAMIC_STATE_CHANGED_EVENT);
    assert.equal(host.listeners.length, 1);

    const deliver = host.listeners[0];
    // The handler is called with nothing at all, whatever the event carries: the
    // window refetches the body-free state itself instead of trusting an event.
    for (const payload of [
      undefined,
      null,
      {},
      { text: "git status" },
      { path: "/dev/hidraw0" },
      { serial: "XYZ" },
      { deviceAlias: "Work keyboard", slot: 3 },
      "text",
      3,
    ]) {
      deliver({ event: DYNAMIC_STATE_CHANGED_EVENT, id: 1, payload });
    }
    assert.deepEqual(received, [0, 0, 0, 0, 0, 0, 0, 0, 0]);

    await unlisten();
    assert.equal(host.calls.at(-1)?.cmd, "plugin:event|unlisten");
  } finally {
    host.restore();
  }

  // Without a host nothing is registered, so a browser preview cannot pretend a
  // backend-side change happened.
  await assert.rejects(() => subscribeDynamicStateChanged(() => undefined));
});

test("prepareTrayClose sends no argument and passes the body-free answer through", async () => {
  const host = installFakeTauriHost();
  try {
    host.result = { sessionRetained: true, authState: "locked" };
    const retained = await prepareTrayClose();
    assert.equal(host.calls[0].cmd, "prepare_tray_close");
    // The command takes no input: no alias, no slot, no text can be sent.
    assert.deepEqual(Object.keys(host.calls[0].args), []);
    assert.deepEqual(retained, { sessionRetained: true, authState: "locked" });
    assert.deepEqual(Object.keys(retained).sort(), [...CLOSE_STATE_KEYS]);

    // A released session reports exactly the same two fields.
    host.result = { sessionRetained: false, authState: "disconnected" };
    const released: TrayCloseState = await prepareTrayClose();
    assert.deepEqual(released, { sessionRetained: false, authState: "disconnected" });
    assert.deepEqual(Object.keys(released).sort(), [...CLOSE_STATE_KEYS]);

    // The bridge adds nothing of its own, so no field can smuggle a body.
    for (const key of Object.keys(released)) {
      assert.ok(
        !FORBIDDEN_KEYS.includes(key as (typeof FORBIDDEN_KEYS)[number]),
        `${key} must not be part of the close-to-tray answer`,
      );
    }
  } finally {
    host.restore();
  }

  // A browser preview must not end up with a fabricated close result.
  await assert.rejects(() => prepareTrayClose());
});

test("the close-to-tray answer is only acted on when it is complete", () => {
  // The two body-free shapes the backend contract defines: a retained session
  // reports the management state, a released one reports nothing else.
  assert.deepEqual(trayCloseOutcome({ sessionRetained: true, authState: "locked" }), {
    sessionRetained: true,
    authState: "locked",
  });
  assert.deepEqual(trayCloseOutcome({ sessionRetained: false, authState: "disconnected" }), {
    sessionRetained: false,
  });

  // Everything else is unknown. Acting on it would show a released session as
  // retained, or drop the local view of a session the backend still holds, so
  // the window has to re-read the authoritative state instead of guessing.
  for (const answer of [
    undefined,
    null,
    "retained",
    3,
    true,
    [],
    {},
    { sessionRetained: true },
    { authState: "locked" },
    { sessionRetained: "true", authState: "locked" },
    { sessionRetained: 1, authState: "locked" },
    { sessionRetained: true, authState: "unlocked" },
    { sessionRetained: true, authState: null },
    { sessionRetained: true, authState: { text: "git status" } },
    { sessionRetained: true, authState: { path: "/dev/hidraw0" } },
    { sessionRetained: true, authState: "locked", text: "git status" },
    { sessionRetained: false, authState: "disconnected", deviceId: "opaque" },
    // A value from another command must not be read as a close answer either.
    { connected: true, authState: "locked" },
    { sessionRetained: false, authState: { retained: true } },
  ]) {
    assert.equal(trayCloseOutcome(answer), null, JSON.stringify(answer));
  }
});

test("a retained close answer only carries a management state the window renders", () => {
  assert.deepEqual(
    [...AUTH_STATES].sort(),
    ["authenticated", "credentialInvalid", "disconnected", "locked", "open"],
  );
  for (const state of AUTH_STATES) {
    assert.equal(isAuthState(state), true);
    // A released answer ignores the management state; the shape stays exact.
    assert.deepEqual(trayCloseOutcome({ sessionRetained: false, authState: state }), {
      sessionRetained: false,
    });
    assert.deepEqual(trayCloseOutcome({ sessionRetained: true, authState: state }), {
      sessionRetained: true,
      authState: state,
    });
  }

  // A state the window cannot render is not accepted as a management state.
  for (const value of ["unlocked", "", "Authenticated", null, 3, {}, undefined]) {
    assert.equal(isAuthState(value), false, String(value));
  }
});

/** Records the Tauri IPC calls and the raw event listeners of a fake host. */
function installFakeTauriHost(): {
  calls: { cmd: string; args: Record<string, unknown> }[];
  listeners: ((event: unknown) => void)[];
  result: unknown;
  restore: () => void;
} {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const listeners: ((event: unknown) => void)[] = [];
  const host = {
    calls,
    listeners,
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
      transformCallback: (handler: (event: unknown) => void) => {
        listeners.push(handler);
        return listeners.length;
      },
    },
    // The event helper unregisters its callback through this global first.
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener: () => undefined,
    },
  };
  return host;
}
