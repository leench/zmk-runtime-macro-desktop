import assert from "node:assert/strict";
import { test } from "node:test";
import type { DynamicObservation, PreviewScenarioLabels, PreviewStateId, Scenario } from "../src/types/scenario.ts";
import { PREVIEW_STATES } from "../src/types/scenario.ts";
import { buildPreviewFixture } from "../src/features/dynamic/previewFixtures.ts";
import {
  TARGET_MISSING,
  TARGET_NONE,
  clearBlockers,
  createScenario,
  editScenario,
  findTargetObject,
  hasScenarioContent,
  isScenarioDirty,
  objectDisplayLabel,
  objectLimits,
  objectWireSlot,
  saveScenario,
  scenarioByteLength,
  scenariosMatch,
  targetRowState,
  targetSelectorValue,
  uploadBlockers,
} from "../src/utils/scenario.ts";

/**
 * Pure model checks for the page-level Dynamic workspace. They never touch HID,
 * React, Tauri commands or storage: scenario text stays in memory only.
 */

const labels: PreviewScenarioLabels = { workTerminal: "Work terminal", buildWatch: "Build watch", scratch: "Scratch" };

function capabilitiesFor(state: PreviewStateId) {
  const capability = buildPreviewFixture(state, labels).capability;
  assert.ok(capability, `fixture ${state} must report a capability`);
  return capability;
}

function selectedScenario(state: PreviewStateId): Scenario | null {
  const fixture = buildPreviewFixture(state, labels);
  return fixture.selectedIndex === null ? null : fixture.scenarios[fixture.selectedIndex] ?? null;
}

function blockersFor(state: PreviewStateId, observation?: DynamicObservation) {
  const fixture = buildPreviewFixture(state, labels);
  const scenario = fixture.selectedIndex === null ? null : fixture.scenarios[fixture.selectedIndex] ?? null;
  const gate = { device: fixture.device, capability: fixture.capability, scenario, observation: observation ?? fixture.observation };
  return { upload: uploadBlockers(gate), clear: clearBlockers(gate) };
}

test("scenario drafts stay dirty until they are saved locally", () => {
  const empty = createScenario("scenario-1");
  assert.deepEqual(empty.draft, { name: "", text: "", ttlSeconds: null, keepAfterExecute: false, targetObjectId: null, targetDeviceId: null });
  assert.equal(empty.isNew, false);
  assert.equal(isScenarioDirty(empty), false);
  assert.equal(hasScenarioContent(empty), false);

  const created = createScenario("scenario-2", {}, { isNew: true });
  assert.equal(isScenarioDirty(created), true);
  assert.equal(hasScenarioContent(created), false);

  const edited = editScenario(empty, { text: "git status\n", targetObjectId: "object-1" });
  assert.equal(edited.saved.text, "");
  assert.equal(edited.draft.text, "git status\n");
  assert.equal(isScenarioDirty(edited), true);
  assert.equal(hasScenarioContent(edited), true);

  const saved = saveScenario(edited);
  assert.equal(saved.isNew, false);
  assert.equal(isScenarioDirty(saved), false);
  assert.deepEqual(saved.saved, saved.draft);
  assert.equal(saveScenario(created).isNew, false);
  assert.equal(isScenarioDirty(saveScenario(created)), false);
});

test("saving keeps the previous snapshot until the draft changes again", () => {
  const saved = saveScenario(createScenario("scenario-1", { name: "Work terminal", text: "git fetch\n" }));
  const reedited = editScenario(saved, { text: "git fetch --all --prune\n" });
  assert.equal(reeditSnapshotText(reedited), "git fetch\n");
  assert.equal(isScenarioDirty(reedited), true);
  assert.equal(isScenarioDirty(saveScenario(reedited)), false);
});

function reeditSnapshotText(scenario: Scenario): string {
  return scenario.saved.text;
}

test("scenario comparisons detect edited, added and removed scenarios", () => {
  const first = buildPreviewFixture("ready", labels).scenarios;
  const second = buildPreviewFixture("ready", labels).scenarios;
  assert.equal(scenariosMatch(first, second), true);

  const edited = first.map((scenario, index) => index === 0 ? editScenario(scenario, { text: "changed" }) : scenario);
  assert.equal(scenariosMatch(edited, second), false);
  assert.equal(scenariosMatch([...first], [...second, createScenario("extra")]), false);
  assert.equal(scenariosMatch([], []), true);
});

