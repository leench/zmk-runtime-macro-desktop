import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FIRST_DYNAMIC_SLOT,
  MAX_DYNAMIC_BYTES,
  clearDynamicObjectFeedback,
  createDynamicObjectState,
  dynamicByteLength,
  dynamicLimits,
  dynamicObjectSlots,
  dynamicTtlPresets,
  normalizeDynamicObjects,
  resetDynamicObjectOperation,
  validateDynamicText,
  validateDynamicTtl,
} from "../src/utils/dynamic.ts";
import type { DynamicCapabilities } from "../src/bridge.ts";

/**
 * Pure state-model checks for the dynamic object collection. They never touch
 * HID, React or storage: dynamic text stays in memory and is not persisted.
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
    transactionTimeoutSeconds: 5,
    clearOnBoot: false,
    clearOnTtlExpiry: false,
    clearOnExecutionAccept: true,
    clearOnUsbDisconnect: false,
    clearOnBleProfileChange: false,
    clearOnSelectedEndpointChange: false,
    supportsKeepAfterExecute: true,
    ...overrides,
  };
}

test("fallback limits apply only while the capability is unknown", () => {
  assert.deepEqual(dynamicLimits(null), { maxBytes: 512, minTtlSeconds: 1, maxTtlSeconds: 86_400, defaultTtlSeconds: 300 });
  assert.equal(MAX_DYNAMIC_BYTES, 512);
  assert.equal(FIRST_DYNAMIC_SLOT, 0);
  assert.deepEqual(dynamicObjectSlots(null), []);
});

test("device capability drives object size, TTL bounds and TTL presets", () => {
  const limited = capabilities({ dynamicObjectCount: 1, maxDynamicLength: 128, defaultTtlSeconds: 60, minTtlSeconds: 5, maxTtlSeconds: 3600 });
  assert.deepEqual(dynamicLimits(limited), { maxBytes: 128, minTtlSeconds: 5, maxTtlSeconds: 3600, defaultTtlSeconds: 60 });
  assert.deepEqual(dynamicTtlPresets(dynamicLimits(limited)), [10, 60, 300, 3600]);
  assert.deepEqual(dynamicObjectSlots(limited), [0]);
});

test("object slots follow the reported count instead of a hardcoded list", () => {
  assert.deepEqual(dynamicObjectSlots(capabilities({ dynamicObjectCount: 1 })), [0]);
  assert.deepEqual(dynamicObjectSlots(capabilities({ dynamicObjectCount: 3 })), [0, 1, 2]);
  assert.deepEqual(dynamicObjectSlots(capabilities({ dynamicObjectCount: 8 })), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("text validation uses the capability length limit", () => {
  assert.equal(validateDynamicText("a".repeat(128), 128), null);
  assert.equal(validateDynamicText("a".repeat(129), 128), "tooLong");
  assert.equal(validateDynamicText("a".repeat(129), MAX_DYNAMIC_BYTES), null);
  assert.equal(validateDynamicText("", 128), "empty");
  assert.equal(validateDynamicText("é", 512), "unsupported");
  assert.equal(validateDynamicText("line\n\ttab\u0008", 512), null);
  assert.equal(dynamicByteLength("é"), 2);
});

test("TTL validation uses the capability bounds and keeps null as the device default", () => {
  const limits = dynamicLimits(capabilities({ minTtlSeconds: 5, maxTtlSeconds: 3600 }));
  assert.equal(validateDynamicTtl(null, limits), null);
  assert.equal(validateDynamicTtl(60, limits), null);
  assert.equal(validateDynamicTtl(4, limits), "ttlInvalid");
  assert.equal(validateDynamicTtl(86_400, limits), "ttlInvalid");
  assert.equal(validateDynamicTtl(Number.NaN, limits), "ttlInvalid");
  assert.equal(validateDynamicTtl(86_400, dynamicLimits(null)), null);
});

test("capability refresh keeps surviving objects and drops the rest", () => {
  const seeded = [createDynamicObjectState(FIRST_DYNAMIC_SLOT)];
  assert.deepEqual(seeded[0], { slot: 0, draftText: "", ttlSeconds: null, keepAfterExecute: false, status: "idle", progress: null, error: null, clearConfirm: false });

  const withDraft = [{ ...seeded[0], draftText: "keep me", ttlSeconds: 60 }];
  const grown = normalizeDynamicObjects(withDraft, dynamicObjectSlots(capabilities()), true);
  assert.equal(grown.length, 8);
  assert.equal(grown[0].draftText, "keep me");
  assert.equal(grown[7].slot, 7);
  assert.equal(grown[7].draftText, "");

  const perSlot = grown.map((state) => state.slot === 7 ? { ...state, draftText: "slot seven", status: "committed", clearConfirm: true } : state);
  const trimmed = normalizeDynamicObjects(perSlot, [0], true);
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].draftText, "keep me");
  assert.equal(normalizeDynamicObjects(trimmed, dynamicObjectSlots(capabilities()), true)[7].draftText, "");
});

test("keep-after-execute is cleared when the device cannot retain the object", () => {
  const kept = [createDynamicObjectState(0), createDynamicObjectState(1)].map((state) => ({ ...state, keepAfterExecute: true }));
  const normalized = normalizeDynamicObjects(kept, [0, 1], false);
  assert.deepEqual(normalized.map((state) => state.keepAfterExecute), [false, false]);
});

test("operation resets keep the in-memory draft and TTL choice", () => {
  const busy = {
    ...createDynamicObjectState(7),
    draftText: "typed",
    ttlSeconds: 10,
    keepAfterExecute: true,
    status: "uploading" as const,
    progress: 25,
    error: { code: "command_failed", message: "" },
    clearConfirm: true,
  };
  const reset = resetDynamicObjectOperation(busy);
  assert.equal(reset.draftText, "typed");
  assert.equal(reset.ttlSeconds, 10);
  assert.equal(reset.keepAfterExecute, true);
  assert.deepEqual(
    { status: reset.status, progress: reset.progress, error: reset.error, clearConfirm: reset.clearConfirm },
    { status: "idle", progress: null, error: null, clearConfirm: false },
  );

  const refreshed = clearDynamicObjectFeedback(busy);
  assert.equal(refreshed.draftText, "typed");
  assert.equal(refreshed.progress, null);
  assert.equal(refreshed.error, null);
  assert.equal(clearDynamicObjectFeedback({ ...busy, status: "committed" }).status, "committed");
  assert.equal(clearDynamicObjectFeedback({ ...busy, status: "error" }).status, "idle");
});
