import { X } from "lucide-react";
import type { Messages } from "../i18n";
import { DynamicMacroPanel, type DynamicMacroPanelProps } from "./DynamicMacroPanel";

type DynamicMacroModalProps = Omit<DynamicMacroPanelProps, "embedded" | "copy"> & {
  copy: Messages;
  onClose: () => void;
};

export function DynamicMacroModal({ copy, onClose, disabled, ...panelProps }: DynamicMacroModalProps) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 px-6 py-8 backdrop-blur-[2px]" role="presentation">
      <section
        className="relative w-[760px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-48px)] overflow-y-auto rounded-2xl border border-line bg-surface shadow-2xl shadow-black/15"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dynamic-macro-heading"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={disabled}
          aria-label={copy.close}
          className="absolute right-5 top-5 z-10 grid h-9 w-9 place-items-center rounded-lg text-ink-subtle hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <DynamicMacroPanel copy={copy} embedded disabled={disabled} {...panelProps} />
      </section>
    </div>
  );
}