test("target selection resolves capability objects without remapping", () => {
  const capability = capabilitiesFor("ready");
  assert.equal(targetSelectorValue(capability, null), TARGET_NONE);
  assert.equal(targetSelectorValue(capability, "object-3"), "object-3");
  assert.equal(targetSelectorValue(capability, "object-9"), TARGET_MISSING);
  assert.equal(targetSelectorValue(null, "object-1"), TARGET_MISSING);
  assert.equal(targetSelectorValue(null, null), TARGET_NONE);
  assert.equal(findTargetObject(capability, "object-3")?.objectId, "object-3");
  assert.equal(findTargetObject(capability, "object-9"), null);
  assert.equal(findTargetObject(null, "object-1"), null);

  // A single-object capability resolves its object, but never remaps a saved one.
  const single = capabilitiesFor("capabilityChanged");
  assert.equal(single.objects.length, 1);
  const only = single.objects[0];
  assert.equal(targetSelectorValue(single, only.objectId), only.objectId);
  assert.equal(targetSelectorValue(single, "object-9"), TARGET_MISSING);
  assert.equal(findTargetObject(single, "object-9"), null);
});

test("a single-object device never adopts its only object as an unresolved target", () => {
  const capability = capabilitiesFor("capabilityChanged");
  const only = capability.objects[0];

  assert.deepEqual(targetRowState(capability, "object-9"), { value: TARGET_MISSING, missing: true, soleObject: only, soleObjectBound: false });
  assert.deepEqual(targetRowState(capability, null), { value: TARGET_NONE, missing: false, soleObject: only, soleObjectBound: false });
  assert.deepEqual(targetRowState(capability, only.objectId), { value: only.objectId, missing: false, soleObject: only, soleObjectBound: true });

  // Multi-object and zero-object capabilities keep their existing behaviour.
  const multi = capabilitiesFor("ready");
  assert.deepEqual(targetRowState(multi, "object-9"), { value: TARGET_MISSING, missing: true, soleObject: null, soleObjectBound: false });
  assert.deepEqual(targetRowState(multi, "object-3"), { value: "object-3", missing: false, soleObject: null, soleObjectBound: false });
  assert.deepEqual(targetRowState({ ...capability, objects: [] }, only.objectId), { value: TARGET_MISSING, missing: true, soleObject: null, soleObjectBound: false });

  // Without a capability nothing is resolved and nothing is reported as missing yet.
  assert.deepEqual(targetRowState(null, only.objectId), { value: TARGET_MISSING, missing: false, soleObject: null, soleObjectBound: false });
  assert.deepEqual(targetRowState(null, null), { value: TARGET_NONE, missing: false, soleObject: null, soleObjectBound: false });
});

test("a single-object device stays blocked until the user rebinds the missing target", () => {
  const capability = capabilitiesFor("capabilityChanged");
  const observation: DynamicObservation = { status: "none", targetObjectId: null, errorKind: null };
  const gate = (scenario: Scenario) => ({
    upload: uploadBlockers({ device: "ready", capability, scenario, observation }),
    clear: clearBlockers({ device: "ready", capability, scenario, observation }),
  });

  const stale = createScenario("scenario-stale", { name: "Work", text: "git status\n", targetObjectId: "object-9" });
  assert.equal(findTargetObject(capability, stale.draft.targetObjectId), null);
  assert.ok(gate(stale).upload.includes("targetMissing"));
  assert.ok(gate(stale).clear.includes("targetMissing"));

  // Only the explicit rebind keeps the text, keeps the draft dirty and clears the blocker.
  const rebound = editScenario(stale, { targetObjectId: capability.objects[0].objectId });
  assert.equal(rebound.draft.text, "git status\n");
  assert.equal(isScenarioDirty(rebound), true);
  assert.deepEqual(gate(rebound).upload, []);
  assert.deepEqual(gate(rebound).clear, []);
});

