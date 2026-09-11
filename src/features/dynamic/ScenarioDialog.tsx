import type { Messages } from "../../i18n";

type ScenarioDialogProps = {
  copy: Messages;
  eyebrow: string;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirmation dialog for scenario and preview actions. It reuses the existing
 * modal surface styling so the workspace stays inside the MagicPatterns system.
 */
export function ScenarioDialog({ copy, eyebrow, title, message, confirmLabel, danger = false, onConfirm, onCancel }: ScenarioDialogProps) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 px-6 py-8 backdrop-blur-[2px]" role="presentation">
      <section
        className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/15"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scenario-dialog-title"
        aria-describedby="scenario-dialog-message"
      >
        <p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{eyebrow}</p>
        <h2 id="scenario-dialog-title" className="mt-1.5 text-xl font-semibold text-ink">{title}</h2>
        <p id="scenario-dialog-message" className="mt-3 text-sm leading-relaxed text-ink-muted">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-medium text-ink-muted hover:bg-surface-2"
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium hover:opacity-90 ${danger ? "bg-danger text-white" : "bg-accent text-accent-ink"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
