/**
 * Pure scenario/dynamic-target helpers for the page-level Dynamic workspace.
 *
 * These functions only transform in-memory data: no HID, no Tauri command, no
 * storage and no logging. Dynamic text stays inside the React session.
 */

import type {
  DynamicCapabilitiesPresentation,
  DynamicObjectPresentation,
  DynamicObservation,
  PreviewDeviceState,
  Scenario,
  ScenarioFields,
} from "../types/scenario";
import { dynamicByteLength, validateDynamicText } from "./dynamic.ts";

/** Pseudo value for "no target object chosen yet". */
export const TARGET_NONE = "";
/** Pseudo value for a saved target that the current capability does not report. */
export const TARGET_MISSING = "__missing";

export function emptyScenarioFields(): ScenarioFields {
  return { name: "", text: "", ttlSeconds: null, keepAfterExecute: false, targetObjectId: null };
}

export function createScenario(
  id: string,
  draft: Partial<ScenarioFields> = {},
  options: { saved?: Partial<ScenarioFields>; isNew?: boolean } = {},
): Scenario {
  const fields: ScenarioFields = { ...emptyScenarioFields(), ...draft };
  return {
    id,
    draft: fields,
    saved: { ...fields, ...options.saved },
    isNew: options.isNew ?? false,
  };
}

export function editScenario(scenario: Scenario, patch: Partial<ScenarioFields>): Scenario {
  return { ...scenario, draft: { ...scenario.draft, ...patch } };
}

export function sameScenarioFields(left: ScenarioFields, right: ScenarioFields): boolean {
  return left.name === right.name
    && left.text === right.text
    && left.ttlSeconds === right.ttlSeconds
    && left.keepAfterExecute === right.keepAfterExecute
    && left.targetObjectId === right.targetObjectId;
}

/** A never-saved scenario is dirty until its first local save. */
export function isScenarioDirty(scenario: Scenario): boolean {
  return scenario.isNew || !sameScenarioFields(scenario.draft, scenario.saved);
}

/** Whether the draft holds anything worth saving or warning about. */
export function hasScenarioContent(scenario: Scenario): boolean {
  return scenario.draft.name.trim().length > 0 || scenario.draft.text.length > 0 || scenario.draft.targetObjectId !== null;
}

/** Save is local to this in-memory session: the draft becomes the saved snapshot. */
export function saveScenario(scenario: Scenario): Scenario {
  return { ...scenario, saved: scenario.draft, isNew: false };
}

export function scenariosMatch(left: readonly Scenario[], right: readonly Scenario[]): boolean {
  return left.length === right.length && left.every((scenario, index) => {
    const other = right[index];
    return scenario.id === other.id
      && scenario.isNew === other.isNew
      && sameScenarioFields(scenario.draft, other.draft)
      && sameScenarioFields(scenario.saved, other.saved);
  });
}

export function findTargetObject(
  capability: DynamicCapabilitiesPresentation | null,
  objectId: string | null,
): DynamicObjectPresentation | null {
  if (!capability || !objectId) return null;
  return capability.objects.find((object) => object.objectId === objectId) ?? null;
}

/** Selector value for the current target: the object id, or a pseudo value. */
export function targetSelectorValue(
  capability: DynamicCapabilitiesPresentation | null,
  targetObjectId: string | null,
): string {
  if (!targetObjectId) return TARGET_NONE;
  // Without a capability nothing can be resolved, and a saved target is never
  // silently remapped to another object.
  if (!capability) return TARGET_MISSING;
  return findTargetObject(capability, targetObjectId) ? targetObjectId : TARGET_MISSING;
}

export type TargetRowState = {
  /** Value for the read-only row or selector: object id, TARGET_NONE or TARGET_MISSING. */
  value: string;
  /** The saved target is not reported by the current capability. */
  missing: boolean;
  /** Sole object of a single-object capability; null when the count is not exactly one. */
  soleObject: DynamicObjectPresentation | null;
  /** The sole object is the resolved target, so the row may present it as the current target. */
  soleObjectBound: boolean;
};

/**
 * Presentation of the target object row against the current capability.
 *
 * A single-object capability is never adopted silently: while the saved target
 * is unresolved, its only object stays an explicit rebind action and the row
 * reports the unresolved saved state instead of a target.
 */
