type ConfiguredBytesSummaryProps = {
  label: string;
  valueLabel: string;
};

/** The protocol exposes configured byte lengths, not the device's true capacity. */
export function ConfiguredBytesSummary({ label, valueLabel }: ConfiguredBytesSummaryProps) {
  return (
    <div className="w-64">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        <span className="font-mono text-xs text-ink-muted">{valueLabel}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        <div className="h-full w-full rounded-full bg-accent opacity-70" />
      </div>
    </div>
  );
}
