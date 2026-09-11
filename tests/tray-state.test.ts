import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DYNAMIC_SERVICE_STATUSES,
  TRAY_ACTIONS,
  TRAY_ACTION_EVENT,
  isTrayAction,
  setTrayRuntimeState,
  subscribeTrayAction,
  trayActionFromPayload,
  type TrayRuntimeState,
} from "../src/bridge.ts";
import type { DynamicCapabilitiesPresentation, DynamicObservation, WorkspaceTrayContext } from "../src/types/scenario.ts";
import {
  DEFAULT_WORKSPACE_TRAY_CONTEXT,
  clearActionIssues,
  createScenario,
  editScenario,
  sameWorkspaceTrayContext,
  storeBlockers,
  trayContextFromWorkspace,
  traySafeScenarioName,
  uploadBlockers,
} from "../src/utils/scenario.ts";
import type { ScenarioIssue } from "../src/utils/scenario.ts";

/**
 * Frontend half of the tray runtime contract.
 *
 * The native tray mirrors a bounded summary of the connected window: a status
 * tag from the service allowlist, a scenario *display* name and three action
 * flags. These checks pin the serialized names, keep the payload body-free and
 * prove that a browser preview neither publishes state nor receives an action.
 * They never open HID, never touch a tray and never store dynamic text.
 */

/** Keys the runtime state may expose to the native menu. */
const RUNTIME_STATE_KEYS = [
  "canChooseScenario",
  "canClearDynamic",
  "canUploadScenario",
  "currentScenarioName",
  "deviceConnected",
  "dynamicStatus",
] as const;

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
  "password",
  "token",
  "raw",
] as const;

function runtimeState(overrides: Partial<TrayRuntimeState> = {}): TrayRuntimeState {
  return {
    deviceConnected: true,
    dynamicStatus: "ready",
    currentScenarioName: "Work terminal",
    canChooseScenario: true,
    canUploadScenario: true,
    canClearDynamic: true,
    ...overrides,
  };
}

test("the tray status allowlist is the serialized service status list", () => {
  assert.deepEqual(
    [...DYNAMIC_SERVICE_STATUSES],
    [
      "unknown",
      "discovering",
      "ready",
      "unsupported",
      "uploading",
      "committedLocally",
      "clearing",
      "clearedLocally",
      "error",
    ],
  );
  assert.equal(new Set(DYNAMIC_SERVICE_STATUSES).size, DYNAMIC_SERVICE_STATUSES.length);
});

test("the runtime state exposes only the bounded display fields", () => {
  const state = runtimeState();
  assert.deepEqual(Object.keys(state).sort(), [...RUNTIME_STATE_KEYS]);
  for (const key of Object.keys(state)) {
    assert.ok(
      !FORBIDDEN_KEYS.includes(key as (typeof FORBIDDEN_KEYS)[number]),
      `${key} must not be part of the tray runtime state`,
    );
  }
  // The name is a display label and may be absent, never a body.
  assert.equal(state.currentScenarioName, "Work terminal");
  assert.equal(runtimeState({ currentScenarioName: null }).currentScenarioName, null);
});

test("the tray actions are exactly the three camelCase tags", () => {
  assert.equal(TRAY_ACTION_EVENT, "tray-action");
  assert.deepEqual([...TRAY_ACTIONS], ["chooseScenario", "uploadScenario", "clearDynamic"]);
  assert.equal(new Set(TRAY_ACTIONS).size, TRAY_ACTIONS.length);

  for (const action of TRAY_ACTIONS) {
    assert.ok(isTrayAction(action));
  }
  // Nothing else can become an action, including near misses and non-strings.
  for (const rejected of [
    "",
    " ",
    "choose",
    "upload",
    "clear",
    "choosescenario",
    "choose-scenario",
    "uploadScenario ",
    " uploadScenario",
    "clearDynamicObject",
    "uploadScenario\n",
    "tray-choose-scenario",
  ]) {
    assert.equal(isTrayAction(rejected), false, `${JSON.stringify(rejected)} must be rejected`);
  }
  for (const rejected of [null, undefined, 1, true, {}, [], { action: "uploadScenario" }]) {
    assert.equal(isTrayAction(rejected), false, `${JSON.stringify(rejected)} must be rejected`);
  }
});

test("setTrayRuntimeState never reports success outside a Tauri host", async () => {
  // The App only publishes the tray state behind its Tauri check, so a browser
  // preview must not end up with a fabricated success.
  await assert.rejects(() => setTrayRuntimeState(runtimeState()));
  await assert.rejects(() => setTrayRuntimeState({ ...runtimeState(), dynamicStatus: "unknown" }));
});