export function targetRowState(
  capability: DynamicCapabilitiesPresentation | null,
  targetObjectId: string | null,
): TargetRowState {
  const objects = capability?.objects ?? [];
  const value = targetSelectorValue(capability, targetObjectId);
  const soleObject = objects.length === 1 ? objects[0] : null;
  return {
    value,
    missing: capability !== null && value === TARGET_MISSING,
    soleObject,
    soleObjectBound: soleObject !== null && targetObjectId === soleObject.objectId,
  };
}

/** Capability-driven limits of one target object, in `DynamicLimits` shape. */
export function objectLimits(object: DynamicObjectPresentation) {
  return {
    maxBytes: object.maxLength,
    minTtlSeconds: object.ttl.minSeconds,
    maxTtlSeconds: object.ttl.maxSeconds,
    defaultTtlSeconds: object.ttl.defaultSeconds,
  };
}

/**
 * Rendered object label: the device alias when present, else a positional label.
 * Positions are 1-based for the user, matching the static slot list; the object
 * id stays opaque and is never derived from the label.
 */
export function objectDisplayLabel(object: DynamicObjectPresentation, index: number, fallback: (position: number) => string): string {
  return object.displayLabel || fallback(index + 1);
}

export function scenarioByteLength(text: string): number {
  return dynamicByteLength(text);
}

export type ScenarioBlocker =
  | "deviceDisconnected"
  | "deviceUnknown"
  | "capabilityDiscovering"
  | "dynamicUnsupported"
  | "operationInProgress"
  | "targetMissing"
  | "textEmpty"
  | "textUnsupported"
  | "textTooLong"
  | "ttlInvalid"
  | "keepUnsupported";

export type ScenarioGate = {
  device: PreviewDeviceState;
  capability: DynamicCapabilitiesPresentation | null;
  scenario: Scenario | null;
  observation: DynamicObservation;
};

function deviceBlockers(gate: ScenarioGate): ScenarioBlocker[] {
  const blockers: ScenarioBlocker[] = [];
  if (gate.device === "disconnected") blockers.push("deviceDisconnected");
  else if (gate.device === "unknown") blockers.push("deviceUnknown");
  else if (gate.device === "unsupported") blockers.push("dynamicUnsupported");
  else if (gate.device === "discovering" || !gate.capability) blockers.push("capabilityDiscovering");
  if (gate.observation.status === "uploading" || gate.observation.status === "clearing") blockers.push("operationInProgress");
  return blockers;
}

function targetBlockers(gate: ScenarioGate): ScenarioBlocker[] {
  const scenario = gate.scenario;
  if (!scenario || !gate.capability) return [];
  if (!scenario.draft.targetObjectId || !findTargetObject(gate.capability, scenario.draft.targetObjectId)) return ["targetMissing"];
  return [];
}

/** Reasons Save & upload stays disabled; empty means the action is available. */
export function uploadBlockers(gate: ScenarioGate): ScenarioBlocker[] {
  const blockers = [...deviceBlockers(gate), ...targetBlockers(gate)];
  const scenario = gate.scenario;
  const object = scenario ? findTargetObject(gate.capability, scenario.draft.targetObjectId) : null;
  if (scenario && object) {
    const textError = validateDynamicText(scenario.draft.text, object.maxLength);
    if (textError === "empty") blockers.push("textEmpty");
    else if (textError === "tooLong") blockers.push("textTooLong");
    else if (textError === "unsupported") blockers.push("textUnsupported");
    if (scenario.draft.ttlSeconds !== null
      && (!Number.isInteger(scenario.draft.ttlSeconds)
        || scenario.draft.ttlSeconds < object.ttl.minSeconds
        || scenario.draft.ttlSeconds > object.ttl.maxSeconds)) {
      blockers.push("ttlInvalid");
    }
    if (scenario.draft.keepAfterExecute && !object.supportsKeepAfterExecute) blockers.push("keepUnsupported");
  }
  return blockers;
}

/** Reasons Clear device stays disabled; text, TTL and keep do not matter here. */
export function clearBlockers(gate: ScenarioGate): ScenarioBlocker[] {
  return [...deviceBlockers(gate), ...targetBlockers(gate)];
}
