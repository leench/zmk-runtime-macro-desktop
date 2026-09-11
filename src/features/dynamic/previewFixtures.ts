/**
 * In-memory preview fixtures for the Dynamic workspace.
 *
 * They exist so every state of the review matrix can be inspected without a
 * device: no HID, no Tauri command, no storage, no persistence. Fixture object
 * ids, counts and limits stand in for `CAPABILITIES` values and are never
 * interpreted as a wire contract by the UI.
 */

import type {
  DynamicCapabilitiesPresentation,
  DynamicLifecyclePresentation,
  DynamicObjectPresentation,
  PreviewFixture,
  PreviewScenarioLabels,
  PreviewStateId,
  ScenarioSeed,
} from "../../types/scenario";
import { createScenario } from "../../utils/scenario.ts";

const DEVICE_MAX_LENGTH = 512;
const DEVICE_TTL = { defaultSeconds: 300, minSeconds: 1, maxSeconds: 86_400 };

/** Sample macro content is generic, non-secret printable ASCII. */
const TEXT_GIT_STATUS = "git status\n";
const TEXT_GIT_FETCH = "git fetch\n";
const TEXT_GIT_FETCH_PRUNED = "git fetch --all --prune\n";
const TEXT_NPM_BUILD = "npm run build\n";
const TEXT_LOG_TAIL = "journalctl -f --since today\n";
/** Deliberately longer than the 128-byte limit of the oversize fixture. */
const TEXT_LONG = `${Array.from({ length: 6 }, () => "journalctl -f --since today").join("\n")}\n`;

function defaultLifecycle(overrides: Partial<DynamicLifecyclePresentation> = {}): DynamicLifecyclePresentation {
  return {
    clearOnBoot: false,
    clearOnTtlExpiry: false,
    clearOnExecutionAccept: true,
    clearOnUsbDisconnect: false,
    clearOnBleProfileChange: false,
    clearOnSelectedEndpointChange: false,
    ...overrides,
  };
}

/**
 * Fixtures report no display alias, so the UI shows the positional label. The
 * field exists because a real capability may provide an alias later.
 */
function objectPresentation(index: number, overrides: Partial<DynamicObjectPresentation> = {}): DynamicObjectPresentation {
  return {
    objectId: `object-${index + 1}`,
    displayLabel: "",
    maxLength: DEVICE_MAX_LENGTH,
    ttl: { ...DEVICE_TTL },
    supportsKeepAfterExecute: true,
    ...overrides,
  };
}

function capability(
  count: number,
  overrides: { lifecycle?: Partial<DynamicLifecyclePresentation>; object?: (index: number) => Partial<DynamicObjectPresentation> } = {},
): DynamicCapabilitiesPresentation {
  return {
    capabilityVersion: 2,
    objects: Array.from({ length: count }, (_, index) => objectPresentation(index, overrides.object?.(index) ?? {})),
    lifecycle: defaultLifecycle(overrides.lifecycle),
  };
}

type FixtureSpec = {
  device?: PreviewFixture["device"];
  staticLocked?: boolean;
  notice?: PreviewFixture["notice"];
  capability?: DynamicCapabilitiesPresentation | null;
  observation?: Partial<PreviewFixture["observation"]>;
  seeds?: (labels: PreviewScenarioLabels) => ScenarioSeed[];
  selectedIndex?: number | null;
};

const SPECS: Record<PreviewStateId, FixtureSpec> = {
  empty: {
    seeds: () => [],
  },
  new: {
    seeds: () => [{ isNew: true, draft: {} }],
  },
  dirty: {
    seeds: (labels) => [
      {
        draft: { name: labels.workTerminal, text: TEXT_GIT_FETCH_PRUNED, targetObjectId: "object-1" },
        saved: { name: labels.workTerminal, text: TEXT_GIT_FETCH, targetObjectId: "object-1" },
      },
      { draft: { name: labels.buildWatch, text: TEXT_NPM_BUILD, targetObjectId: "object-3", ttlSeconds: 60 } },
    ],
  },
  disconnected: {
    device: "disconnected",
    capability: null,
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1" } },
      { draft: { name: labels.scratch, text: TEXT_LOG_TAIL } },
    ],
  },
  unknown: {
    device: "unknown",
    capability: null,
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1" } },
    ],
  },
  discovering: {
    device: "discovering",
    capability: null,
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1" } },
    ],
  },
  unsupported: {
    device: "unsupported",
    capability: null,
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1" } },
    ],
  },
  ready: {
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1" } },
      { draft: { name: labels.buildWatch, text: TEXT_NPM_BUILD, targetObjectId: "object-3", ttlSeconds: 60, keepAfterExecute: true } },
    ],
  },
  uploading: {
    observation: { status: "uploading", targetObjectId: "object-1" },
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1" } },
    ],
  },
  committed: {
    observation: { status: "committed", targetObjectId: "object-1" },
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1" } },
      { draft: { name: labels.buildWatch, text: TEXT_NPM_BUILD, targetObjectId: "object-3" } },
    ],
  },
  clearing: {
    observation: { status: "clearing", targetObjectId: "object-1" },
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1" } },
    ],
  },
  cleared: {
    observation: { status: "cleared", targetObjectId: "object-1" },
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1" } },
    ],
  },
  error: {
    observation: { status: "error", targetObjectId: "object-1", errorKind: "interrupted" },
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1" } },
    ],
  },
  staticLocked: {
    staticLocked: true,
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-2" } },
    ],
  },
  keepUnsupported: {
    capability: capability(8, { object: () => ({ supportsKeepAfterExecute: false }) }),
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1", keepAfterExecute: true } },
    ],
  },
  targetMissing: {
    // A single-object device whose saved target is gone: the sole object must
    // stay an explicit rebind action instead of being adopted silently.
    capability: capability(1),
    seeds: (labels) => [
      // `object-9` was reported by an earlier capability and no longer exists.
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-9" } },
    ],
  },
  capabilityChanged: {
    notice: "capabilityChanged",
    capability: capability(1, { object: () => ({ ttl: { defaultSeconds: 30, minSeconds: 1, maxSeconds: 60 } }) }),
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_GIT_STATUS, targetObjectId: "object-1", ttlSeconds: 3600 } },
    ],
  },
  oversize: {
    capability: capability(1, { object: () => ({ maxLength: 128 }) }),
    seeds: (labels) => [
      { draft: { name: labels.workTerminal, text: TEXT_LONG, targetObjectId: "object-1" } },
    ],
  },
};

function seedScenario(state: PreviewStateId, index: number, seed: ScenarioSeed) {
  return createScenario(`${state}-${index + 1}`, seed.draft, { saved: seed.saved, isNew: seed.isNew });
}

/** Build the fixture for one preview state; seeds carry localized sample names. */
export function buildPreviewFixture(state: PreviewStateId, labels: PreviewScenarioLabels): PreviewFixture {
  const spec = SPECS[state];
  const scenarios = (spec.seeds?.(labels) ?? []).map((seed, index) => seedScenario(state, index, seed));
  const selectedIndex = spec.selectedIndex === undefined
    ? (scenarios.length > 0 ? 0 : null)
    : spec.selectedIndex;
  return {
    device: spec.device ?? "ready",
    staticLocked: spec.staticLocked ?? false,
    notice: spec.notice ?? null,
    capability: spec.capability === undefined ? capability(8) : spec.capability,
    observation: { status: "none", targetObjectId: null, errorKind: null, ...spec.observation },
    scenarios,
    selectedIndex,
  };
}
