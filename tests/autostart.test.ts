import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTOSTART_FAILED,
  AUTOSTART_UNAVAILABLE,
  autostartAvailable,
  disableAutostart,
  enableAutostart,
  getAutostartEnabled,
  type CommandError,
} from "../src/bridge.ts";
import { getMessages, translateCommandError } from "../src/i18n.ts";
import {
  AUTOSTART_LOADING_VIEW,
  AUTOSTART_UNSUPPORTED_VIEW,
  autostartPendingView,
  autostartResultView,
  autostartStatusKind,
  autostartToggleEnabled,
} from "../src/utils/autostart.ts";

/**
 * Frontend half of the login-autostart contract.
 *
 * Autostart is an operating-system entry owned by the official Tauri plugin. The
 * app has one local rule about it: it only ever shows a state the operating
 * system confirmed, and it never registers the entry on its own. These checks pin
 * the plugin commands, the absence of any payload, the sanitized failures and the
 * state transitions of the settings row. They never touch a real autostart entry,
 * a device or HID.
 */

type InvokeCall = { cmd: string; args: Record<string, unknown> };

/** Records the Tauri IPC calls of a fake host and answers each one. */
function installFakeTauriHost(respond: (cmd: string) => unknown = () => undefined): {
  calls: InvokeCall[];
  restore: () => void;
} {
  const calls: InvokeCall[] = [];
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        calls.push({ cmd, args });
        // The real IPC is an async function, so a synchronous handler failure
        // reaches the caller as a rejection, exactly like a real plugin failure.
        return Promise.resolve().then(() => respond(cmd));
      },
    },
  };
  return {
    calls,
    restore: () => {
      (globalThis as { window?: unknown }).window = previous;
    },
  };
}

function failed(error = { code: AUTOSTART_FAILED, message: "sanitized" }): CommandError {
  return error;
}

const ENABLED_VIEW = autostartResultView(AUTOSTART_LOADING_VIEW, { ok: true, enabled: true });
const DISABLED_VIEW = autostartResultView(AUTOSTART_LOADING_VIEW, { ok: true, enabled: false });

test("no autostart state is fabricated outside a desktop host", async () => {
  // A browser preview has no operating-system entry to read or change, so every
  // call reports that instead of inventing a state or a success.
  assert.equal(autostartAvailable(), false);
  for (const call of [
    () => getAutostartEnabled(),
    () => enableAutostart(),
    () => disableAutostart(),
  ]) {
    await assert.rejects(call, (error: CommandError) => {
      assert.equal(error.code, AUTOSTART_UNAVAILABLE);
      assert.equal(typeof error.message, "string");
      return true;
    });
  }
});

test("the wrappers call exactly the three plugin commands", async () => {
  const host = installFakeTauriHost(() => true);
  try {
    assert.equal(autostartAvailable(), true);
    assert.equal(await getAutostartEnabled(), true);
    await enableAutostart();
    await disableAutostart();

    assert.deepEqual(
      host.calls.map((call) => call.cmd),
      ["plugin:autostart|is_enabled", "plugin:autostart|enable", "plugin:autostart|disable"],
    );
    // The login entry is written to a file or a registry value on this machine,
    // and the call itself carries no payload at all: no password, no macro text,
    // no serial number and no HID path can travel through it.
    for (const call of host.calls) {
      assert.deepEqual(Object.keys(call.args), [], `${call.cmd} must send no arguments`);
    }
  } finally {
    host.restore();
  }
});

test("a read reports the state the operating system returned", async () => {
  for (const enabled of [true, false]) {
    const host = installFakeTauriHost(() => enabled);
    try {
      assert.equal(await getAutostartEnabled(), enabled);
      assert.equal(host.calls.length, 1);
    } finally {
      host.restore();
    }
  }
});

test("a plugin failure is sanitized and never echoes operating-system text", async () => {
  const host = installFakeTauriHost(() => {
    throw new Error("could not write /home/private/.config/autostart/zmk-runtime-macro.desktop");
  });
  try {
    for (const call of [
      () => getAutostartEnabled(),
      () => enableAutostart(),
      () => disableAutostart(),
    ]) {
      await assert.rejects(call, (error: CommandError) => {
        assert.equal(error.code, AUTOSTART_FAILED);
        assert.equal(error.message.includes("/home/"), false);
        assert.equal(error.message.includes("autostart/"), false);
        return true;
      });
    }
  } finally {
    host.restore();
  }
});

test("the row only shows a state the operating system confirmed", () => {
  assert.equal(autostartStatusKind(AUTOSTART_UNSUPPORTED_VIEW), "unavailable");
  assert.equal(autostartStatusKind(AUTOSTART_LOADING_VIEW), "unknown");
  assert.equal(autostartStatusKind(ENABLED_VIEW), "enabled");
  assert.equal(autostartStatusKind(DISABLED_VIEW), "disabled");

  // A failed read stays unknown: it is never presented as "off".
  const failedRead = autostartResultView(AUTOSTART_LOADING_VIEW, { ok: false, error: failed() });
  assert.equal(failedRead.enabled, null);
  assert.equal(autostartStatusKind(failedRead), "unknown");
  assert.equal(failedRead.error?.code, AUTOSTART_FAILED);
  assert.equal(failedRead.supported, true);
});

test("a rejected change keeps the previous state and only adds the error", () => {
  const rejected = autostartResultView(ENABLED_VIEW, { ok: false, error: failed() });
  assert.equal(rejected.enabled, true);
  assert.equal(rejected.busy, false);
  assert.equal(autostartStatusKind(rejected), "enabled");

  // The next confirmed read replaces both the state and the error.
  const backToOff = autostartResultView(rejected, { ok: true, enabled: false });
  assert.equal(backToOff.enabled, false);
  assert.equal(backToOff.error, null);
  assert.equal(autostartStatusKind(backToOff), "disabled");
});

test("the toggle is only offered with a known state and nothing in flight", () => {
  assert.equal(autostartToggleEnabled(AUTOSTART_UNSUPPORTED_VIEW), false);
  assert.equal(autostartToggleEnabled(AUTOSTART_LOADING_VIEW), false);
  assert.equal(autostartToggleEnabled(DISABLED_VIEW), true);
  assert.equal(autostartToggleEnabled(ENABLED_VIEW), true);
  // Reading or writing disables it, and a pending change clears an old error
  // without dropping the state it started from.
  const pending = autostartPendingView(autostartResultView(DISABLED_VIEW, { ok: false, error: failed() }));
  assert.equal(autostartToggleEnabled(pending), false);
  assert.equal(pending.error, null);
  assert.equal(pending.enabled, false);
});

test("both locales translate the autostart error codes", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const fallback = getMessages(locale).operationFailed;
    for (const code of [AUTOSTART_UNAVAILABLE, AUTOSTART_FAILED]) {
      const message = translateCommandError(code, locale);
      assert.notEqual(message, fallback, `${code} is not translated for ${locale}`);
      assert.ok(message.length > 0);
    }
  }
});
