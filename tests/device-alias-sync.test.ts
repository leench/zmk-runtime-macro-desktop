import assert from "node:assert/strict";
import { test } from "node:test";
import { setDeviceAliases } from "../src/bridge.ts";
import { normalizeDeviceAliasStore } from "../src/utils/device-alias.ts";

/**
 * Frontend half of the local HTTP API alias contract.
 *
 * The loopback API resolves a device by the alias the user gave it on this
 * machine, so the window mirrors the same validated map into the backend. The
 * mirror stays a local preference and never becomes a device channel: only the
 * safe five-part device summary key and the alias may travel, never a HID path,
 * a serial number, a discovered candidate id or macro text. These checks pin the
 * command name, the single bounded payload object and the fact that a stored map
 * cannot smuggle an unsafe key into the mirror. They never open HID and never
 * touch a device.
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

test("the alias mirror sends one bounded payload to the backend", async () => {
  const host = installFakeTauriHost();
  try {
    const store = { "4660:22136:2:65376:97": "Work keyboard" };
    await setDeviceAliases(store);

    assert.equal(host.calls.length, 1);
    const [call] = host.calls;
    assert.equal(call.cmd, "set_device_aliases");
    // The whole map travels as the command's single `aliases` argument, so the
    // IPC contract stays one object instead of one call per device.
    assert.deepEqual(call.args, { aliases: store });
  } finally {
    host.restore();
  }
});

test("an empty alias map is still mirrored instead of being skipped", async () => {
  const host = installFakeTauriHost();
  try {
    await setDeviceAliases({});
    // Clearing the last alias must reach the backend, otherwise a stale name
    // would stay resolvable in the API.
    assert.deepEqual(host.calls, [{ cmd: "set_device_aliases", args: { aliases: {} } }]);
  } finally {
    host.restore();
  }
});

test("no alias data is fabricated outside a desktop host", async () => {
  // The App only mirrors the map behind its Tauri check, so a browser preview
  // must not end up with a resolved mirror: without Tauri internals the bridge
  // rejects and the call site stays silent.
  await assert.rejects(() => setDeviceAliases({ "4660:22136:2:65376:97": "Work keyboard" }));
});

test("only safe device summary keys can reach the mirror", () => {
  // A hand-edited or outdated store may contain a HID path, a serial-like value
  // or an unusable alias; normalization drops those entries, so the mirrored map
  // can only carry the five-part safe key and a bounded, control-free name.
  const normalized = normalizeDeviceAliasStore({
    "4660:22136:2:65376:97": "Work keyboard",
    "/dev/hidraw3": "Leaked path",
    "01:23:45:67:89:ab": "Leaked serial",
    "4660:22136:3:65376:97": "with\nnewline",
    "4660:22136:4:65376:97": "场".repeat(40),
  });

  assert.deepEqual(normalized, { "4660:22136:2:65376:97": "Work keyboard" });
  for (const key of Object.keys(normalized)) {
    assert.match(key, /^-?\d+(:-?\d+){4}$/);
  }
  const mirrored = JSON.stringify({ aliases: normalized });
  for (const forbidden of ["hidraw", "01:23:45:67:89:ab", "newline"]) {
    assert.ok(!mirrored.includes(forbidden), `mirror contains ${forbidden}`);
  }
});
