import { ChevronRight } from "lucide-react";
import type { Messages } from "../../i18n";
import type { DynamicCapabilitiesPresentation, DynamicObjectPresentation } from "../../types/scenario";

type DynamicCapabilityDetailsProps = {
  copy: Messages;
  capability: DynamicCapabilitiesPresentation | null;
  object: DynamicObjectPresentation | null;
  objectIndex: number;
};

function yesNo(copy: Messages, value: boolean): string {
  return value ? copy.dynamicYes : copy.dynamicNo;
}

/**
 * Collapsed device behavior and capability details. Lifecycle flags, TTL ranges
 * and keep support stay out of the primary task while remaining inspectable.
 */
export function DynamicCapabilityDetails({ copy, capability, object, objectIndex }: DynamicCapabilityDetailsProps) {
  return (
    <details className="group mt-4 rounded-2xl border border-line bg-surface-2 px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink marker:content-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-150 ease-out group-open:rotate-90" aria-hidden="true" />
        {copy.dynamicCapabilityDetails}
      </summary>
      {capability ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs text-ink-muted md:grid-cols-3">
            <div><dt className="text-ink-subtle">{copy.dynamicCapabilityVersion}</dt><dd className="mt-0.5 font-mono text-ink">{capability.capabilityVersion}</dd></div>
            <div><dt className="text-ink-subtle">{copy.dynamicCapabilityObjectCount}</dt><dd className="mt-0.5 font-mono text-ink">{capability.objects.length}</dd></div>
            <div><dt className="text-ink-subtle">{copy.dynamicCapabilityMaxBytesLabel}</dt><dd className="mt-0.5 font-mono text-ink">{object ? copy.dynamicMaxBytes(object.maxLength) : copy.none}</dd></div>
            <div><dt className="text-ink-subtle">{copy.dynamicCapabilityObject}</dt><dd className="mt-0.5 font-mono text-ink">{object ? copy.dynamicObjectLabel(objectIndex + 1) : copy.none}</dd></div>
            <div><dt className="text-ink-subtle">{copy.dynamicCapabilityTtlDefault}</dt><dd className="mt-0.5 font-mono text-ink">{object ? `${object.ttl.defaultSeconds} ${copy.seconds}` : copy.none}</dd></div>
            <div><dt className="text-ink-subtle">{copy.dynamicCapabilityTtlRange}</dt><dd className="mt-0.5 font-mono text-ink">{object ? `${object.ttl.minSeconds}–${object.ttl.maxSeconds} ${copy.seconds}` : copy.none}</dd></div>
            <div><dt className="text-ink-subtle">{copy.dynamicCapabilityKeep}</dt><dd className="mt-0.5 text-ink">{object ? yesNo(copy, object.supportsKeepAfterExecute) : copy.none}</dd></div>
          </dl>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-3.5 text-xs text-ink-muted md:grid-cols-3">
            <div><dt className="inline text-ink-subtle">{copy.dynamicLifecycleBoot}: </dt><dd className="inline">{yesNo(copy, capability.lifecycle.clearOnBoot)}</dd></div>
            <div><dt className="inline text-ink-subtle">{copy.dynamicLifecycleTtl}: </dt><dd className="inline">{yesNo(copy, capability.lifecycle.clearOnTtlExpiry)}</dd></div>
            <div><dt className="inline text-ink-subtle">{copy.dynamicLifecycleExecute}: </dt><dd className="inline">{yesNo(copy, capability.lifecycle.clearOnExecutionAccept)}</dd></div>
            <div><dt className="inline text-ink-subtle">{copy.dynamicLifecycleUsb}: </dt><dd className="inline">{yesNo(copy, capability.lifecycle.clearOnUsbDisconnect)}</dd></div>
            <div><dt className="inline text-ink-subtle">{copy.dynamicLifecycleBle}: </dt><dd className="inline">{yesNo(copy, capability.lifecycle.clearOnBleProfileChange)}</dd></div>
            <div><dt className="inline text-ink-subtle">{copy.dynamicLifecycleEndpoint}: </dt><dd className="inline">{yesNo(copy, capability.lifecycle.clearOnSelectedEndpointChange)}</dd></div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-ink-subtle">{copy.dynamicCapabilityNote}</p>
        </>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-ink-subtle">{copy.dynamicTargetPendingHelp}</p>
      )}
    </details>
  );
}
