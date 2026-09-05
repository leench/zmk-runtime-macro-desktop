import type { LucideIcon } from "lucide-react";

type IconButtonProps = {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
};

export function IconButton({ icon: Icon, label, onClick, active = false, disabled = false }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`grid h-10 w-10 place-items-center rounded-lg border transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40 ${active ? "border-line-strong bg-surface-3 text-ink" : "border-transparent text-ink-muted hover:bg-surface-2 hover:text-ink"}`}
    >
      <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
    </button>
  );
}
