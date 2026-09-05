import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertCircle, Eye, EyeOff, KeyRound, X } from "lucide-react";
import type { CommandError } from "../bridge";
import type { Locale, Messages } from "../i18n";
import { translateCommandError } from "../i18n";

type PasswordSetupModalProps = {
  copy: Messages;
  locale: Locale;
  mode: "setup" | "change";
  busy: boolean;
  externalErrorCode: string | null;
  onSkip?: () => void;
  onClose: () => void;
  onSubmit: (password: string) => Promise<CommandError | null>;
};

export function PasswordSetupModal({ copy, locale, mode, busy, externalErrorCode, onSkip, onClose, onSubmit }: PasswordSetupModalProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setPassword("");
    setConfirmation("");
    setVisible(false);
    setLocalError(null);
  }, [mode]);

  const title = mode === "setup" ? copy.setupPasswordTitle : copy.changePasswordTitle;
  const errorCode = localError ?? (password || confirmation ? null : externalErrorCode);
  const errorMessage = errorCode === "password_mismatch"
    ? copy.passwordMismatch
    : errorCode === "empty_password"
      ? copy.passwordRequired
      : errorCode
        ? translateCommandError(errorCode, locale)
        : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password) {
      setLocalError("empty_password");
      return;
    }
    if (password.normalize("NFC") !== confirmation.normalize("NFC")) {
      setLocalError("password_mismatch");
      return;
    }
    setLocalError(null);
    const result = await onSubmit(password);
    setPassword("");
    setConfirmation("");
    setVisible(false);
    if (result) setLocalError(result.code);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 px-6 py-8 backdrop-blur-[2px]" role="presentation">
      <section className="w-full max-w-[480px] rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/15" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{copy.authentication}</p>
            <h2 id="password-dialog-title" className="mt-1 text-xl font-semibold text-ink">{title}</h2>
          </div>
          {mode === "change" ? <button type="button" onClick={onClose} disabled={busy} aria-label={copy.close} className="grid h-9 w-9 place-items-center rounded-lg text-ink-subtle hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"><X className="h-4 w-4" aria-hidden="true" /></button> : null}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">{mode === "setup" ? copy.setupPasswordHelp : copy.changePasswordHelp}</p>
        <form onSubmit={(event) => { void submit(event); }} className="mt-6">
          <label htmlFor="new-management-password" className="text-sm font-medium text-ink">{copy.newManagementPassword}</label>
          <div className="relative mt-2.5">
            <input
              id="new-management-password"
              type={visible ? "text" : "password"}
              value={password}
              onChange={(event) => { setPassword(event.target.value); setLocalError(null); }}
              autoFocus
              autoComplete="new-password"
              disabled={busy}
              className="h-12 w-full rounded-xl border border-line-strong bg-surface px-4 pr-12 font-mono text-base tracking-[0.2em] text-ink"
            />
            <button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? copy.hidePassword : copy.showPassword} disabled={busy} className="absolute right-2 top-1.5 grid h-9 w-9 place-items-center rounded-lg text-ink-subtle hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">
              {visible ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
            </button>
          </div>
          <label htmlFor="confirm-management-password" className="mt-4 block text-sm font-medium text-ink">{copy.confirmManagementPassword}</label>
          <input
            id="confirm-management-password"
            type={visible ? "text" : "password"}
            value={confirmation}
            onChange={(event) => { setConfirmation(event.target.value); setLocalError(null); }}
            autoComplete="new-password"
            disabled={busy}
            aria-invalid={errorCode === "password_mismatch"}
            className={`mt-2.5 h-12 w-full rounded-xl border bg-surface px-4 font-mono text-base tracking-[0.2em] text-ink ${errorCode === "password_mismatch" ? "border-danger" : "border-line-strong"}`}
          />
          {errorMessage ? <p className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-danger" role="alert"><AlertCircle className="h-4 w-4" aria-hidden="true" />{errorMessage}</p> : <p className="mt-2.5 text-xs leading-relaxed text-ink-subtle">{copy.passwordProtocolHelp}</p>}
          <div className="mt-6 flex justify-end gap-3">
            {onSkip ? <button type="button" onClick={onSkip} disabled={busy} className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-medium text-ink-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40">{copy.skip}</button> : <button type="button" onClick={onClose} disabled={busy} className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-medium text-ink-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40">{copy.cancel}</button>}
            <button type="submit" disabled={busy || !password || !confirmation} className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-subtle"><KeyRound className="h-4 w-4" aria-hidden="true" />{busy ? copy.saving : mode === "setup" ? copy.setPassword : copy.changePassword}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
