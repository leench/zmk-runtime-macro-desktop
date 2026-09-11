import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Maximize, Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Platform = "macos" | "windows" | "linux";

export type TitleBarLabels = {
  close: string;
  minimize: string;
  maximize: string;
};

type TitleBarProps = {
  platform: Platform;
  title: string;
  labels: TitleBarLabels;
  /** Optional compact control cluster placed left of the window controls. */
  actions?: ReactNode;
};

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function windowAction(action: "close" | "minimize" | "maximize"): Promise<void> {
  if (!inTauri()) return;
  try {
    const appWindow = getCurrentWindow();
    if (action === "close") await appWindow.close();
    else if (action === "minimize") await appWindow.minimize();
    else await appWindow.toggleMaximize();
  } catch {
    // Browser preview and an already-closing window are safe no-ops.
  }
}

function beginDrag(event: ReactMouseEvent<HTMLElement>): void {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button") || !inTauri()) return;
  void getCurrentWindow().startDragging().catch(() => undefined);
}

function toggleMaximizeOnDoubleClick(event: ReactMouseEvent<HTMLElement>): void {
  if ((event.target as HTMLElement).closest("button") || !inTauri()) return;
  void getCurrentWindow().toggleMaximize().catch(() => undefined);
}

export function TitleBar({ platform, title, labels, actions }: TitleBarProps) {
  const mac = platform === "macos";
  const controlClass = mac
    ? "h-3.5 w-3.5 rounded-full"
    : "grid h-7 w-7 place-items-center rounded-full bg-surface-3 text-ink-muted transition-colors duration-150 ease-out hover:bg-line-strong hover:text-ink";
  const controlIconClass = mac ? "h-3.5 w-3.5 opacity-0" : "h-3.5 w-3.5";
  const controls = (
    <div className={`flex items-center ${mac ? "gap-2" : "gap-2"}`} role="group" aria-label={labels.close}>
      <button
        type="button"
        aria-label={mac ? labels.close : labels.minimize}
        className={`${controlClass} ${mac ? "bg-[#ec6a5e]" : ""}`}
        onClick={() => void windowAction(mac ? "close" : "minimize")}
      >
        {mac ? null : <Minus className={controlIconClass} aria-hidden="true" />}
      </button>
      <button
        type="button"
        aria-label={mac ? labels.minimize : labels.maximize}
        className={`${controlClass} ${mac ? "bg-[#f4bf50]" : ""}`}
        onClick={() => void windowAction(mac ? "minimize" : "maximize")}
      >
        {mac ? null : <Maximize className={controlIconClass} aria-hidden="true" />}
      </button>
      <button
        type="button"
        aria-label={mac ? labels.maximize : labels.close}
        className={`${controlClass} ${mac ? "bg-[#61c454]" : "hover:bg-[#c4423d] hover:text-white"}`}
        onClick={() => void windowAction(mac ? "maximize" : "close")}
      >
        {mac ? null : <X className={controlIconClass} aria-hidden="true" />}
      </button>
    </div>
  );

  // Buttons already opt out of dragging in beginDrag; the wrapper must too so
  // the gap between them never starts a window drag. Double click stays on the
  // header, so maximize/restore keeps working everywhere on the bar.
  const actionGroup = actions ? (
    <div className="flex items-center" onMouseDown={(event) => event.stopPropagation()}>
      {actions}
    </div>
  ) : null;

  return (
    <header
      className={mac ? "flex h-12 shrink-0 items-center border-b border-line bg-surface-2 px-4" : "flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface-2 px-4"}
      data-tauri-drag-region="true"
      onMouseDown={beginDrag}
      onDoubleClick={toggleMaximizeOnDoubleClick}
    >
      {mac ? (
        <>
          {controls}
          <span className="flex-1 text-center text-sm font-semibold text-ink-muted">{title}</span>
          {actionGroup ? <span className="flex min-w-[74px] items-center justify-end">{actionGroup}</span> : <span className="w-[74px]" aria-hidden="true" />}
        </>
      ) : (
        <>
          <span className="text-sm font-semibold text-ink">{title}</span>
          <span className="flex items-center gap-2">
            {actionGroup}
            {controls}
          </span>
        </>
      )}
    </header>
  );
}
