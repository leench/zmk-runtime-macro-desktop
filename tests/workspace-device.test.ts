import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCENARIO_STORE_SCHEMA_VERSION,
  type DynamicCapabilities,
  type DynamicServiceState,
  type PersistedScenario,
  type ScenarioStore,
} from "../src/bridge.ts";
import type { Scenario, ScenarioFields } from "../src/types/scenario.ts";
import {
  capabilityPresentationFromBackend,
  createScenario,
  createSerialRunner,
  editScenario,
  emptyScenarioFields,
  isScenarioDirty,
  newScenarioId,
  objectWireSlot,
  observationFromServiceState,
  planScenarioSave,
  saveScenario,
  scenarioFromPersisted,
  scenariosFromStore,
  serviceDeviceState,
  storeBlockers,
  storeFromScenarios,
  targetMatchesCapability,
} from "../src/utils/scenario.ts";

/**
 * Pure checks for the device-backed Dynamic workspace.
 *
 * They cover the mapping between the real backend contract and the workspace
 * model: capability -> presentation objects with an explicit wire slot, service
 * state -> local observation, persisted store <-> UI scenarios, and the local
 * save plan. Nothing here opens HID, calls a Tauri command or writes a file.
 */

function capabilities(overrides: Partial<DynamicCapabilities> = {}): DynamicCapabilities {
  return {
    capabilityVersion: 2,
    dynamicObjectCount: 8,
    lifecycleFlags: 0,
    maxDynamicLength: 512,
    defaultTtlSeconds: 300,
    minTtlSeconds: 1,
    maxTtlSeconds: 86_400,
    transactionTimeoutSeconds: 30,
    clearOnBoot: true,
    clearOnTtlExpiry: true,
    clearOnExecutionAccept: true,
    clearOnUsbDisconnect: false,
    clearOnBleProfileChange: false,
    clearOnSelectedEndpointChange: false,
    supportsKeepAfterExecute: true,
    ...overrides,
  };
}

function serviceState(overrides: Partial<DynamicServiceState> = {}): DynamicServiceState {
  return {
    status: "ready",
    capabilities: capabilities(),
    generation: 1,
    objects: [],
    error: null,
    ...overrides,
  };
}

function persisted(overrides: Partial<PersistedScenario> = {}): PersistedScenario {
  return {
    id: "scenario-a",
    name: "Work terminal",
    text: "git status\n",
    ttlSeconds: 60,
    keepAfterExecute: true,
    targetDevice: "device-alias",
    targetObject: "dynamic-object-2",
    ...overrides,
  };
}

