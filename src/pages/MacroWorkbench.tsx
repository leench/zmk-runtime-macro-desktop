import type { DeviceCandidate, ConnectedDevice } from "../bridge";
import type { Messages } from "../i18n";
import type { ThemeMode } from "../types/ui";
import type { SlotState } from "../types/workbench";
import { AppHeader } from "../components/AppHeader";
import { MacroEditor } from "../components/MacroEditor";
import { SlotList } from "../components/SlotList";
import { TitleBar, type Platform } from "../components/TitleBar";

type MacroWorkbenchProps = {
  copy: Messages;
  platform: Platform;
  theme: ThemeMode;
  device: ConnectedDevice;
  devices: DeviceCandidate[];
  currentCandidateId?: string;
  deviceName: string;
  interfaceLabel: string;
  interfaceNumberLabel: (value: number) => string;
  connectionStatusLabel: string;
  protectedAuthenticated: boolean;
  isOpen: boolean;
  slots: SlotState[];
  selectedSlot: number | null;
  busy: boolean;
  refreshing: boolean;
  clearPending: number | null;
  errorMessage: string | null;
  inputErrorMessage: string | null;
  lastOperation: string | null;
  lastErrorCode: string | null;
  configuredBytes: number;
  onThemeChange: (theme: ThemeMode) => void;
  onRefresh: () => void;
  onRefreshDevices: () => void;
  onSettings: () => void;
  onDiagnostics: () => void;
  onSetPassword: () => void;
  onChangePassword: () => void;
  onLock: () => void;
  onSwitchDevice: (id: string) => void;
  onDisconnect: () => void;
  onSelectSlot: (slot: number) => void;
  onMoveSelection: (offset: number) => void;
  onLabelChange: (value: string) => void;
  onRevealToggle: () => void;
  onAdd: () => void;
  onInsertText: (value: string) => void;
  onInsertKey: (kind: "char" | "control", label: string) => void;
  onRemoveToken: (index: number) => void;
  onMoveToken: (index: number, offset: number) => void;
  onClearRequest: () => void;
  onClearConfirm: () => void;
  onClearCancel: () => void;
  onSave: () => void;
  onRevert: () => void;
  onRetry: () => void;
  onCloseDiagnostics: () => void;
  diagnosticsOpen: boolean;
};