/** Records the Tauri IPC calls and the raw event listeners of a fake host. */
function installFakeTauriHost(): {
  calls: { cmd: string; args: Record<string, unknown> }[];
  listeners: ((event: unknown) => void)[];
  restore: () => void;
} {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const listeners: ((event: unknown) => void)[] = [];
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        calls.push({ cmd, args });
        return Promise.resolve(1);
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
  return {
    calls,
    listeners,
    restore: () => {
      (globalThis as { window?: unknown }).window = previous;
    },
  };
}

test("setTrayRuntimeState sends exactly the bounded camelCase fields", async () => {
  const host = installFakeTauriHost();
  try {
    await setTrayRuntimeState(runtimeState());
    assert.equal(host.calls.length, 1);
    assert.equal(host.calls[0].cmd, "set_tray_runtime_state");
    // The IPC argument names are the Rust command parameters, and no field can
    // carry text, a HID path, a serial or a device id.
    assert.deepEqual(host.calls[0].args, {
      deviceConnected: true,
      dynamicStatus: "ready",
      currentScenarioName: "Work terminal",
      canChooseScenario: true,
      canUploadScenario: true,
      canClearDynamic: true,
    });
    await setTrayRuntimeState({
      deviceConnected: false,
      dynamicStatus: "unknown",
      currentScenarioName: null,
      canChooseScenario: false,
      canUploadScenario: false,
      canClearDynamic: false,
    });
    assert.deepEqual(host.calls[1].args, {
      deviceConnected: false,
      dynamicStatus: "unknown",
      currentScenarioName: null,
      canChooseScenario: false,
      canUploadScenario: false,
      canClearDynamic: false,
    });
  } finally {
    host.restore();
  }
});

test("the tray listener registers the stable event and forwards only real actions", async () => {
  const host = installFakeTauriHost();
  const received: string[] = [];
  try {
    const unlisten = await subscribeTrayAction((action) => received.push(action));
    assert.equal(host.calls[0].cmd, "plugin:event|listen");
    assert.equal(host.calls[0].args.event, TRAY_ACTION_EVENT);
    assert.equal(host.listeners.length, 1);

    const deliver = host.listeners[0];
    for (const action of TRAY_ACTIONS) {
      deliver({ event: TRAY_ACTION_EVENT, id: 1, payload: { action } });
    }
    // Anything that is not one of the three actions is dropped, not guessed.
    for (const payload of [
      { action: "upload" },
      { action: "clearDynamicObject" },
      {},
      null,
      undefined,
      "uploadScenario",
      3,
    ]) {
      deliver({ event: TRAY_ACTION_EVENT, id: 1, payload });
    }
    assert.deepEqual(received, [...TRAY_ACTIONS]);

    // A payload that carries more than the action still only triggers the action
    // itself: no scenario text or identifier is read or forwarded.
    deliver({ event: TRAY_ACTION_EVENT, id: 1, payload: { action: "uploadScenario", text: "git status", deviceId: "x" } });
    assert.deepEqual(received, [...TRAY_ACTIONS, "uploadScenario"]);

    await unlisten();
    assert.equal(host.calls.at(-1)?.cmd, "plugin:event|unlisten");
  } finally {
    host.restore();
  }

  // Without a host again, nothing is registered and nothing is delivered.
  await assert.rejects(() => subscribeTrayAction(() => undefined));
});

test("only the documented payload shape yields an action", () => {
  for (const action of TRAY_ACTIONS) {
    assert.equal(trayActionFromPayload({ action }), action);
    // Extra fields never change the outcome.
    assert.equal(trayActionFromPayload({ action, text: "git status", deviceId: "x" }), action);
  }
  for (const payload of [
    null,
    undefined,
    "chooseScenario",
    1,
    true,
    [],
    {},
    { action: null },
    { action: "choose" },
    { action: "chooseScenario " },
    { Action: "chooseScenario" },
  ]) {
    assert.equal(trayActionFromPayload(payload), null, JSON.stringify(payload));
  }
});

test("subscribeTrayAction never fabricates a listener outside a Tauri host", async () => {
  // Without Tauri internals there is no native tray and no event channel.
  await assert.rejects(() => subscribeTrayAction(() => undefined));
});