test("capability limits and labels come from the reported object", () => {
  const capability = capabilitiesFor("ready");
  // Every fixture object carries the wire slot it must be addressed with, and
  // the slot is never derived back out of the opaque id.
  for (const [index, object] of capability.objects.entries()) {
    assert.equal(object.wireSlot, index, "fixture wire slots follow the reported order");
    assert.equal(objectWireSlot(capability, object.objectId), index);
  }
  // An id from another namespace is not reinterpreted as a slot.
  assert.equal(objectWireSlot(capability, "dynamic-object-0"), null);
  assert.equal(objectWireSlot(capability, "object-99"), null);
  assert.equal(objectWireSlot(null, capability.objects[0].objectId), null);
  assert.equal(objectWireSlot(capability, null), null);

  const object = findTargetObject(capability, "object-1");
  assert.ok(object);
  assert.deepEqual(objectLimits(object), { maxBytes: 512, minTtlSeconds: 1, maxTtlSeconds: 86_400, defaultTtlSeconds: 300 });
  assert.equal(objectDisplayLabel(object, 0, (position) => `Object ${position}`), "Object 1");
  assert.equal(objectDisplayLabel(object, 2, (position) => `Object ${position}`), "Object 3");
  assert.equal(objectDisplayLabel({ ...object, displayLabel: "Alias" }, 0, (position) => `Object ${position}`), "Alias");

  const oversize = capabilitiesFor("oversize").objects[0];
  assert.equal(oversize.maxLength, 128);
  assert.equal(objectLimits(oversize).maxBytes, 128);
});

test("upload blockers cover device state, target, text, TTL and keep support", () => {
  assert.deepEqual(blockersFor("ready").upload, []);
  assert.ok(blockersFor("disconnected").upload.includes("deviceDisconnected"));
  assert.ok(blockersFor("unknown").upload.includes("deviceUnknown"));
  assert.ok(blockersFor("discovering").upload.includes("capabilityDiscovering"));
  assert.ok(blockersFor("unsupported").upload.includes("dynamicUnsupported"));
  assert.ok(blockersFor("uploading").upload.includes("operationInProgress"));
  assert.ok(blockersFor("clearing").upload.includes("operationInProgress"));
  assert.ok(blockersFor("targetMissing").upload.includes("targetMissing"));
  assert.ok(blockersFor("oversize").upload.includes("textTooLong"));
  assert.ok(blockersFor("keepUnsupported").upload.includes("keepUnsupported"));
  assert.ok(blockersFor("capabilityChanged").upload.includes("ttlInvalid"));
  assert.ok(blockersFor("new").upload.includes("targetMissing"));

  const capability = capabilitiesFor("ready");
  const observation: DynamicObservation = { status: "none", targetObjectId: null, errorKind: null };
  const valid = createScenario("scenario-1", { name: "Work", text: "git status\n", targetObjectId: "object-1" });
  const gate = (scenario: Scenario | null, remaining = {}) => uploadBlockers({ device: "ready", capability, scenario, observation, ...remaining });

  assert.deepEqual(gate(valid), []);
  assert.ok(gate(editScenario(valid, { text: "" })).includes("textEmpty"));
  assert.ok(gate(editScenario(valid, { text: "é" })).includes("textUnsupported"));
  assert.ok(gate(editScenario(valid, { text: "a".repeat(600) })).includes("textTooLong"));
  assert.ok(gate(editScenario(valid, { ttlSeconds: 86_401 })).includes("ttlInvalid"));
  assert.ok(gate(editScenario(valid, { ttlSeconds: 0 })).includes("ttlInvalid"));
  assert.ok(gate(editScenario(valid, { ttlSeconds: 1.5 })).includes("ttlInvalid"));
  assert.deepEqual(gate(editScenario(valid, { ttlSeconds: 60 })), []);
  assert.deepEqual(gate(editScenario(valid, { ttlSeconds: 86_400 })), []);
  assert.ok(gate(editScenario(valid, { keepAfterExecute: true }), { capability: capabilitiesFor("keepUnsupported") }).includes("keepUnsupported"));
  // Upload needs an explicit scenario and target: with a reported capability an
  // unselected scenario is an unresolved target, not an available action.
  assert.deepEqual(gate(null), ["targetMissing"]);
  assert.ok(uploadBlockers({ device: "ready", capability: null, scenario: valid, observation }).includes("capabilityDiscovering"));
});