export function MacroWorkbench({
  copy,
  platform,
  theme,
  device,
  devices,
  currentCandidateId,
  deviceName,
  interfaceLabel,
  interfaceNumberLabel,
  connectionStatusLabel,
  protectedAuthenticated,
  isOpen,
  slots,
  selectedSlot,
  busy,
  refreshing,
  clearPending,
  errorMessage,
  inputErrorMessage,
  lastOperation,
  lastErrorCode,
  configuredBytes,
  onThemeChange,
  onRefresh,
  onRefreshDevices,
  onSettings,
  onDiagnostics,
  onSetPassword,
  onChangePassword,
  onLock,
  onSwitchDevice,
  onDisconnect,
  onSelectSlot,
  onMoveSelection,
  onLabelChange,
  onRevealToggle,
  onAdd,
  onInsertText,
  onInsertKey,
  onRemoveToken,
  onMoveToken,
  onClearRequest,
  onClearConfirm,
  onClearCancel,
  onSave,
  onRevert,
  onRetry,
  onCloseDiagnostics,
  diagnosticsOpen,
}: MacroWorkbenchProps) {
  const selectedState = slots.find((slot) => slot.slot === selectedSlot) ?? null;
  const dirty = Boolean(selectedState?.loaded && (selectedState.draftText !== selectedState.savedText || selectedState.draftLabel !== selectedState.savedLabel));
  const authenticationLabel = protectedAuthenticated ? copy.statusAuthenticated : isOpen ? copy.openState : copy.statusDisconnected;
  const slotItems = slots.map((slot) => ({
    slot: slot.slot,
    length: slot.length,
    label: slot.draftLabel || copy.defaultSlotLabel(String(slot.slot + 1).padStart(2, "0")),
    loaded: slot.loaded,
    dirty: slot.loaded && (slot.draftText !== slot.savedText || slot.draftLabel !== slot.savedLabel),
    loading: slot.loading,
    error: Boolean(slot.error),
  }));

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      <TitleBar platform={platform} title={copy.appName} labels={{ close: copy.close, minimize: copy.minimize, maximize: copy.maximize }} />
      <AppHeader
        copy={copy}
        devices={devices}
        currentCandidateId={currentCandidateId}
        deviceName={deviceName}
        statusLabel={connectionStatusLabel}
        interfaceLabel={interfaceLabel}
        interfaceNumberLabel={interfaceNumberLabel}
        configuredBytes={configuredBytes}
        theme={theme}
        refreshing={refreshing}
        protectedAuthenticated={protectedAuthenticated}
        isOpen={isOpen}
        onThemeChange={onThemeChange}
        onRefresh={onRefresh}
        onRefreshDevices={onRefreshDevices}
        onSettings={onSettings}
        onDiagnostics={onDiagnostics}
        onSetPassword={onSetPassword}
        onChangePassword={onChangePassword}
        onLock={onLock}
        onSwitchDevice={onSwitchDevice}
        onDisconnect={onDisconnect}
        disabled={busy}
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {errorMessage ? <div className="mx-10 mt-3 flex shrink-0 items-center justify-between gap-4 rounded-xl border border-danger bg-danger-soft px-4 py-3 text-sm text-danger" role="alert"><span>{errorMessage}</span><button type="button" onClick={onRetry} disabled={busy} className="shrink-0 font-medium underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{copy.retry}</button></div> : null}
        {isOpen ? <div className="mx-10 my-3 flex shrink-0 items-center gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning" role="status"><span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" /><span><strong className="font-semibold">{copy.unprotectedTitle}</strong>{copy.unprotectedHelp}</span></div> : null}

        {diagnosticsOpen ? (
          <section className="mx-10 mt-3 shrink-0 rounded-2xl border border-line bg-surface p-5" aria-labelledby="diagnostics-heading">
            <div className="flex items-start justify-between gap-4">
              <div><p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{copy.diagnostics}</p><h2 id="diagnostics-heading" className="mt-1 text-lg font-semibold text-ink">{copy.connectionDetails}</h2></div>
              <button type="button" onClick={onCloseDiagnostics} className="rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-2 hover:text-ink">{copy.close}</button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm md:grid-cols-4">
              <div><dt className="text-xs text-ink-subtle">{copy.protocol}</dt><dd className="mt-0.5 font-mono text-ink">Runtime Macro v2</dd></div>
              <div><dt className="text-xs text-ink-subtle">{copy.transport}</dt><dd className="mt-0.5 font-mono text-ink">USB HID</dd></div>
              <div><dt className="text-xs text-ink-subtle">{copy.device}</dt><dd className="mt-0.5 truncate text-ink">{deviceName}</dd></div>
              <div><dt className="text-xs text-ink-subtle">{copy.vidPid}</dt><dd className="mt-0.5 font-mono text-ink">{device.vendorId.toString(16).padStart(4, "0")} / {device.productId.toString(16).padStart(4, "0")}</dd></div>
              <div><dt className="text-xs text-ink-subtle">{copy.interface}</dt><dd className="mt-0.5 font-mono text-ink">{device.interfaceNumber}</dd></div>
              <div><dt className="text-xs text-ink-subtle">{copy.usage}</dt><dd className="mt-0.5 font-mono text-ink">{device.usagePage.toString(16)} / {device.usage.toString(16)}</dd></div>
              <div><dt className="text-xs text-ink-subtle">{copy.slotCountLabel}</dt><dd className="mt-0.5 font-mono text-ink">{slots.length}</dd></div>
              <div><dt className="text-xs text-ink-subtle">{copy.authentication}</dt><dd className="mt-0.5 text-ink">{authenticationLabel}</dd></div>
              <div><dt className="text-xs text-ink-subtle">{copy.lastOperation}</dt><dd className="mt-0.5 font-mono text-ink">{lastOperation ?? copy.none}</dd></div>
              <div><dt className="text-xs text-ink-subtle">{copy.lastErrorCode}</dt><dd className="mt-0.5 font-mono text-ink">{lastErrorCode ?? copy.none}</dd></div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-ink-subtle">{copy.diagnosticsHelp}</p>
          </section>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <SlotList copy={copy} slots={slotItems} selectedSlot={selectedSlot} disabled={busy} onSelect={onSelectSlot} onMoveSelection={onMoveSelection} />
          {selectedState ? (
            <MacroEditor
              copy={copy}
              slotNumber={selectedState.slot}
              label={selectedState.draftLabel}
              text={selectedState.draftText}
              loaded={selectedState.loaded}
              loading={selectedState.loading}
              revealed={selectedState.revealed}
              dirty={dirty}
              status={selectedState.status}
              canManage={true}
              disabled={busy}
              clearPending={clearPending === selectedState.slot}
              savedAt={selectedState.savedAt}
              errorMessage={selectedState.lastAction === "load" && selectedState.error ? copy.errorRetry : null}
              inputErrorMessage={inputErrorMessage}
              onLabelChange={onLabelChange}
              onRevealToggle={onRevealToggle}
              onAdd={onAdd}
              onInsertText={onInsertText}
              onInsertKey={onInsertKey}
              onRemoveToken={onRemoveToken}
              onMoveToken={onMoveToken}
              onClearRequest={onClearRequest}
              onClearConfirm={onClearConfirm}
              onClearCancel={onClearCancel}
              onSave={onSave}
              onRevert={onRevert}
              onRetry={onRetry}
            />
          ) : (
            <section className="flex min-w-0 flex-1 flex-col items-center justify-center bg-canvas px-8 text-center"><p className="font-mono text-xs uppercase tracking-wide text-ink-subtle">{copy.inspector}</p><h2 className="mt-2 text-xl font-semibold text-ink">{copy.selectSlot}</h2><p className="mt-2 text-sm text-ink-muted">{copy.chooseSlotHelp}</p></section>
          )}
        </div>
      </main>
    </div>
  );
}
