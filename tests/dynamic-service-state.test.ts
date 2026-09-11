import assert from "node:assert/strict";
import { test } from "node:test";
import { getDynamicState } from "../src/bridge.ts";
import type {
  DynamicCapabilities,
  DynamicObjectObservation,
  DynamicObjectStatus,
  DynamicServiceState,
  DynamicServiceStatus,
} from "../src/bridge.ts";

/**
 * Frontend half of the Dynamic service contract.
 *
 * The Rust `get_dynamic_state` command publishes a body-free DTO: a service
 * status, capability metadata, a local generation counter and per-object byte
 * lengths. These checks pin the serialized names and keep the model body-free.
 * They never open HID, never touch a device and never store dynamic text.
 */

/** Serialized service status values, exactly as the Rust DTO publishes them. */
const SERVICE_STATUSES = [
  "unknown",
  "discovering",
  "ready",
  "unsupported",
  "uploading",
  "committedLocally",
  "clearing",
  "clearedLocally",
  "error",
] as const;

/** Serialized per-object observation values of the same DTO. */
const OBJECT_STATUSES = [
  "unknown",
  "uploading",
  "committedLocally",
  "clearing",
  "clearedLocally",
  "error",
] as const;

/** Every key the serialized service state and its object entries may expose. */
const SERVICE_STATE_KEYS = ["capabilities", "error", "generation", "objects", "status"] as const;
const OBJECT_KEYS = ["keepAfterExecute", "slot", "status", "textLength", "ttlSeconds"] as const;

const BODY_FREE_FORBIDDEN_KEYS = [
  "text",
  "draftText",
  "path",
  "devicePath",
  "serial",
  "serialNumber",
  "password",
  "token",
  "secret",
] as const;

function capabilities(): DynamicCapabilities {
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
  };
}

test("the service status vocabulary is the backend contract without duplicates", () => {
  const statuses: readonly DynamicServiceStatus[] = SERVICE_STATUSES;
  const objectStatuses: readonly DynamicObjectStatus[] = OBJECT_STATUSES;
  assert.deepEqual(
    [...statuses],
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
  assert.deepEqual(
    [...objectStatuses],
    ["unknown", "uploading", "committedLocally", "clearing", "clearedLocally", "error"],
  );
  assert.equal(new Set(statuses).size, statuses.length);
  assert.equal(new Set(objectStatuses).size, objectStatuses.length);
});

test("the service DTO exposes observed lengths and never dynamic text", () => {
  const observation: DynamicObjectObservation = {
    slot: 7,
    status: "committedLocally",
    textLength: 12,
    ttlSeconds: 60,
    keepAfterExecute: true,
  };
  const state: DynamicServiceState = {
    status: "committedLocally",
    capabilities: capabilities(),
    generation: 3,
    objects: [observation],
    error: null,
  };

  assert.deepEqual(Object.keys(state).sort(), [...SERVICE_STATE_KEYS]);
  assert.deepEqual(Object.keys(observation).sort(), [...OBJECT_KEYS]);
  // The backend only knows the byte length of an upload, so a body field must
  // never appear in the DTO.
  assert.equal(observation.textLength, 12);
  for (const key of [...Object.keys(state), ...Object.keys(observation)]) {
    assert.ok(
      !BODY_FREE_FORBIDDEN_KEYS.includes(key as (typeof BODY_FREE_FORBIDDEN_KEYS)[number]),
      `${key} must not be part of the Dynamic service DTO`,
    );
  }
});

test("getDynamicState never resolves a fabricated state outside a Tauri host", async () => {
  // The App reads the state through the Rust command only; a browser preview has
  // no backend state and must not invent one.
  await assert.rejects(() => getDynamicState());
});
