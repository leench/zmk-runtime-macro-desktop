import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Messages } from "../i18n";
import { displayToken, tokensFromText } from "../utils/macro";

type SlotPreviewProps = {
  copy: Messages;
  text: string | null;
  length: number;
  loaded: boolean;
  loading: boolean;
  error: boolean;
  selected: boolean;
  disabled: boolean;
  previewCharacterCount: number;
  hoverRevealDelay: number;
};

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer !== null) clearTimeout(timer);
  return null;
}

export function SlotPreview({
  copy,
  text,
  length,
  loaded,
  loading,
  error,
  selected,
  disabled,
  previewCharacterCount,
  hoverRevealDelay,
}: SlotPreviewProps) {
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokens = useMemo(() => text === null ? [] : tokensFromText(text), [text]);
  const available = text !== null && loaded && !loading && !error;
  const totalTokens = available ? tokens.length : Math.max(0, length);
  const previewCount = available ? Math.min(Math.max(0, previewCharacterCount), tokens.length) : 0;

  useLayoutEffect(() => {
    timer.current = clearTimer(timer.current);
    setRevealed(false);
  }, [selected, text, loaded, loading, error, disabled, previewCharacterCount, hoverRevealDelay]);

  useEffect(() => () => {
    timer.current = clearTimer(timer.current);
  }, []);

  if (totalTokens === 0) {
    return available ? null : <span className="max-w-[148px] shrink-0 truncate px-1.5 py-1 text-[11px] text-ink-subtle">{copy.previewUnavailable}</span>;
  }

  const maskCount = Math.max(0, totalTokens - previewCount);
  const values = revealed && available
    ? tokens.map(displayToken)
    : [
      ...(available ? tokens.slice(0, previewCount).map(displayToken) : []),
      ...Array.from({ length: maskCount }, () => "*"),
    ];

  const hide = () => {
    timer.current = clearTimer(timer.current);
    setRevealed(false);
  };

  const revealAfterHover = () => {
    if (!available || disabled || hoverRevealDelay < 0) return;
    timer.current = clearTimer(timer.current);
    if (hoverRevealDelay === 0) {
      setRevealed(true);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      setRevealed(true);
    }, hoverRevealDelay * 1000);
  };

  const handleClick = (event: { detail: number }) => {
    if (!available || disabled) return;
    // Native keyboard activation has detail === 0. It toggles so Enter/Space
    // provide an explicit reveal affordance; pointer clicks reveal and remain
    // visible until the pointer leaves the preview zone.
    setRevealed((current) => event.detail === 0 ? !current : true);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={revealAfterHover}
      onMouseLeave={hide}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide();
      }}
      disabled={disabled || !available}
      aria-pressed={revealed}
      aria-label={revealed ? copy.hideSlotPreview : copy.revealSlotPreview}
      className="min-w-0 max-w-[148px] shrink-0 truncate rounded-md px-1.5 py-1 font-mono text-[11px] tracking-[0.12em] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span aria-hidden="true" className="inline-flex max-w-full overflow-hidden">
        {values.map((value, index) => (
          <span key={`${index}-${value}`} className="inline-block min-w-[0.6rem] text-center">{value}</span>
        ))}
      </span>
    </button>
  );
}
