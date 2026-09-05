import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertCircle, ArrowLeft, Eye, EyeOff, Lock, Unlock as UnlockIcon } from "lucide-react";
import type { CommandError, ConnectedDevice } from "../bridge";
import type { Locale, Messages } from "../i18n";
import { translateCommandError } from "../i18n";
import { TitleBar, type Platform } from "../components/TitleBar";

type UnlockProps = {
  copy: Messages;
  locale: Locale;
  platform: Platform;
  device: ConnectedDevice;
  credentialInvalid: boolean;
  busy: boolean;
  externalErrorCode: string | null;
  onBack: () => void;
  onUnlock: (password: string) => Promise<CommandError | null>;
};

export function Unlock({ copy, locale, platform, device, credentialInvalid, busy, externalErrorCode, onBack, onUnlock }: UnlockProps) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setPassword("");
    setVisible(false);
    setLocalError(null);
  }, [device.vendorId, device.productId, device.interfaceNumber, credentialInvalid]);

  const errorCode = localError ?? (password ? null : externalErrorCode);
  const errorMessage = errorCode ? (errorCode === "credential_invalid" ? copy.credentialInvalid : errorCode === "empty_password" ? copy.passwordRequired : translateCommandError(errorCode, locale)) : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password) {
      setLocalError("empty_password");
      return;
    }
    setLocalError(null);
    const result = await onUnlock(password);
    setPassword("");
    setVisible(false);
    if (result) setLocalError(result.code);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      <TitleBar platform={platform} title={copy.appName} labels={{ close: copy.close, minimize: copy.minimize, maximize: copy.maximize }} />
      <main className="flex flex-1 items-center justify-center overflow-y-auto px-8 py-10">
        <div className="w-full max-w-[420px]">
          <button type="button" onClick={onBack} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg pr-3 text-sm font-medium text-ink-muted transition-colors duration-150 ease-out hover:text-ink disabled:cursor-not-allowed disabled:opacity-50">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {copy.chooseOtherDevice}
          </button>

          <div className="mt-6 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Lock className="h-7 w-7" aria-hidden="true" />
            </span>
            <h1 className="mt-5 text-2xl font-semibold text-ink">{credentialInvalid ? copy.credentialInvalidTitle : copy.unlockTitle}</h1>
            <p className="mt-2 font-mono text-sm text-ink-muted">{device.productName || copy.unnamedDevice}</p>
          </div>

          {credentialInvalid ? (
            <div className="mt-8 flex items-start gap-3 rounded-xl border border-warning bg-warning-soft px-4 py-3 text-sm text-warning" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <strong className="font-semibold">{copy.credentialInvalid}</strong>
                <p className="mt-1 leading-relaxed">{copy.credentialInvalidHelp}</p>
              </div>
            </div>
          ) : (
            <form onSubmit={(event) => { void submit(event); }} className="mt-8">
              <label htmlFor="management-password" className="text-sm font-medium text-ink">{copy.managementPassword}</label>
              <div className="relative mt-2.5">
                <input
                  id="management-password"
                  type={visible ? "text" : "password"}
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setLocalError(null); }}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errorMessage)}
                  aria-describedby={errorMessage ? "unlock-error" : "unlock-help"}
                  disabled={busy}
                  className={`h-12 w-full rounded-xl border bg-surface pl-4 pr-12 font-mono text-base tracking-[0.2em] text-ink ${errorMessage ? "border-danger" : "border-line-strong"}`}
                />
                <button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? copy.hidePassword : copy.showPassword} disabled={busy} className="absolute right-2 top-1.5 grid h-9 w-9 place-items-center rounded-lg text-ink-subtle transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">
                  {visible ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
                </button>
              </div>
              {errorMessage ? <p id="unlock-error" className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-danger" role="alert"><AlertCircle className="h-4 w-4" aria-hidden="true" />{errorMessage}</p> : <p id="unlock-help" className="mt-2.5 text-xs text-ink-subtle">{copy.passwordDerivationHelp}</p>}
              <button type="submit" disabled={busy || !password} className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-accent text-sm font-semibold text-accent-ink transition-[background-color,opacity] duration-150 ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-subtle">
                <UnlockIcon className="h-4 w-4" aria-hidden="true" />
                {busy ? copy.unlocking : copy.unlock}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
