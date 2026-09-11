import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEVICE_ALIAS_STORAGE_KEY,
  MAX_DEVICE_ALIAS_BYTES,
  deviceAliasError,
  deviceAliasFor,
  deviceAliasOwner,
  normalizeDeviceAlias,
  normalizeDeviceAliasStore,
  readDeviceAliasStore,
  setDeviceAlias,
  writeDeviceAliasStore,
} from "../src/utils/device-alias.ts";
import type { DeviceAliasStore } from "../src/utils/device-alias.ts";
import { SCENARIO_NAME_LIMIT_BYTES } from "../src/utils/scenario.ts";

/**
 * Local device aliases.
 *
 * An alias is a local display name bound to one safe device summary key. These
 * checks pin the bound, the uniqueness rule and the fact that nothing is
 * inherited across summary keys or written outside the browser storage. They
 * never touch HID, a device or a Tauri host.
 */

/** Two safe device summary keys, as `deviceSummaryKey` produces them. */
const KEY_A = "1234:5678:1:65440:97";
const KEY_B = "1234:5678:2:65440:97";

function installFakeLocalStorage(): { values: Map<string, string>; restore: () => void } {
  const values = new Map<string, string>();
  const host = globalThis as { localStorage?: unknown };
  const previous = host.localStorage;
  host.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
  return {
    values,
    restore: () => {
      if (previous === undefined) delete host.localStorage;
      else host.localStorage = previous;
    },
  };
}

test("the alias bound matches the scenario name bound used by the store", () => {
  // One bound everywhere: what the settings editor accepts must be storable with
  // a Scenario and displayable in the native tray menu.
  assert.equal(MAX_DEVICE_ALIAS_BYTES, SCENARIO_NAME_LIMIT_BYTES);
});

test("an alias is trimmed, bounded in bytes and control-free", () => {
  assert.equal(deviceAliasError(""), null);
  assert.equal(deviceAliasError("   "), null);
  assert.equal(deviceAliasError("Work keyboard"), null);
  assert.equal(deviceAliasError("   Work keyboard   "), null);
  assert.equal(deviceAliasError("Keyboard 1 (USB)"), null);
  assert.equal(deviceAliasError("n".repeat(MAX_DEVICE_ALIAS_BYTES)), null);
  assert.equal(deviceAliasError("n".repeat(MAX_DEVICE_ALIAS_BYTES + 1)), "tooLong");
  // The bound is in bytes, exactly like the native menu bound, so a multi-byte
  // alias that fits in characters is still refused when it does not fit bytes.
  assert.equal(deviceAliasError("场".repeat(21)), null);
  assert.equal(deviceAliasError("场".repeat(22)), "tooLong");
  for (const rejected of [
    "name\nwith-newline",
    "name\twith-tab",
    "control\u{7f}",
    "c1\u{9f}",
    "nul\u{0}",
    "bell\u{7}",
  ]) {
    assert.equal(deviceAliasError(rejected), "controlCharacter", JSON.stringify(rejected));
  }

  assert.equal(normalizeDeviceAlias(""), null);
  assert.equal(normalizeDeviceAlias("   "), null);
  assert.equal(normalizeDeviceAlias("  Work  "), "Work");
});

test("an alias is stored per safe device summary key and never inherited", () => {
  const empty: DeviceAliasStore = {};
  assert.equal(deviceAliasFor(empty, KEY_A), null);
  assert.equal(deviceAliasFor(empty, null), null);

  const applied = setDeviceAlias(empty, KEY_A, "Work keyboard");
  assert.ok(applied.ok);
  assert.equal(applied.alias, "Work keyboard");
  assert.equal(deviceAliasFor(applied.store, KEY_A), "Work keyboard");
  // Another device (or the same device on another interface/usage) has its own
  // key and therefore no alias of its own.
  assert.equal(deviceAliasFor(applied.store, KEY_B), null);
  assert.equal(deviceAliasFor(applied.store, "9999:8888:1:65440:97"), null);
  // Applying is immutable: the caller's store is untouched.
  assert.deepEqual(empty, {});

  // Emptying the draft clears exactly that entry and keeps the others.
  const withTwo = setDeviceAlias(applied.store, KEY_B, "Second keyboard");
  assert.ok(withTwo.ok);
  const cleared = setDeviceAlias(withTwo.store, KEY_A, "   ");
  assert.ok(cleared.ok);
  assert.equal(cleared.alias, null);
  assert.deepEqual(cleared.store, { [KEY_B]: "Second keyboard" });
  assert.equal(deviceAliasFor(cleared.store, KEY_A), null);
  assert.equal(deviceAliasFor(cleared.store, KEY_B), "Second keyboard");
});