test("a scenario display name is bounded, trimmed and control-free", () => {
  assert.equal(traySafeScenarioName(null), null);
  assert.equal(traySafeScenarioName(""), null);
  assert.equal(traySafeScenarioName("   "), null);
  assert.equal(traySafeScenarioName("  Work terminal  "), "Work terminal");
  assert.equal(traySafeScenarioName("Build watch"), "Build watch");
  // Multi-byte names are bounded in bytes, exactly like the store schema.
  assert.equal(traySafeScenarioName("场景"), "场景");
  assert.equal(traySafeScenarioName("场".repeat(21)), "场".repeat(21));
  assert.equal(traySafeScenarioName("场".repeat(22)), null);
  assert.equal(traySafeScenarioName("n".repeat(64)), "n".repeat(64));
  assert.equal(traySafeScenarioName("n".repeat(65)), null);
  // Control characters never reach a native menu label.
  for (const rejected of [
    "name\nwith-newline",
    "name\twith-tab",
    "control\u{7f}",
    "c1\u{9f}",
    "nul\u{0}",
    "bell\u{7}",
  ]) {
    assert.equal(traySafeScenarioName(rejected), null, JSON.stringify(rejected));
  }
});

test("the tray context follows the same blockers as the editor", () => {
  const scenario = createScenario("scenario-a", { name: "Work terminal", text: "git status\n" });
  const clearOnly: ScenarioIssue[] = [];
  const ready = trayContextFromWorkspace({
    scenario,
    operation: null,
    uploadBlockers: clearOnly,
    clearBlockers: clearOnly,
  });
  assert.deepEqual(ready, {
    scenarioName: "Work terminal",
    canChooseScenario: true,
    canUploadScenario: true,
    canClearDynamic: true,
  });

  // An upload blocker (target missing, oversize, TTL, keep, store, operation…)
  // disables the tray upload without touching the clear action.
  const blockedUpload = trayContextFromWorkspace({
    scenario,
    operation: null,
    uploadBlockers: ["targetMissing"],
    clearBlockers: [],
  });
  assert.equal(blockedUpload.canUploadScenario, false);
  assert.equal(blockedUpload.canClearDynamic, true);

  // A running operation disables both device actions, and the safe no-op path in
  // the workspace relies on exactly that.
  for (const operation of ["upload", "clear"] as const) {
    const busy = trayContextFromWorkspace({
      scenario,
      operation,
      uploadBlockers: [],
      clearBlockers: [],
    });
    assert.equal(busy.canUploadScenario, false, operation);
    assert.equal(busy.canClearDynamic, false, operation);
    assert.equal(busy.canChooseScenario, true);
  }

  // A store that is not ready disables saving and uploading, never clearing:
  // clearing only talks to the device and never writes the local store.
  const storeDown = trayContextFromWorkspace({
    scenario,
    operation: null,
    uploadBlockers: ["storeUnavailable"],
    clearBlockers: [],
  });
  assert.equal(storeDown.canUploadScenario, false);
  assert.equal(storeDown.canClearDynamic, true);

  // No selected scenario, an unnamed one or an unsafe name shows no name, and an
  // unnamed scenario cannot be uploaded.
  const unnamed = editScenario(createScenario("scenario-b", { name: "Work" }), { name: "  " });
  const noName = trayContextFromWorkspace({
    scenario: unnamed,
    operation: null,
    uploadBlockers: ["nameRequired"],
    clearBlockers: [],
  });
  assert.equal(noName.scenarioName, null);
  assert.equal(noName.canUploadScenario, false);
  // A draft the store would refuse is still a perfectly clearable target.
  assert.equal(noName.canClearDynamic, true);
  assert.equal(
    trayContextFromWorkspace({ scenario: null, operation: null, uploadBlockers: [], clearBlockers: [] }).scenarioName,
    null,
  );
  const unsafe = trayContextFromWorkspace({
    scenario: createScenario("scenario-c", { name: "line\nbreak" }),
    operation: null,
    uploadBlockers: [],
    clearBlockers: [],
  });
  assert.equal(unsafe.scenarioName, null);
});

/** The device gate used by the clear tests: one object, target id `dynamic-object-0`. */
function clearGateCapability(): DynamicCapabilitiesPresentation {
  return {
    capabilityVersion: 2,
    objects: [
      {
        objectId: "dynamic-object-0",
        wireSlot: 0,
        displayLabel: "",
        maxLength: 512,
        ttl: { defaultSeconds: 300, minSeconds: 1, maxSeconds: 86_400 },
        supportsKeepAfterExecute: true,
      },
    ],
    lifecycle: {
      clearOnBoot: true,
      clearOnTtlExpiry: true,
      clearOnExecutionAccept: true,
      clearOnUsbDisconnect: false,
      clearOnBleProfileChange: false,
      clearOnSelectedEndpointChange: false,
    },
  };
}

const noObservation: DynamicObservation = { status: "none", targetObjectId: null, errorKind: null };