test("clear blockers need a device and a target but ignore text, TTL and keep", () => {
  assert.deepEqual(blockersFor("ready").clear, []);
  assert.ok(blockersFor("keepUnsupported").clear.length === 0);
  assert.ok(blockersFor("oversize").clear.length === 0);
  assert.ok(blockersFor("capabilityChanged").clear.length === 0);
  assert.ok(blockersFor("disconnected").clear.includes("deviceDisconnected"));
  assert.ok(blockersFor("unsupported").clear.includes("dynamicUnsupported"));
  assert.ok(blockersFor("targetMissing").clear.includes("targetMissing"));
  assert.ok(blockersFor("uploading").clear.includes("operationInProgress"));
  // A reported capability without a selected scenario has no target to clear.
  const capability = capabilitiesFor("ready");
  const observation: DynamicObservation = { status: "none", targetObjectId: null, errorKind: null };
  assert.deepEqual(clearBlockers({ device: "ready", capability, scenario: null, observation }), ["targetMissing"]);
});

test("scenario text length is counted in bytes", () => {
  assert.equal(scenarioByteLength("git status\n"), 11);
  assert.equal(scenarioByteLength("é"), 2);
  assert.equal(scenarioByteLength(""), 0);
});

test("every preview state builds a device-free fixture", () => {
  assert.equal(PREVIEW_STATES.length, 18);
  assert.equal(new Set(PREVIEW_STATES).size, PREVIEW_STATES.length);

  for (const state of PREVIEW_STATES) {
    const fixture = buildPreviewFixture(state, labels);
    if (fixture.selectedIndex !== null) {
      assert.ok(fixture.selectedIndex >= 0 && fixture.selectedIndex < fixture.scenarios.length, `${state} selects an existing scenario`);
    }
    if (fixture.device !== "ready") assert.equal(fixture.capability, null, `${state} reports no capability while the device is not ready`);
    if (fixture.device === "ready") assert.ok(fixture.capability, `${state} reports a capability while the device is ready`);
    for (const scenario of fixture.scenarios) {
      const bytes = new TextEncoder().encode(scenario.draft.text);
      for (const byte of bytes) {
        assert.ok((byte >= 0x20 && byte <= 0x7e) || byte === 0x0a || byte === 0x09, `${state} keeps printable dynamic text`);
      }
      for (const object of fixture.capability?.objects ?? []) {
        if (scenario.draft.targetObjectId === object.objectId) assert.ok(object.maxLength > 0);
      }
    }
  }

  const objectCounts = PREVIEW_STATES.map((state) => buildPreviewFixture(state, labels).capability?.objects.length ?? 0);
  assert.ok(objectCounts.includes(1), "a single-object fixture is available");
  assert.ok(objectCounts.includes(8), "a multi-object fixture is available");
});

test("fixture scenarios are user data, never device content", () => {
  const fixture = buildPreviewFixture("ready", labels);
  assert.equal(fixture.scenarios.length, 2);
  assert.equal(fixture.scenarios[0].draft.name, labels.workTerminal);
  assert.equal(fixture.scenarios[0].draft.targetObjectId, "object-1");
  assert.equal(fixture.scenarios[1].draft.targetObjectId, "object-3");
  assert.equal(fixture.observation.status, "none");
  assert.equal(fixture.staticLocked, false);

  const staticLocked = buildPreviewFixture("staticLocked", labels);
  assert.equal(staticLocked.staticLocked, true);
  assert.equal(staticLocked.capability?.objects.length, 8);
  assert.deepEqual(blockersFor("staticLocked").upload, []);

  const targetMissing = buildPreviewFixture("targetMissing", labels);
  assert.equal(targetMissing.scenarios[0].draft.targetObjectId, "object-9");
  assert.equal(targetMissing.scenarios[0].draft.text.length > 0, true);
  assert.equal(targetMissing.capability?.objects.some((object) => object.objectId === "object-9"), false);
  // Single-object boundary: the sole object stays unbound until the user rebinds.
  const targetMissingRow = targetRowState(targetMissing.capability ?? null, targetMissing.scenarios[0].draft.targetObjectId);
  assert.equal(targetMissing.capability?.objects.length, 1);
  assert.equal(targetMissingRow.value, TARGET_MISSING);
  assert.equal(targetMissingRow.missing, true);
  assert.equal(targetMissingRow.soleObject?.objectId, "object-1");
  assert.equal(targetMissingRow.soleObjectBound, false);

  const dirty = selectedScenario("dirty");
  assert.ok(dirty);
  assert.equal(isScenarioDirty(dirty), true);
  assert.notEqual(dirty.draft.text, dirty.saved.text);
});
