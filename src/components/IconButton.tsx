import type { LucideIcon } from "lucide-react";

type IconButtonProps = {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Inside a filled container (e.g. a bg-surface-2 preference group) hover steps up to surface-3 instead of surface-2. */
  grouped?: boolean;
  /** Compact variant for the 48px title bar, where the default 40px button would touch the bar edges. */
  size?: "md" | "sm";
};

export function IconButton({ icon: Icon, label, onClick, active = false, disabled = false, grouped = false, size = "md" }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`grid ${size === "sm" ? "h-8 w-8" : "h-10 w-10"} place-items-center rounded-lg border transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40 ${active ? "border-line-strong bg-surface-3 text-ink" : `border-transparent text-ink-muted ${grouped ? "hover:bg-surface-3" : "hover:bg-surface-2"} hover:text-ink`}`}
    >
      <Icon className={size === "sm" ? "h-4 w-4" : "h-[19px] w-[19px]"} aria-hidden="true" />
    </button>
  );
}