/** The clear action gate with the device ready and a selected scenario with one valid target object. */
function clearGate(overrides: Partial<Parameters<typeof clearActionIssues>[0]> = {}): ScenarioIssue[] {
  return clearActionIssues({
    operation: null,
    device: "ready",
    capability: clearGateCapability(),
    scenario: createScenario("scenario-clear", {
      name: "Work terminal",
      text: "git status\n",
      targetObjectId: "dynamic-object-0",
    }),
    observation: noObservation,
    ...overrides,
  });
}

test("an unusable store or an unsaveable draft never disables clear", () => {
  // A draft the store refuses: no usable name and text outside the on-disk charset.
  const unsaveable = createScenario("scenario-store", {
    name: "   ",
    text: "not ascii ✨",
    targetObjectId: "dynamic-object-0",
  });
  const saveIssues = storeBlockers(unsaveable.draft);
  assert.ok(saveIssues.includes("nameRequired"), "the draft must be unsaveable");
  assert.ok(saveIssues.includes("storeTextUnsupported"), "the draft must be unsaveable");

  // Clearing only talks to the device, so neither an unusable store nor a draft
  // the store would reject reaches its blocker list.
  assert.deepEqual(clearGate({ scenario: unsaveable }), []);

  // The tray therefore keeps clear enabled while saving and uploading stay
  // blocked, even when the store is unavailable on top of the invalid draft.
  const storeIssues: ScenarioIssue[] = ["storeUnavailable", ...saveIssues];
  const context = trayContextFromWorkspace({
    scenario: unsaveable,
    operation: null,
    uploadBlockers: storeIssues,
    clearBlockers: clearGate({ scenario: unsaveable }),
  });
  assert.equal(context.canUploadScenario, false);
  assert.equal(context.canClearDynamic, true);

  // The device, target and in-flight gates still apply to clear.
  assert.deepEqual(clearGate({ scenario: unsaveable, device: "disconnected" }), ["deviceDisconnected"]);
  assert.deepEqual(
    clearGate({ scenario: editScenario(unsaveable, { targetObjectId: "dynamic-object-9" }) }),
    ["targetMissing"],
  );
  assert.deepEqual(clearGate({ scenario: unsaveable, operation: "upload" }), ["operationInProgress"]);
});

test("a reported capability without a selected scenario enables no device action", () => {
  // Upload and clear each address one object of the selected scenario, so an
  // unselected scenario leaves both unavailable instead of offering an action
  // the workspace would refuse.
  const uploadIssues = uploadBlockers({
    device: "ready",
    capability: clearGateCapability(),
    scenario: null,
    observation: noObservation,
  });
  assert.deepEqual(uploadIssues, ["targetMissing"]);
  assert.deepEqual(clearGate({ scenario: null }), ["targetMissing"]);

  const context = trayContextFromWorkspace({
    scenario: null,
    operation: null,
    uploadBlockers: uploadIssues,
    clearBlockers: clearGate({ scenario: null }),
  });
  assert.equal(context.scenarioName, null);
  assert.equal(context.canUploadScenario, false);
  assert.equal(context.canClearDynamic, false);
  // Choosing the scenario only re-raises the window, which still exists.
  assert.equal(context.canChooseScenario, true);

  // An unknown capability keeps reporting discovery only: no capability means no
  // target to judge yet, not a missing one.
  assert.deepEqual(clearGate({ scenario: null, capability: null }), ["capabilityDiscovering"]);
});

test("the default context and equality helper describe an inert window", () => {
  // The connected workspace republishes exactly this value when it unmounts, so
  // the native menu can never keep a stale scenario name or a stale enabled action.
  assert.deepEqual(DEFAULT_WORKSPACE_TRAY_CONTEXT, {
    scenarioName: null,
    canChooseScenario: false,
    canUploadScenario: false,
    canClearDynamic: false,
  });
  assert.ok(sameWorkspaceTrayContext(DEFAULT_WORKSPACE_TRAY_CONTEXT, { ...DEFAULT_WORKSPACE_TRAY_CONTEXT }));
  const other: WorkspaceTrayContext = { ...DEFAULT_WORKSPACE_TRAY_CONTEXT, canUploadScenario: true };
  assert.equal(sameWorkspaceTrayContext(DEFAULT_WORKSPACE_TRAY_CONTEXT, other), false);
  assert.equal(sameWorkspaceTrayContext({ ...DEFAULT_WORKSPACE_TRAY_CONTEXT, scenarioName: "A" }, { ...DEFAULT_WORKSPACE_TRAY_CONTEXT, scenarioName: "B" }), false);
});