test("aliases are unique on this machine", () => {
  const first = setDeviceAlias({}, KEY_A, "Work keyboard");
  assert.ok(first.ok);
  assert.equal(deviceAliasOwner(first.store, "Work keyboard", KEY_A), null);
  assert.equal(deviceAliasOwner(first.store, "Work keyboard", KEY_B), KEY_A);

  const duplicate = setDeviceAlias(first.store, KEY_B, "Work keyboard");
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.error, "duplicate");
  // The refused draft changes nothing: the first device keeps the name and the
  // second device has no alias.
  assert.deepEqual(first.store, { [KEY_A]: "Work keyboard" });

  // Trimming happens before the comparison, so a padded duplicate is refused as
  // well, while the same device may re-save its own alias.
  assert.ok(!setDeviceAlias(first.store, KEY_B, "  Work keyboard  ").ok);
  const renamed = setDeviceAlias(first.store, KEY_A, "Main keyboard");
  assert.ok(renamed.ok);
  assert.deepEqual(renamed.store, { [KEY_A]: "Main keyboard" });

  // An invalid draft is reported with its own reason.
  const tooLong = setDeviceAlias(first.store, KEY_B, "n".repeat(MAX_DEVICE_ALIAS_BYTES + 1));
  assert.ok(!tooLong.ok);
  assert.equal(tooLong.error, "tooLong");
  const control = setDeviceAlias(first.store, KEY_B, "bad\nalias");
  assert.ok(!control.ok);
  assert.equal(control.error, "controlCharacter");
});

test("a stored alias map keeps only well-formed entries", () => {
  assert.deepEqual(normalizeDeviceAliasStore(null), {});
  assert.deepEqual(normalizeDeviceAliasStore("text"), {});
  assert.deepEqual(normalizeDeviceAliasStore([KEY_A]), {});
  assert.deepEqual(
    normalizeDeviceAliasStore({
      [KEY_A]: "Work keyboard",
      [KEY_B]: "  Spaced  ",
      // Not a summary key, or not a usable alias: dropped instead of repaired.
      "not-a-key": "Work keyboard",
      "/dev/hidraw3": "Path",
      [`${KEY_A}:`]: "Extra",
      "9999:8888:1:65440:97": "n".repeat(MAX_DEVICE_ALIAS_BYTES + 1),
      "1111:2222:1:65440:97": "bad\nalias",
      "3333:4444:1:65440:97": "",
      "5555:6666:1:65440:97": 5,
      "7777:8888:1:65440:97": null,
    }),
    { [KEY_A]: "Work keyboard", [KEY_B]: "Spaced" },
  );
});

test("reads and writes outside a browser host are safe no-ops", () => {
  // Node has no localStorage: a preview must not throw and must not fabricate an
  // alias for a device.
  assert.deepEqual(readDeviceAliasStore(), {});
  assert.doesNotThrow(() => writeDeviceAliasStore({ [KEY_A]: "Work keyboard" }));
});

test("the alias map round-trips through browser storage and survives bad data", () => {
  const host = installFakeLocalStorage();
  try {
    writeDeviceAliasStore({ [KEY_A]: "Work keyboard" });
    assert.equal(host.values.has(DEVICE_ALIAS_STORAGE_KEY), true);
    assert.deepEqual(readDeviceAliasStore(), { [KEY_A]: "Work keyboard" });

    // Damaged JSON and a store with unusable entries both resolve to what is
    // still valid instead of throwing.
    host.values.set(DEVICE_ALIAS_STORAGE_KEY, "{ not json");
    assert.deepEqual(readDeviceAliasStore(), {});
    host.values.set(DEVICE_ALIAS_STORAGE_KEY, JSON.stringify({ [KEY_A]: "bad\nalias" }));
    assert.deepEqual(readDeviceAliasStore(), {});
  } finally {
    host.restore();
  }

  // Without the host again, nothing is read or written.
  assert.deepEqual(readDeviceAliasStore(), {});
});
