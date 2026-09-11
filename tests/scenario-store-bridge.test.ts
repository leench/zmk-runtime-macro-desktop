import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCENARIO_STORE_SCHEMA_VERSION,
  asCommandError,
  loadScenarios,
  saveScenarios,
} from "../src/bridge.ts";
import type { PersistedScenario, ScenarioStore } from "../src/bridge.ts";

/**
 * Frontend half of the Scenario store contract.
 *
 * The persisted model is deliberately not the UI presentation model: drafts,
 * `isNew` and React keys stay in memory, and the targets are opaque aliases or
 * object ids. These checks never touch HID, a Tauri host or a real file.
 */
const sampleScenario: PersistedScenario = {
  id: "opaque-desktop-id",
  name: "Abstract sample",
  text: "abstract text\n",
  ttlSeconds: 300,
  keepAfterExecute: true,
  targetDevice: null,
  targetObject: "object-alpha",
};

test("store schema version is fixed at 1", () => {
  assert.equal(SCENARIO_STORE_SCHEMA_VERSION, 1);
});

test("persisted scenarios carry only the on-disk fields", () => {
  const keys = Object.keys(sampleScenario).sort();
  assert.deepEqual(keys, [
    "id",
    "keepAfterExecute",
    "name",
    "targetDevice",
    "targetObject",
    "text",
    "ttlSeconds",
  ]);
  for (const uiOnly of ["draft", "saved", "isNew", "targetObjectId"]) {
    assert.ok(!keys.includes(uiOnly), `${uiOnly} must not be persisted`);
  }
  // Targets are nullable opaque strings, never numeric wire slots.
  assert.equal(typeof (sampleScenario.targetObject ?? ""), "string");
  assert.equal(sampleScenario.targetDevice, null);
});

test("loadScenarios never fabricates an empty store outside a Tauri host", async () => {
  await assert.rejects(() => loadScenarios());
});

test("saveScenarios never reports a successful write outside a Tauri host", async () => {
  const store: ScenarioStore = {
    schemaVersion: SCENARIO_STORE_SCHEMA_VERSION,
    scenarios: [sampleScenario],
  };
  await assert.rejects(() => saveScenarios(store));
});

test("store failures surface as sanitized command errors", () => {
  for (const code of [
    "scenario_store_corrupt",
    "scenario_store_invalid",
    "scenario_store_write_failed",
    "scenario_store_unavailable",
  ]) {
    const error = asCommandError({ code, message: "sanitized" });
    assert.equal(error.code, code);
    assert.equal(error.message, "sanitized");
  }
  // Anything that is not a backend command error must not leak through.
  assert.equal(asCommandError(new Error("abstract")).code, "unknown_error");
});