test("the reported capability drives object count, limits and keep support", () => {
  assert.equal(capabilityPresentationFromBackend(null), null);

  const single = capabilityPresentationFromBackend(capabilities({ dynamicObjectCount: 1, maxDynamicLength: 128 }));
  assert.ok(single);
  assert.equal(single.objects.length, 1);
  assert.equal(single.objects[0].wireSlot, 0);
  assert.equal(single.objects[0].maxLength, 128);
  assert.deepEqual(single.objects[0].ttl, { defaultSeconds: 300, minSeconds: 1, maxSeconds: 86_400 });
  assert.equal(single.objects[0].supportsKeepAfterExecute, true);

  const eight = capabilityPresentationFromBackend(capabilities({ supportsKeepAfterExecute: false }));
  assert.ok(eight);
  assert.equal(eight.objects.length, 8);
  assert.deepEqual(eight.objects.map((object) => object.wireSlot), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(eight.objects.map((object) => object.objectId), [
    "dynamic-object-0",
    "dynamic-object-1",
    "dynamic-object-2",
    "dynamic-object-3",
    "dynamic-object-4",
    "dynamic-object-5",
    "dynamic-object-6",
    "dynamic-object-7",
  ]);
  assert.equal(eight.objects[3].supportsKeepAfterExecute, false);
  // A capability that reports no object count produces no target at all, so the
  // UI can never invent one.
  assert.deepEqual(capabilityPresentationFromBackend(capabilities({ dynamicObjectCount: 0 }))?.objects, []);
  assert.equal(eight.lifecycle.clearOnBoot, true);
  assert.equal(eight.lifecycle.clearOnUsbDisconnect, false);
});

test("an object is addressed by its mapped wire slot, never by its id", () => {
  const capability = capabilityPresentationFromBackend(capabilities());
  assert.ok(capability);
  for (const object of capability.objects) {
    assert.equal(objectWireSlot(capability, object.objectId), object.wireSlot);
  }
  // A persisted target that the current capability does not report resolves to
  // no slot instead of a guessed one, even when the id looks like a slot.
  assert.equal(objectWireSlot(capability, "dynamic-object-9"), null);
  assert.equal(objectWireSlot(capability, "9"), null);
  assert.equal(objectWireSlot(capability, null), null);
  assert.equal(objectWireSlot(null, "dynamic-object-0"), null);

  // The same id maps onto a different slot when the device ordering differs.
  const shifted = capabilityPresentationFromBackend(capabilities({ dynamicObjectCount: 1 }));
  assert.ok(shifted);
  assert.equal(objectWireSlot(shifted, "dynamic-object-7"), null);
});

test("a target is accepted only when its id maps onto the requested wire slot", () => {
  const eight = capabilities();
  for (let slot = 0; slot < eight.dynamicObjectCount; slot += 1) {
    assert.equal(targetMatchesCapability(eight, `dynamic-object-${slot}`, slot), true);
    // The same id with another slot is a mismatch, not a remap.
    const other = (slot + 1) % eight.dynamicObjectCount;
    assert.equal(targetMatchesCapability(eight, `dynamic-object-${slot}`, other), false);
  }
  // An id the capability does not report never resolves to a slot, even when it
  // looks like a slot number or like a preview fixture id.
  for (const foreign of ["dynamic-object-9", "dynamic-object-99", "9", "object-1", "", "dynamic-object--1"]) {
    assert.equal(targetMatchesCapability(eight, foreign, 0), false);
    assert.equal(targetMatchesCapability(eight, foreign, 3), false);
  }
  // Without a reported capability nothing can be addressed at all.
  assert.equal(targetMatchesCapability(null, "dynamic-object-0", 0), false);
  assert.equal(targetMatchesCapability(capabilities({ dynamicObjectCount: 0 }), "dynamic-object-0", 0), false);
  // A device reporting fewer objects rejects the higher slots.
  const single = capabilities({ dynamicObjectCount: 1 });
  assert.equal(targetMatchesCapability(single, "dynamic-object-0", 0), true);
  assert.equal(targetMatchesCapability(single, "dynamic-object-7", 7), false);
});

test("service state maps onto the workspace observation without a readback", () => {
  const target = { objectId: "dynamic-object-2", wireSlot: 2 };
  const withObject = (status: DynamicServiceState["objects"][number]["status"]): DynamicServiceState =>
    serviceState({ objects: [{ slot: 2, status, textLength: null, ttlSeconds: null, keepAfterExecute: false }] });

  assert.deepEqual(observationFromServiceState(null, target), { status: "none", targetObjectId: null, errorKind: null });
  assert.deepEqual(observationFromServiceState(serviceState(), target), { status: "none", targetObjectId: null, errorKind: null });
  assert.deepEqual(observationFromServiceState(withObject("unknown"), target), { status: "none", targetObjectId: null, errorKind: null });
  assert.deepEqual(observationFromServiceState(withObject("uploading"), target), { status: "uploading", targetObjectId: target.objectId, errorKind: null });
  assert.deepEqual(observationFromServiceState(withObject("committedLocally"), target), { status: "committed", targetObjectId: target.objectId, errorKind: null });
  assert.deepEqual(observationFromServiceState(withObject("clearing"), target), { status: "clearing", targetObjectId: target.objectId, errorKind: null });
  assert.deepEqual(observationFromServiceState(withObject("clearedLocally"), target), { status: "cleared", targetObjectId: target.objectId, errorKind: null });

  const failure = serviceState({
    status: "error",
    objects: [{ slot: 2, status: "error", textLength: null, ttlSeconds: null, keepAfterExecute: false }],
    error: { code: "timeout", message: "The HID device did not respond in time." },
  });
  assert.deepEqual(observationFromServiceState(failure, target), { status: "error", targetObjectId: target.objectId, errorKind: "timeout" });
  assert.deepEqual(
    observationFromServiceState({ ...failure, error: { code: "dynamic_unsupported", message: "" } }, target),
    { status: "error", targetObjectId: target.objectId, errorKind: "unsupported" },
  );
  assert.deepEqual(
    observationFromServiceState({ ...failure, error: { code: "transport_error", message: "" } }, target),
    { status: "error", targetObjectId: target.objectId, errorKind: "interrupted" },
  );
  // A committed observation never claims an error, and a status without an
  // observation is not reported as one.
  assert.deepEqual(
    observationFromServiceState(serviceState({
      objects: [{ slot: 2, status: "committedLocally", textLength: 11, ttlSeconds: null, keepAfterExecute: false }],
      error: { code: "timeout", message: "" },
    }), target),
    { status: "committed", targetObjectId: target.objectId, errorKind: null },
  );
  assert.deepEqual(observationFromServiceState(serviceState({ status: "unknown", error: null }), target), { status: "none", targetObjectId: null, errorKind: null });
});

test("an operation on another object is not reported as this target's result", () => {
  const target = { objectId: "dynamic-object-5", wireSlot: 5 };
  const other = serviceState({
    status: "committedLocally",
    objects: [{ slot: 2, status: "committedLocally", textLength: 11, ttlSeconds: 60, keepAfterExecute: false }],
  });
  assert.deepEqual(observationFromServiceState(other, target), { status: "none", targetObjectId: null, errorKind: null });
  // Without a resolved target the service-level status is the only fact left.
  assert.deepEqual(observationFromServiceState(other, null), { status: "committed", targetObjectId: null, errorKind: null });
});

test("the workspace device state follows the connection and capability status", () => {
  assert.equal(serviceDeviceState(false, "ready"), "disconnected");
  assert.equal(serviceDeviceState(false, "unknown"), "disconnected");
  assert.equal(serviceDeviceState(true, "ready"), "ready");
  assert.equal(serviceDeviceState(true, "discovering"), "discovering");
  assert.equal(serviceDeviceState(true, "unsupported"), "unsupported");
  // A reconnect or a failed capability exchange is an unknown state, never a
  // silent success.
  assert.equal(serviceDeviceState(true, "unknown"), "unknown");
  assert.equal(serviceDeviceState(true, "error"), "unknown");
});

test("a loaded scenario is clean and keeps its persisted targets", () => {
  const scenario = scenarioFromPersisted(persisted());
  assert.equal(scenario.id, "scenario-a");
  assert.equal(scenario.isNew, false);
  assert.equal(isScenarioDirty(scenario), false);
  assert.deepEqual(scenario.draft, scenario.saved);
  assert.equal(scenario.draft.targetDeviceId, "device-alias");
  assert.equal(scenario.draft.targetObjectId, "dynamic-object-2");
  assert.equal(scenario.draft.ttlSeconds, 60);
  assert.equal(scenario.draft.keepAfterExecute, true);
  assert.equal(scenario.draft.text, "git status\n");
});

test("persisted <-> UI round-trips every stored field", () => {
  const store: ScenarioStore = {
    schemaVersion: SCENARIO_STORE_SCHEMA_VERSION,
    scenarios: [
      persisted(),
      persisted({ id: "scenario-b", name: "Build watch", targetDevice: null, targetObject: null, ttlSeconds: null, keepAfterExecute: false }),
    ],
  };
  const scenarios = scenariosFromStore(store);
  assert.equal(scenarios.length, 2);
  assert.equal(scenarios[1].draft.targetDeviceId, null);
  assert.equal(scenarios[1].draft.targetObjectId, null);

  const roundTripped = storeFromScenarios(scenarios, SCENARIO_STORE_SCHEMA_VERSION);
  assert.deepEqual(roundTripped, store);
  // The stored document keeps the UI-only fields out of the file.
  assert.deepEqual(Object.keys(roundTripped.scenarios[0]).sort(), [
    "id",
    "keepAfterExecute",
    "name",
    "targetDevice",
    "targetObject",
    "text",
    "ttlSeconds",
  ]);
});

test("a save writes the committed draft and never another scenario's unsaved edits", () => {
  const saved = createScenario("scenario-a", { name: "Work", text: "git status\n", targetObjectId: "dynamic-object-0" });
  const other = createScenario("scenario-b", { name: "Build", text: "npm run build\n", targetObjectId: "dynamic-object-1" });
  const unsaved = createScenario("scenario-c", {}, { isNew: true });
  const editedOther = editScenario(other, { text: "npm run build --silent\n" });
  const editedNew = editScenario(unsaved, { name: "Scratch", text: "ls\n" });
  const list: Scenario[] = [saved, editedOther, editedNew];

  const plan = planScenarioSave(list, "scenario-a", SCENARIO_STORE_SCHEMA_VERSION);
  assert.ok(plan);
  // The committed scenario becomes clean.
  assert.equal(plan.committed.isNew, false);
  assert.deepEqual(plan.committed.draft, plan.committed.saved);
  assert.equal(isScenarioDirty(plan.committed), false);
  // The others keep their drafts and their dirty state: saving one scenario is
  // not a silent save of every other draft.
  assert.equal(plan.scenarios.length, 3);
  const untouchedOther = plan.scenarios[1];
  assert.equal(untouchedOther.draft.text, "npm run build --silent\n");
  assert.equal(isScenarioDirty(untouchedOther), true);
  // ... and the file only carries the other scenario's last saved snapshot.
  assert.deepEqual(plan.store.scenarios.map((scenario) => scenario.id), ["scenario-a", "scenario-b"]);
  assert.equal(plan.store.scenarios[1].text, "npm run build\n");
  assert.equal(plan.store.scenarios[0].text, "git status\n");
  // A never-saved scenario stays out of the file unless it is the committed one.
  assert.equal(plan.store.scenarios.some((scenario) => scenario.id === "scenario-c"), false);
  assert.equal(plan.store.schemaVersion, SCENARIO_STORE_SCHEMA_VERSION);

  const firstSave = planScenarioSave(list, "scenario-c", SCENARIO_STORE_SCHEMA_VERSION);
  assert.ok(firstSave);
  const committedNew = firstSave.store.scenarios.find((scenario) => scenario.id === "scenario-c");
  assert.ok(committedNew);
  assert.equal(committedNew.name, "Scratch");
  assert.equal(committedNew.text, "ls\n");

  // Planning is pure: the caller's list is untouched until the write succeeded.
  assert.equal(list[0].isNew, false);
  assert.equal(list[1].draft.text, "npm run build --silent\n");
  assert.equal(list[2].isNew, true);
  assert.equal(planScenarioSave(list, "missing", SCENARIO_STORE_SCHEMA_VERSION), null);
});

test("deleting persists the remaining scenarios and drops a never-saved one", () => {
  const saved = createScenario("scenario-a", { name: "Work", text: "git status\n" });
  const draftOnly = createScenario("scenario-b", {}, { isNew: true });
  const store = storeFromScenarios([saved, draftOnly], SCENARIO_STORE_SCHEMA_VERSION, null);
  assert.deepEqual(store.scenarios.map((scenario) => scenario.id), ["scenario-a"]);
  assert.deepEqual(store.scenarios[0], {
    id: "scenario-a",
    name: "Work",
    text: "git status\n",
    ttlSeconds: null,
    keepAfterExecute: false,
    targetDevice: null,
    targetObject: null,
  });
});

test("store blockers require a name and a storable body", () => {
  const base = emptyScenarioFields();
  assert.deepEqual(storeBlockers({ ...base, name: "Work" }), []);
  assert.deepEqual(storeBlockers({ ...base, name: "Work", text: "" }), []);
  assert.ok(storeBlockers(base).includes("nameRequired"));
  assert.ok(storeBlockers({ ...base, name: "   " }).includes("nameRequired"));
  assert.ok(storeBlockers({ ...base, name: "n".repeat(65) }).includes("nameTooLong"));
  assert.deepEqual(storeBlockers({ ...base, name: "n".repeat(64) }), []);
  assert.ok(storeBlockers({ ...base, name: "Work", text: "a".repeat(513) }).includes("storeTextTooLong"));
  assert.deepEqual(storeBlockers({ ...base, name: "Work", text: "a".repeat(512) }), []);
  assert.ok(storeBlockers({ ...base, name: "Work", text: "café\n" }).includes("storeTextUnsupported"));
  assert.deepEqual(storeBlockers({ ...base, name: "Work", text: "line\n\ttab\u0008back" }), []);
  // Only one text problem is reported at a time, and a nameless draft reports
  // the name first because the file would be rejected for it.
  assert.deepEqual(storeBlockers({ ...base, name: "Work", text: "a".repeat(600) }), ["storeTextTooLong"]);
});

test("a new scenario id is opaque, bounded and unused", () => {
  const first = newScenarioId([]);
  assert.ok(first.length > 0 && first.length <= 64);
  assert.ok(/^[\x21-\x7e]+$/.test(first), "ids stay printable ascii without spaces");
  assert.notEqual(newScenarioId([first]), first);
  const existing = [first];
  for (let index = 0; index < 5; index += 1) existing.push(newScenarioId(existing));
  assert.equal(new Set(existing).size, existing.length);
});

test("saveScenario only cleans the scenario it was applied to", () => {
  const fields: ScenarioFields = { name: "Work", text: "git status\n", ttlSeconds: null, keepAfterExecute: false, targetObjectId: "dynamic-object-0", targetDeviceId: null };
  const scenario = createScenario("scenario-a", fields);
  const edited = editScenario(scenario, { text: "git fetch\n" });
  assert.equal(isScenarioDirty(edited), true);
  const cleaned = saveScenario(edited);
  assert.equal(isScenarioDirty(cleaned), false);
  assert.equal(cleaned.draft.text, "git fetch\n");
  assert.equal(cleaned.saved.text, "git fetch\n");
  // The pre-save scenario is untouched, which is what a failed store write keeps.
  assert.equal(isScenarioDirty(edited), true);
  assert.equal(edited.saved.text, "git status\n");
});

test("serialized store writes run in call order", async () => {
  const run = createSerialRunner();
  const order: string[] = [];
  const first = run(async () => {
    order.push("first:start");
    await Promise.resolve();
    order.push("first:end");
    return 1;
  });
  const second = run(async () => {
    order.push("second:start");
    await Promise.resolve();
    order.push("second:end");
    return 2;
  });
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);

  // A rejected write does not cancel the writes queued after it.
  const failing = run(() => Promise.reject(new Error("store failed")));
  const following = run(async () => "ok");
  await assert.rejects(() => failing);
  assert.equal(await following, "ok");
});
