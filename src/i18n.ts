import type { PreviewStateId } from "./types/scenario";

export type LanguagePreference = "system" | "zh-CN" | "en";
export type Locale = "zh-CN" | "en";
export const LANGUAGE_STORAGE_KEY = "zmk-runtime-macro-language:v1";

export type InputErrorKey = "unsupportedText" | "textTooLong" | "parseFailed";
export type SettingsValidationKey = "timeout" | "retries";

export type MessageTable = {
  appName: string;
  close: string;
  minimize: string;
  maximize: string;
  checking: string;
  statusChecking: string;
  statusConnected: string;
  statusDisconnected: string;
  statusAuthenticated: string;
  statusOpen: string;
  authSessionRemaining: (seconds: number) => string;
  chooseDevice: string;
  discoveredDevicesCount: (count: number) => string;
  discoveredDevices: string;
  availableDevices: string;
  checkingCompatibleDevices: string;
  noCompatibleDevice: string;
  unnamedDevice: string;
  interfaceNumber: (value: number) => string;
  v2RuntimeMacro: string;
  usageMetadataUnavailable: string;
  connectSelected: string;
  refresh: string;
  connectionFailed: string;
  oldFirmwareTitle: string;
  oldFirmwareHelp: string;
  v2OnlyHelp: string;
  chooseOtherDevice: string;
  unlockTitle: string;
  unlocking: string;
  unlock: string;
  managementPassword: string;
  showPassword: string;
  hidePassword: string;
  passwordDerivationHelp: string;
  passwordRequired: string;
  credentialInvalidTitle: string;
  credentialInvalid: string;
  credentialInvalidHelp: string;
  authentication: string;
  setupPasswordTitle: string;
  setupPasswordHelp: string;
  changePasswordTitle: string;
  changePasswordHelp: string;
  newManagementPassword: string;
  confirmManagementPassword: string;
  passwordMismatch: string;
  passwordProtocolHelp: string;
  skip: string;
  setPassword: string;
  configuration: string;
  macroSlots: string;
  slotCount: (count: number) => string;
  switchDevice: string;
  configuredBytes: string;
  configuredBytesValue: (bytes: number) => string;
  refreshSlots: string;
  settings: string;
  moreActions: string;
  disconnect: string;
  lockDevice: string;
  changePassword: string;
  diagnostics: string;
  connectionDetails: string;
  protocol: string;
  transport: string;
  device: string;
  vidPid: string;
  interface: string;
  usage: string;
  slotCountLabel: string;
  authenticationStatus: string;
  lastOperation: string;
  lastErrorCode: string;
  none: string;
  openState: string;
  diagnosticsHelp: string;
  macroSlotsAria: string;
  noSlotsReturned: string;
  empty: string;
  slotError: string;
  inspector: string;
  selectSlot: string;
  chooseSlotHelp: string;
  slotLabel: (slot: string) => string;
  defaultSlotLabel: (slot: string) => string;
  unnamedSlot: string;
  name: string;
  localLabelHelp: string;
  macro: string;
  bytes: (count: number) => string;
  loadingSlot: string;
  errorRetry: string;
  retry: string;
  noMacroConfigured: string;
  addMacro: string;
  startTyping: string;
  macroHidden: string;
  hide: string;
  reveal: string;
  macroControlHelp: string;
  tokenActions: string;
  moveLeft: string;
  moveRight: string;
  deleteToken: string;
  selectToken: string;
  protocolTextHelp: string;
  insertCharacters: string;
  inputText: string;
  insert: string;
  asciiHelp: string;
  insertOneByOne: string;
  characterGroups: string;
  controlCharacters: string;
  lowercase: string;
  uppercase: string;
  digits: string;
  symbols: string;
  insertCharacter: string;
  insertLf: string;
  insertTab: string;
  insertBackspace: string;
  clearMacro: string;
  clearThisMacro: string;
  cancel: string;
  clear: string;
  revert: string;
  save: string;
  saving: string;
  saved: string;
  unsavedChanges: string;
  lastSaved: string;
  neverSaved: string;
  disconnectNote: string;
  closeUnsavedTitle: string;
  closeUnsavedMessage: string;
  closeWithoutSaving: string;
  switchUnsavedTitle: string;
  switchUnsavedMessage: string;
  switchAnyway: string;
  deviceSwitchUnsavedTitle: string;
  deviceSwitchUnsavedMessage: string;
  deviceSwitchAnyway: string;
  inputUnsupportedText: string;
  inputTextTooLong: string;
  inputParseFailed: string;
  preferences: string;
  language: string;
  languageFollowSystem: string;
  languageChinese: string;
  languageEnglish: string;
  languageHelp: string;
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  pageZoom: string;
  pageZoomHelp: string;
  increasePageZoom: string;
  decreasePageZoom: string;
  requestTimeout: string;
  retries: string;
  millisecondsRange: (min: number, max: number) => string;
  transportRetriesRange: (max: number) => string;
  settingsHelp: string;
  deviceAlias: string;
  deviceAliasHelp: string;
  deviceAliasScope: string;
  deviceAliasDisconnected: string;
  deviceAliasTooLong: (max: number) => string;
  deviceAliasInvalid: string;
  deviceAliasDuplicate: string;
  previewCharacterCount: string;
  previewCharacterCountHelp: string;
  hoverRevealDelay: string;
  hoverRevealDelayHelp: string;
  hoverRevealDisabled: string;
  hoverRevealImmediate: string;
  hoverRevealSeconds: (seconds: number) => string;
  increasePreviewCharacterCount: string;
  decreasePreviewCharacterCount: string;
  increaseHoverRevealDelay: string;
  decreaseHoverRevealDelay: string;
  previewUnavailable: string;
  revealSlotPreview: string;
  hideSlotPreview: string;
  saveSettings: string;
  settingsSaved: string;
  settingsUnavailable: string;
  operationFailed: string;
  unprotectedTitle: string;
  unprotectedHelp: string;
  dynamicMacro: string;
  dynamicMacroTitle: string;
  dynamicMacroHelp: string;
  dynamicUnencryptedTitle: string;
  dynamicUnencryptedHelp: string;
  dynamicObject: string;
  dynamicObjectLabel: (slot: number) => string;
  dynamicObjectHelp: string;
  dynamicMacroText: string;
  dynamicMacroPlaceholder: string;
  dynamicMacroTextHelp: (maximum: number) => string;
  dynamicBytes: (count: number, maximum: number) => string;
  dynamicCapabilityStatus: string;
  dynamicCapabilityVersion: string;
  dynamicMaxBytes: (count: number) => string;
  dynamicLifecycleBoot: string;
  dynamicLifecycleTtl: string;
  dynamicLifecycleExecute: string;
  dynamicLifecycleUsb: string;
  dynamicLifecycleBle: string;
  dynamicLifecycleEndpoint: string;
  dynamicYes: string;
  dynamicNo: string;
  dynamicTtl: string;
  dynamicTtlDefault: (seconds: number) => string;
  dynamicTtlCustom: string;
  dynamicTtlHelp: (min: number, max: number) => string;
  seconds: string;
  dynamicSingleUse: string;
  dynamicSingleUseHelp: string;
  dynamicSingleUseUnsupported: string;
  dynamicCapabilityNote: string;
  dynamicUpload: string;
  dynamicClear: string;
  dynamicUploading: string;
  dynamicClearing: string;
  dynamicStatusUnknown: string;
  dynamicStatusDiscovering: string;
  dynamicStatusReady: string;
  dynamicStatusUploading: string;
  dynamicStatusClearing: string;
  dynamicStatusCommitted: string;
  dynamicStatusCleared: string;
  dynamicStatusUnsupported: string;
  dynamicStatusError: string;
  dynamicUnsupportedHelp: string;
  dynamicOperationError: string;
  dynamicTextRequired: string;
  dynamicUnsupportedText: string;
  dynamicTextTooLong: (maximum: number) => string;
  dynamicTtlInvalid: string;
  dynamicCapabilityError: string;
  dynamicWorkspace: string;
  dynamicWorkspaceEyebrow: string;
  dynamicWorkspaceSummary: string;
  dynamicPreviewBadge: string;
  dynamicPreviewStateLabel: string;
  dynamicPreviewStateHelp: string;
  dynamicPreviewStateLabels: Record<PreviewStateId, string>;
  dynamicPreviewMockNote: string;
  dynamicPreviewDeviceName: string;
  dynamicPreviewEntryHelp: string;
  dynamicLegacyDialog: string;
  dynamicLegacyDialogHelp: string;
  dynamicWorkspaceWarningTitle: string;
  dynamicWorkspaceWarning: string;
  dynamicDeviceReady: string;
  dynamicTarget: string;
  dynamicTargetDevice: string;
  dynamicTargetDeviceHelp: string;
  dynamicDeviceAliasUnset: string;
  dynamicDeviceAliasRequiredHelp: string;
  dynamicDeviceBound: string;
  dynamicDeviceUnbound: string;
  dynamicDeviceBind: string;
  dynamicTargetObject: string;
  dynamicTargetChoose: string;
  dynamicTargetUnavailable: string;
  dynamicTargetMissingShort: string;
  dynamicTargetMissingHelp: string;
  dynamicTargetPending: string;
  dynamicTargetPendingHelp: string;
  dynamicTargetSingleHelp: string;
  dynamicTargetUseOnly: string;
  dynamicNoObjects: string;
  dynamicNeedsTarget: string;
  dynamicStaticLockedNote: string;
  dynamicCapabilityChangedNotice: string;
  dynamicCapabilityDetails: string;
  dynamicCapabilityObjectCount: string;
  dynamicCapabilityObject: string;
  dynamicCapabilityMaxBytesLabel: string;
  dynamicCapabilityTtlDefault: string;
  dynamicCapabilityTtlRange: string;
  dynamicCapabilityKeep: string;
  dynamicObservation: string;
  dynamicObservationNone: string;
  dynamicObservationUploading: string;
  dynamicObservationCommitted: string;
  dynamicObservationClearing: string;
  dynamicObservationCleared: string;
  dynamicObservationErrorInterrupted: string;
  dynamicObservationErrorTimeout: string;
  dynamicObservationErrorUnsupported: string;
  dynamicObservationTarget: string;
  dynamicObservationReset: string;
  dynamicObservationRealNote: string;
  dynamicScenarioListAria: string;
  dynamicScenarios: string;
  dynamicScenarioCount: (count: number) => string;
  dynamicNewScenario: string;
  dynamicNoScenarios: string;
  dynamicUntitledScenario: string;
  dynamicEmptyTitle: string;
  dynamicEmptyHelp: string;
  dynamicScenarioEyebrow: string;
  dynamicScenarioName: string;
  dynamicScenarioNameHelp: string;
  dynamicScenarioSavedLocally: string;
  dynamicScenarioSavedToStore: string;
  dynamicScenarioNameRequired: string;
  dynamicScenarioNameTooLong: (maximum: number) => string;
  dynamicScenarioTextTooLongForStore: (maximum: number) => string;
  dynamicScenarioCloseMessage: string;
  dynamicScenarioCloseAnyway: string;
  dynamicStoreLoading: string;
  dynamicStoreLoadFailedTitle: string;
  dynamicStoreSaveFailedTitle: string;
  dynamicStoreNotReady: string;
  dynamicScenarioNoTarget: string;
  dynamicScenarioTarget: (label: string) => string;
  dynamicScenarioTargetPending: string;
  dynamicScenarioTargetMissingShort: string;
  dynamicScenarioSwitchMessage: string;
  dynamicScenarioSwitchAnyway: string;
  dynamicScenarioDeleteTitle: string;
  dynamicScenarioDeleteMessage: (name: string) => string;
  dynamicScenarioDeleteMessageDevice: (name: string) => string;
  dynamicScenarioDeleteConfirm: string;
  dynamicScenarioSaveAndUpload: string;
  dynamicScenarioClearDevice: string;
  dynamicScenarioKeep: string;
  dynamicScenarioKeepHelp: string;
  dynamicScenarioKeepUnsupported: string;
  dynamicConfirmUploadTitle: string;
  dynamicConfirmUploadMessage: (name: string, target: string) => string;
  dynamicConfirmUploadConfirm: string;
  dynamicConfirmClearTitle: string;
  dynamicConfirmClearMessage: (target: string) => string;
  dynamicConfirmClearConfirm: string;
  dynamicConfirmUploadTitleDevice: string;
  dynamicConfirmUploadMessageDevice: (name: string, target: string) => string;
  dynamicConfirmUploadConfirmDevice: string;
  dynamicConfirmClearTitleDevice: string;
  dynamicConfirmClearMessageDevice: (target: string) => string;
  dynamicConfirmClearConfirmDevice: string;
  dynamicBlockerDisconnected: string;
  dynamicBlockerUnknown: string;
  dynamicBlockerOperating: string;
  dynamicBlockerDeviceAliasMissing: string;
  dynamicBlockerDeviceUnbound: string;
  dynamicTextHelpPending: string;
  dynamicSampleScenarioWork: string;
  dynamicSampleScenarioBuild: string;
  dynamicSampleScenarioScratch: string;
};

export type Messages = MessageTable;

const english: MessageTable = {
  appName: "ZMK Runtime Macro",
  close: "Close",
  minimize: "Minimize",
  maximize: "Maximize or restore",
  checking: "Checking…",
  statusChecking: "Checking device…",
  statusConnected: "Connected",
  statusDisconnected: "Device disconnected",
  statusAuthenticated: "Authenticated",
  statusOpen: "Connected",
  authSessionRemaining: (seconds) => `Session ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`,
  chooseDevice: "Choose a keyboard",
  discoveredDevicesCount: (count) => `${count} device${count === 1 ? "" : "s"} found`,
  discoveredDevices: "Available devices",
  availableDevices: "Runtime Macro devices",
  checkingCompatibleDevices: "Checking for compatible Runtime Macro devices…",
  noCompatibleDevice: "No compatible Runtime Macro device found.",
  unnamedDevice: "Unnamed device",
  interfaceNumber: (value) => `Interface ${value}`,
  v2RuntimeMacro: "Runtime Macro v2",
  usageMetadataUnavailable: "Usage metadata unavailable",
  connectSelected: "Connect selected",
  refresh: "Refresh devices",
  connectionFailed: "Connection failed",
  oldFirmwareTitle: "Older firmware is not supported",
  oldFirmwareHelp: "This firmware does not support authentication. Upgrade the keyboard to Runtime Macro v2.",
  v2OnlyHelp: "Only Runtime Macro v2 devices are supported. Macro content is never shown in the device list.",
  chooseOtherDevice: "Choose another device",
  unlockTitle: "Unlock management",
  unlocking: "Unlocking…",
  unlock: "Unlock",
  managementPassword: "Management password",
  showPassword: "Show password",
  hidePassword: "Hide password",
  passwordDerivationHelp: "The password is derived locally; the original password is never sent to the device.",
  passwordRequired: "Enter a management password.",
  credentialInvalidTitle: "Credential unavailable",
  credentialInvalid: "The device credential is invalid.",
  credentialInvalidHelp: "The device must be reset using its firmware settings reset procedure before it can be managed again.",
  authentication: "Authentication",
  setupPasswordTitle: "Set a management password",
  setupPasswordHelp: "This device is open. You can skip this step, or protect future macro management with a password.",
  changePasswordTitle: "Change management password",
  changePasswordHelp: "Enter a new non-empty password. Changing it will lock the device and require unlocking again.",
  newManagementPassword: "New management password",
  confirmManagementPassword: "Confirm management password",
  passwordMismatch: "The passwords do not match.",
  passwordProtocolHelp: "Passwords are normalized to Unicode NFC and derived locally before authentication. No password is stored.",
  skip: "Skip",
  setPassword: "Set password",
  configuration: "Configuration",
  macroSlots: "Macro Slots",
  slotCount: (count) => `${count} slots`,
  switchDevice: "Switch device",
  configuredBytes: "Configured macro bytes",
  configuredBytesValue: (bytes) => `${bytes} bytes`,
  refreshSlots: "Refresh slots",
  settings: "Settings",
  moreActions: "More actions",
  disconnect: "Disconnect",
  lockDevice: "Lock management",
  changePassword: "Change password",
  diagnostics: "Diagnostics",
  connectionDetails: "Connection details",
  protocol: "Protocol",
  transport: "Transport",
  device: "Device",
  vidPid: "VID / PID",
  interface: "Interface",
  usage: "Usage",
  slotCountLabel: "Slot count",
  authenticationStatus: "Authentication",
  lastOperation: "Last operation",
  lastErrorCode: "Last error code",
  none: "None",
  openState: "Open · no password",
  diagnosticsHelp: "Diagnostics never include macro content, HID paths, serial numbers, raw reports, or credentials.",
  macroSlotsAria: "Macro slots",
  noSlotsReturned: "The device returned no slots.",
  empty: "Empty",
  slotError: "Unavailable",
  inspector: "Inspector",
  selectSlot: "Select a slot",
  chooseSlotHelp: "Choose a slot to view and edit its macro.",
  slotLabel: (slot) => `Slot ${slot}`,
  defaultSlotLabel: (slot) => `Slot ${slot}`,
  unnamedSlot: "Unnamed",
  name: "Name",
  localLabelHelp: "Local label · not written to the keyboard",
  macro: "Macro",
  bytes: (count) => `${count} bytes`,
  loadingSlot: "Loading slot…",
  errorRetry: "Could not load this slot.",
  retry: "Retry",
  noMacroConfigured: "No macro configured",
  addMacro: "Add macro",
  startTyping: "Insert characters below to start editing.",
  macroHidden: "Macro content hidden",
  hide: "Hide",
  reveal: "Reveal",
  macroControlHelp: "Reveal to edit. LF is shown as ↵ · Tab as ⇥ · Backspace as ⌫.",
  tokenActions: "Selected character actions",
  moveLeft: "Move left",
  moveRight: "Move right",
  deleteToken: "Delete character",
  selectToken: "Select character",
  protocolTextHelp: "Only printable US ASCII, LF, Tab, and Backspace are accepted. Enter inserts LF; carriage return is not supported.",
  insertCharacters: "Insert characters",
  inputText: "Input text",
  insert: "Insert",
  asciiHelp: "Each character uses one byte. Unicode characters are not supported.",
  insertOneByOne: "Insert one by one",
  characterGroups: "Character groups",
  controlCharacters: "Controls",
  lowercase: "Lowercase",
  uppercase: "Uppercase",
  digits: "Digits",
  symbols: "Symbols",
  insertCharacter: "Insert character",
  insertLf: "Insert LF",
  insertTab: "Insert Tab",
  insertBackspace: "Insert Backspace",
  clearMacro: "Clear macro…",
  clearThisMacro: "Clear this macro?",
  cancel: "Cancel",
  clear: "Clear",
  revert: "Discard changes",
  save: "Save",
  saving: "Saving…",
  saved: "✓ Saved",
  unsavedChanges: "● Unsaved changes",
  lastSaved: "Saved",
  neverSaved: "Not saved yet",
  disconnectNote: "Device disconnected. Unsaved changes remain in memory.",
  closeUnsavedTitle: "Unsaved changes",
  closeUnsavedMessage: "This window has unsaved changes.",
  closeWithoutSaving: "Close without saving",
  switchUnsavedTitle: "Unsaved changes",
  switchUnsavedMessage: "This slot has unsaved changes. Switch slots anyway?",
  switchAnyway: "Switch anyway",
  deviceSwitchUnsavedTitle: "Unsaved changes on this device",
  deviceSwitchUnsavedMessage: "If the other device connects successfully, this device's in-memory draft will be discarded. If the connection fails, the draft will be kept. Continue without saving?",
  deviceSwitchAnyway: "Switch device",
  inputUnsupportedText: "Macro text supports printable US ASCII, LF, Tab, and Backspace only.",
  inputTextTooLong: "Macro text cannot exceed 256 bytes.",
  inputParseFailed: "Macro text could not be parsed.",
  preferences: "Preferences",
  language: "Language",
  languageFollowSystem: "Follow system",
  languageChinese: "中文",
  languageEnglish: "English",
  languageHelp: "Follow system uses Chinese for zh-* locales and English otherwise.",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  pageZoom: "Interface scale",
  pageZoomHelp: "80–150% in 5% steps. Changes preview immediately and are saved with Save settings.",
  increasePageZoom: "Increase interface scale",
  decreasePageZoom: "Decrease interface scale",
  requestTimeout: "Request timeout",
  retries: "Retries",
  millisecondsRange: (min, max) => `Milliseconds · ${min}–${max}`,
  transportRetriesRange: (max) => `Transport retries · 0–${max}`,
  settingsHelp: "Timeout and retries apply on the next connection. Macro content is never stored in preferences.",
  deviceAlias: "Device alias",
  deviceAliasHelp: "A name for this keyboard on this machine. Scenarios bind to it, and the tray menu shows it.",
  deviceAliasScope: "Stored locally for this device only. It is never written to the keyboard, never sent over HID, and clearing it removes the binding.",
  deviceAliasDisconnected: "Connect a device to give it a local alias.",
  deviceAliasTooLong: (max) => `The alias cannot exceed ${max} bytes.`,
  deviceAliasInvalid: "The alias cannot contain control characters.",
  deviceAliasDuplicate: "Another device already uses this alias. Aliases must be unique.",
  previewCharacterCount: "Preview character count",
  previewCharacterCountHelp: "Show up to five leading characters from each loaded slot.",
  hoverRevealDelay: "Hover reveal delay",
  hoverRevealDelayHelp: "Reveal a loaded macro while the pointer remains over its preview.",
  hoverRevealDisabled: "Disable",
  hoverRevealImmediate: "Immediate",
  hoverRevealSeconds: (seconds) => `${seconds} second${seconds === 1 ? "" : "s"}`,
  increasePreviewCharacterCount: "Increase preview character count",
  decreasePreviewCharacterCount: "Decrease preview character count",
  increaseHoverRevealDelay: "Increase hover reveal delay",
  decreaseHoverRevealDelay: "Decrease hover reveal delay",
  previewUnavailable: "Preview unavailable",
  revealSlotPreview: "Reveal macro preview",
  hideSlotPreview: "Hide macro preview",
  saveSettings: "Save settings",
  settingsSaved: "✓ Settings saved",
  settingsUnavailable: "Settings could not be loaded.",
  operationFailed: "The operation failed. Try again.",
  unprotectedTitle: "Not protected · ",
  unprotectedHelp: "no management password is set; macro management is available to other local HID clients.",
  dynamicMacro: "Dynamic Macro",
  dynamicMacroTitle: "Temporary macro",
  dynamicMacroHelp: "RAM-only objects with no readback. Upload only non-secret text; they are independent of static macro slots.",
  dynamicUnencryptedTitle: "HID is unencrypted.",
  dynamicUnencryptedHelp: "Do not upload passwords, tokens, or other secrets. Dynamic Macro is available even while static management is locked.",
  dynamicObject: "Dynamic object",
  dynamicObjectLabel: (slot) => `Object ${slot}`,
  dynamicObjectHelp: "Upload and clear apply to the selected object only.",
  dynamicMacroText: "Dynamic text",
  dynamicMacroPlaceholder: "Type a temporary macro…",
  dynamicMacroTextHelp: (maximum) => `Printable US ASCII, LF, Tab, and Backspace · maximum ${maximum} bytes.`,
  dynamicBytes: (count, maximum) => `${count} / ${maximum} bytes`,
  dynamicCapabilityStatus: "Capability",
  dynamicCapabilityVersion: "Version",
  dynamicMaxBytes: (count) => `max ${count} bytes`,
  dynamicLifecycleBoot: "Boot clear",
  dynamicLifecycleTtl: "TTL clear",
  dynamicLifecycleExecute: "Execute clear",
  dynamicLifecycleUsb: "USB clear",
  dynamicLifecycleBle: "BLE clear",
  dynamicLifecycleEndpoint: "Endpoint clear",
  dynamicYes: "yes",
  dynamicNo: "no",
  dynamicTtl: "TTL",
  dynamicTtlDefault: (seconds) => `Device default (${seconds} seconds)`,
  dynamicTtlCustom: "Custom…",
  dynamicTtlHelp: (min, max) => `Optional explicit TTL · ${min}–${max} seconds`,
  seconds: "seconds",
  dynamicSingleUse: "Single-use input",
  dynamicSingleUseHelp: "Consume the dynamic object after a successful execution.",
  dynamicSingleUseUnsupported: "This device cannot retain the object, so it is always single-use.",
  dynamicCapabilityNote: "Upload and clear report local observation only; the object cannot be read back.",
  dynamicUpload: "Upload",
  dynamicClear: "Clear",
  dynamicUploading: "Uploading…",
  dynamicClearing: "Clearing…",
  dynamicStatusUnknown: "Unknown",
  dynamicStatusDiscovering: "Checking capability…",
  dynamicStatusReady: "Ready · no local observation",
  dynamicStatusUploading: "Uploading…",
  dynamicStatusClearing: "Clearing…",
  dynamicStatusCommitted: "Committed locally",
  dynamicStatusCleared: "Cleared locally",
  dynamicStatusUnsupported: "Unsupported",
  dynamicStatusError: "Error",
  dynamicUnsupportedHelp: "This device does not advertise the Dynamic Macro protocol. Static macro management remains available.",
  dynamicOperationError: "Dynamic Macro operation failed. The local state is unknown; do not assume the object is present.",
  dynamicTextRequired: "Enter non-empty dynamic text.",
  dynamicUnsupportedText: "Dynamic text supports printable US ASCII, LF, Tab, and Backspace only.",
  dynamicTextTooLong: (maximum) => `Dynamic text cannot exceed ${maximum} bytes.`,
  dynamicTtlInvalid: "The Dynamic Macro TTL is outside the supported range.",
  dynamicCapabilityError: "Could not read the Dynamic Macro capability from this device. Reconnect and try again.",
  dynamicWorkspace: "Dynamic scenarios",
  dynamicWorkspaceEyebrow: "Dynamic workspace",
  dynamicWorkspaceSummary: "RAM-only · no readback",
  dynamicPreviewBadge: "Preview",
  dynamicPreviewStateLabel: "Preview state",
  dynamicPreviewStateHelp: "Preview build: every value on this page comes from an in-memory fixture. No device is contacted and nothing is written to disk or browser storage.",
  dynamicPreviewStateLabels: {
    empty: "Empty",
    new: "New unsaved scenario",
    dirty: "Unsaved changes",
    disconnected: "Device disconnected",
    unknown: "Device state unknown",
    discovering: "Reading capability",
    unsupported: "Dynamic unsupported",
    ready: "Ready",
    uploading: "Uploading",
    committed: "Committed locally",
    clearing: "Clearing",
    cleared: "Cleared locally",
    error: "Error",
    staticLocked: "Static locked, dynamic available",
    keepUnsupported: "Keep unsupported",
    targetMissing: "Target missing",
    capabilityChanged: "Capability changed",
    oversize: "Text over limit",
  },
  dynamicPreviewMockNote: "Preview interaction only: this build never contacts a device, so nothing here is a device confirmation.",
  dynamicPreviewDeviceName: "Preview keyboard",
  dynamicPreviewEntryHelp: "Inspect the Dynamic scenario workspace with in-memory fixture data. No keyboard or device connection is required.",
  dynamicLegacyDialog: "Legacy dialog",
  dynamicLegacyDialogHelp: "Opens the previous Dynamic Macro dialog. Temporary fallback until this workspace passes visual review.",
  dynamicWorkspaceWarningTitle: "Non-secret text only.",
  dynamicWorkspaceWarning: "Dynamic macros are unencrypted and intended only for non-secret text. The app does not detect or filter secrets for you.",
  dynamicDeviceReady: "Device ready",
  dynamicTarget: "Upload target",
  dynamicTargetDevice: "Target device",
  dynamicTargetDeviceHelp: "Preview data uses a fixed sample name; a connected workspace shows the local device alias.",
  dynamicDeviceAliasUnset: "No device alias",
  dynamicDeviceAliasRequiredHelp: "Give this device an alias in Settings before a scenario can target it.",
  dynamicDeviceBound: "This scenario is bound to the connected device.",
  dynamicDeviceUnbound: "This scenario is not bound to the connected device.",
  dynamicDeviceBind: "Use this device",
  dynamicTargetObject: "Dynamic object",
  dynamicTargetChoose: "Choose a target object…",
  dynamicTargetUnavailable: "Saved target is unavailable",
  dynamicTargetMissingShort: "Target missing from the current capability",
  dynamicTargetMissingHelp: "The saved target object is not in the current capability. Choose a target again; the text and draft are kept.",
  dynamicTargetPending: "Not checked yet",
  dynamicTargetPendingHelp: "The target list comes from the device capability and is unavailable while the device is not ready.",
  dynamicTargetSingleHelp: "This device reports a single Dynamic object, so the target is fixed.",
  dynamicTargetUseOnly: "Use this object",
  dynamicNoObjects: "This device reports no Dynamic objects.",
  dynamicNeedsTarget: "Choose a target object first.",
  dynamicStaticLockedNote: "Static management stays locked while dynamic objects remain available: Dynamic Macro does not use the static password gate.",
  dynamicCapabilityChangedNotice: "Device capability changed. Re-check text length, TTL, keep-after-execute and the target before uploading.",
  dynamicCapabilityDetails: "Device behavior & capability details",
  dynamicCapabilityObjectCount: "Dynamic objects",
  dynamicCapabilityObject: "Linked object",
  dynamicCapabilityMaxBytesLabel: "Maximum length",
  dynamicCapabilityTtlDefault: "Default TTL",
  dynamicCapabilityTtlRange: "TTL range",
  dynamicCapabilityKeep: "Keep after execution",
  dynamicObservation: "Local observation",
  dynamicObservationNone: "No local observation yet. Upload and clear results are only known from this session.",
  dynamicObservationUploading: "Preview: an upload to the target object is shown as running.",
  dynamicObservationCommitted: "Preview: this session marked the target object as uploaded. It is not a readback and does not prove the object is still there.",
  dynamicObservationClearing: "Preview: a clear of the target object is shown as running.",
  dynamicObservationCleared: "Preview: this session marked the target object as cleared. The device is not asked for confirmation.",
  dynamicObservationErrorInterrupted: "Preview error: the transfer was interrupted. Reset the observation to continue.",
  dynamicObservationErrorTimeout: "Preview error: the device did not confirm in time. Reset the observation to continue.",
  dynamicObservationErrorUnsupported: "Preview error: the device rejected the request as unsupported. Reset the observation to continue.",
  dynamicObservationTarget: "Observed target",
  dynamicObservationReset: "Reset observation",
  dynamicObservationRealNote: "Local observation of this session only. Dynamic objects live in RAM, are cleared on execution, TTL or disconnect, and cannot be read back.",
  dynamicScenarioListAria: "Dynamic scenarios",
  dynamicScenarios: "Scenarios",
  dynamicScenarioCount: (count) => `${count} scenario${count === 1 ? "" : "s"}`,
  dynamicNewScenario: "New scenario",
  dynamicNoScenarios: "No scenarios yet.",
  dynamicUntitledScenario: "Untitled scenario",
  dynamicEmptyTitle: "No scenarios yet",
  dynamicEmptyHelp: "Scenarios are desktop-side templates that you name yourself. A Dynamic object on the device is only the upload target.",
  dynamicScenarioEyebrow: "Dynamic scenario",
  dynamicScenarioName: "Scenario name",
  dynamicScenarioNameHelp: "Desktop-side name only; it is never sent to the device.",
  dynamicScenarioSavedLocally: "Saved in memory (preview)",
  dynamicScenarioSavedToStore: "Saved",
  dynamicScenarioNameRequired: "Give the scenario a name before saving it.",
  dynamicScenarioNameTooLong: (maximum) => `Scenario names are limited to ${maximum} bytes.`,
  dynamicScenarioTextTooLongForStore: (maximum) => `Text saved to the scenario file is limited to ${maximum} bytes.`,
  dynamicScenarioCloseMessage: "This scenario has unsaved changes. Close the workspace anyway? Unsaved edits stay in memory and are not written to the scenario file.",
  dynamicScenarioCloseAnyway: "Close anyway",
  dynamicStoreLoading: "Loading saved scenarios…",
  dynamicStoreLoadFailedTitle: "Saved scenarios could not be loaded.",
  dynamicStoreSaveFailedTitle: "Scenarios could not be saved.",
  dynamicStoreNotReady: "The local scenario store is not available yet.",
  dynamicScenarioNoTarget: "No target object",
  dynamicScenarioTarget: (label) => `Target: ${label}`,
  dynamicScenarioTargetPending: "Target: not checked yet",
  dynamicScenarioTargetMissingShort: "Target missing",
  dynamicScenarioSwitchMessage: "This scenario has unsaved changes. Switch scenarios anyway? Preview drafts stay in memory until the preview reloads.",
  dynamicScenarioSwitchAnyway: "Switch anyway",
  dynamicScenarioDeleteTitle: "Delete scenario",
  dynamicScenarioDeleteMessage: (name) => `Remove ${name} from this preview? Device objects and their content are not affected.`,
  dynamicScenarioDeleteMessageDevice: (name) => `Remove ${name} from the saved scenarios? Device objects and their content are not affected.`,
  dynamicScenarioDeleteConfirm: "Delete scenario",
  dynamicScenarioSaveAndUpload: "Save & upload",
  dynamicScenarioClearDevice: "Clear device",
  dynamicScenarioKeep: "Keep after execution",
  dynamicScenarioKeepHelp: "Leave the object in place after a successful execution instead of consuming it.",
  dynamicScenarioKeepUnsupported: "This device does not support keep-after-execute. Turn it off to upload; the saved choice is not changed for you.",
  dynamicConfirmUploadTitle: "Preview upload",
  dynamicConfirmUploadMessage: (name, target) => `Save ${name} and mark it as uploaded to ${target}? No device is contacted in this preview.`,
  dynamicConfirmUploadConfirm: "Mark as uploaded",
  dynamicConfirmClearTitle: "Preview clear",
  dynamicConfirmClearMessage: (target) => `Mark ${target} as cleared? The scenario and its text stay untouched.`,
  dynamicConfirmClearConfirm: "Mark as cleared",
  dynamicConfirmUploadTitleDevice: "Save and upload",
  dynamicConfirmUploadMessageDevice: (name, target) => `Save ${name}, then upload it to ${target}? The device acknowledges the upload; there is no readback.`,
  dynamicConfirmUploadConfirmDevice: "Save and upload",
  dynamicConfirmClearTitleDevice: "Clear device object",
  dynamicConfirmClearMessageDevice: (target) => `Clear ${target} on the device? The scenario and its text are kept.`,
  dynamicConfirmClearConfirmDevice: "Clear object",
  dynamicBlockerDisconnected: "Connect a device to upload or clear.",
  dynamicBlockerUnknown: "The device state is unknown after a reconnect. Reopen the device to continue.",
  dynamicBlockerOperating: "An operation is already running.",
  dynamicBlockerDeviceAliasMissing: "This device has no alias yet. Set one in Settings, then bind the scenario to it.",
  dynamicBlockerDeviceUnbound: "This scenario is not bound to the connected device. Use \"Use this device\" to bind it explicitly.",
  dynamicTextHelpPending: "Printable US ASCII, LF, Tab, and Backspace. The length limit follows the device capability.",
  dynamicSampleScenarioWork: "Work terminal",
  dynamicSampleScenarioBuild: "Build watch",
  dynamicSampleScenarioScratch: "Scratch",
};

const chinese: MessageTable = {
  appName: "ZMK Runtime Macro",
  close: "关闭",
  minimize: "最小化",
  maximize: "最大化/还原",
  checking: "正在检查…",
  statusChecking: "正在检查设备…",
  statusConnected: "已连接",
  statusDisconnected: "设备已断开",
  statusAuthenticated: "已认证",
  statusOpen: "已连接",
  authSessionRemaining: (seconds) => `认证窗口剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
  chooseDevice: "选择键盘",
  discoveredDevicesCount: (count) => `发现 ${count} 台设备`,
  discoveredDevices: "可用设备",
  availableDevices: "Runtime Macro 设备",
  checkingCompatibleDevices: "正在检查兼容的 Runtime Macro 设备…",
  noCompatibleDevice: "未找到兼容的 Runtime Macro 设备。",
  unnamedDevice: "未命名设备",
  interfaceNumber: (value) => `接口 ${value}`,
  v2RuntimeMacro: "Runtime Macro v2",
  usageMetadataUnavailable: "Usage 元数据不可用",
  connectSelected: "连接所选设备",
  refresh: "刷新设备",
  connectionFailed: "连接失败",
  oldFirmwareTitle: "不支持旧固件",
  oldFirmwareHelp: "此固件不支持认证。请将键盘升级到 Runtime Macro v2。",
  v2OnlyHelp: "仅支持 Runtime Macro v2 设备。设备列表绝不显示宏正文。",
  chooseOtherDevice: "选择其他设备",
  unlockTitle: "解锁管理",
  unlocking: "正在解锁…",
  unlock: "解锁",
  managementPassword: "管理密码",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  passwordDerivationHelp: "密码在本地派生，原始密码不会发送到设备。",
  passwordRequired: "请输入管理密码。",
  credentialInvalidTitle: "凭据不可用",
  credentialInvalid: "设备凭据无效。",
  credentialInvalidHelp: "必须先按固件的 settings reset 流程重置设备，之后才能再次管理。",
  authentication: "认证",
  setupPasswordTitle: "设置管理密码",
  setupPasswordHelp: "此设备当前为开放状态。你可以跳过，也可以设置密码保护后续宏管理。",
  changePasswordTitle: "更改管理密码",
  changePasswordHelp: "请输入新的非空密码。更改后设备会锁定，需要重新解锁。",
  newManagementPassword: "新管理密码",
  confirmManagementPassword: "确认管理密码",
  passwordMismatch: "两次输入的密码不一致。",
  passwordProtocolHelp: "密码会先做 Unicode NFC 规范化，再在本地派生用于认证。不保存密码。",
  skip: "跳过",
  setPassword: "设置密码",
  configuration: "配置",
  macroSlots: "宏列表",
  slotCount: (count) => `${count} 个宏`,
  switchDevice: "切换设备",
  configuredBytes: "已配置宏字节数",
  configuredBytesValue: (bytes) => `${bytes} bytes`,
  refreshSlots: "刷新宏",
  settings: "设置",
  moreActions: "更多操作",
  disconnect: "断开连接",
  lockDevice: "锁定管理",
  changePassword: "更改密码",
  diagnostics: "诊断",
  connectionDetails: "连接详情",
  protocol: "协议",
  transport: "传输",
  device: "设备",
  vidPid: "VID / PID",
  interface: "接口",
  usage: "Usage",
  slotCountLabel: "宏数量",
  authenticationStatus: "认证",
  lastOperation: "最近操作",
  lastErrorCode: "最近错误代码",
  none: "无",
  openState: "开放 · 未设置密码",
  diagnosticsHelp: "诊断信息不会包含宏正文、HID 路径、序列号、原始报告或凭据。",
  macroSlotsAria: "宏列表",
  noSlotsReturned: "设备没有返回宏。",
  empty: "空",
  slotError: "不可用",
  inspector: "检查器",
  selectSlot: "选择宏",
  chooseSlotHelp: "选择一个宏以查看和编辑宏。",
  slotLabel: (slot) => `宏 ${slot}`,
  defaultSlotLabel: (slot) => `宏 ${slot}`,
  unnamedSlot: "未命名宏",
  name: "名称",
  localLabelHelp: "本机标签 · 不会写入键盘",
  macro: "宏",
  bytes: (count) => `${count} bytes`,
  loadingSlot: "正在加载宏…",
  errorRetry: "无法加载此宏。",
  retry: "重试",
  noMacroConfigured: "未配置宏",
  addMacro: "添加宏",
  startTyping: "在下方插入字符开始编辑。",
  macroHidden: "宏正文已隐藏",
  hide: "隐藏",
  reveal: "显示",
  macroControlHelp: "显示后才能编辑。LF 显示为 ↵ · Tab 显示为 ⇥ · Backspace 显示为 ⌫。",
  tokenActions: "选中字符操作",
  moveLeft: "左移",
  moveRight: "右移",
  deleteToken: "删除字符",
  selectToken: "选中字符",
  protocolTextHelp: "仅支持可打印 US ASCII、LF、Tab 和 Backspace。Enter 插入 LF；不支持 CR。",
  insertCharacters: "插入字符",
  inputText: "输入文本",
  insert: "插入",
  asciiHelp: "每个字符占用 1 byte。不支持 Unicode 字符。",
  insertOneByOne: "逐个插入",
  characterGroups: "字符分组",
  controlCharacters: "控制字符",
  lowercase: "小写字母",
  uppercase: "大写字母",
  digits: "数字",
  symbols: "符号",
  insertCharacter: "插入字符",
  insertLf: "插入 LF",
  insertTab: "插入 Tab",
  insertBackspace: "插入 Backspace",
  clearMacro: "清空宏…",
  clearThisMacro: "清空此宏？",
  cancel: "取消",
  clear: "清空",
  revert: "放弃修改",
  save: "保存",
  saving: "正在保存…",
  saved: "✓ 已保存",
  unsavedChanges: "● 未保存修改",
  lastSaved: "已保存",
  neverSaved: "尚未保存",
  disconnectNote: "设备已断开。未保存的修改仍保留在内存中。",
  closeUnsavedTitle: "有未保存修改",
  closeUnsavedMessage: "当前窗口有未保存修改。",
  closeWithoutSaving: "不保存并关闭",
  switchUnsavedTitle: "有未保存修改",
  switchUnsavedMessage: "当前宏有未保存修改，仍要切换宏吗？",
  switchAnyway: "仍然切换",
  deviceSwitchUnsavedTitle: "设备有未保存修改",
  deviceSwitchUnsavedMessage: "如果另一台设备连接成功，当前设备的内存草稿将被丢弃；如果连接失败，草稿仍会保留。尚未保存，仍要切换吗？",
  deviceSwitchAnyway: "切换设备",
  inputUnsupportedText: "宏正文仅支持可打印 US ASCII、LF、Tab 和 Backspace。",
  inputTextTooLong: "宏正文不能超过 256 bytes。",
  inputParseFailed: "宏正文无法解析。",
  preferences: "偏好设置",
  language: "语言",
  languageFollowSystem: "跟随系统",
  languageChinese: "中文",
  languageEnglish: "English",
  languageHelp: "跟随系统在 zh-* 语言环境使用中文，其他情况使用 English。",
  theme: "主题",
  themeSystem: "跟随系统",
  themeLight: "浅色",
  themeDark: "深色",
  pageZoom: "界面缩放",
  pageZoomHelp: "范围 80–150%，每次调整 5%。修改会立即预览，点击“保存设置”后下次启动继续使用。",
  increasePageZoom: "放大界面",
  decreasePageZoom: "缩小界面",
  requestTimeout: "请求超时",
  retries: "重试次数",
  millisecondsRange: (min, max) => `毫秒 · ${min}–${max}`,
  transportRetriesRange: (max) => `传输重试 · 0–${max}`,
  settingsHelp: "超时和重试次数将在下次连接时生效。宏正文不会存入偏好设置。",
  deviceAlias: "设备别名",
  deviceAliasHelp: "仅在本机使用的设备名称。场景会绑定到该名称，托盘菜单也会显示它。",
  deviceAliasScope: "只在本机按该设备保存，不会写入键盘，也不会通过 HID 发送；清空后会同时解除场景绑定。",
  deviceAliasDisconnected: "请先连接设备，再为它设置本机别名。",
  deviceAliasTooLong: (max) => `别名不能超过 ${max} bytes。`,
  deviceAliasInvalid: "别名不能包含控制字符。",
  deviceAliasDuplicate: "另一台设备已使用该别名。别名必须唯一。",
  previewCharacterCount: "列表预览字符数",
  previewCharacterCountHelp: "显示每个已加载宏开头的最多五个字符。",
  hoverRevealDelay: "悬停显示延迟",
  hoverRevealDelayHelp: "指针停留在预览区域时显示已加载的宏。",
  hoverRevealDisabled: "禁用",
  hoverRevealImmediate: "立即",
  hoverRevealSeconds: (seconds) => `${seconds} 秒`,
  increasePreviewCharacterCount: "增加列表预览字符数",
  decreasePreviewCharacterCount: "减少列表预览字符数",
  increaseHoverRevealDelay: "增加悬停显示延迟",
  decreaseHoverRevealDelay: "减少悬停显示延迟",
  previewUnavailable: "暂无预览",
  revealSlotPreview: "显示宏预览",
  hideSlotPreview: "隐藏宏预览",
  saveSettings: "保存设置",
  settingsSaved: "✓ 设置已保存",
  settingsUnavailable: "无法加载设置。",
  operationFailed: "操作失败，请重试。",
  unprotectedTitle: "未受保护 · ",
  unprotectedHelp: "未设置管理密码；其他本机 HID 客户端也可以管理宏。",
  dynamicMacro: "动态宏",
  dynamicMacroTitle: "临时宏",
  dynamicMacroHelp: "仅存于 RAM 且不可读回的对象。仅上传非敏感文本；它们独立于静态宏列表。",
  dynamicUnencryptedTitle: "HID 未加密。",
  dynamicUnencryptedHelp: "不要上传密码、令牌或其他秘密。静态管理锁定时仍可使用动态宏。",
  dynamicObject: "动态对象",
  dynamicObjectLabel: (slot) => `对象 ${slot}`,
  dynamicObjectHelp: "上传和清空只作用于所选对象。",
  dynamicMacroText: "动态文本",
  dynamicMacroPlaceholder: "输入临时宏…",
  dynamicMacroTextHelp: (maximum) => `可打印 US ASCII、LF、Tab 和 Backspace · 最多 ${maximum} bytes。`,
  dynamicBytes: (count, maximum) => `${count} / ${maximum} bytes`,
  dynamicCapabilityStatus: "能力",
  dynamicCapabilityVersion: "版本",
  dynamicMaxBytes: (count) => `最多 ${count} bytes`,
  dynamicLifecycleBoot: "启动清空",
  dynamicLifecycleTtl: "TTL 清空",
  dynamicLifecycleExecute: "执行清空",
  dynamicLifecycleUsb: "USB 断开清空",
  dynamicLifecycleBle: "BLE profile 清空",
  dynamicLifecycleEndpoint: "端点切换清空",
  dynamicYes: "是",
  dynamicNo: "否",
  dynamicTtl: "TTL",
  dynamicTtlDefault: (seconds) => `设备默认值（${seconds} 秒）`,
  dynamicTtlCustom: "自定义…",
  dynamicTtlHelp: (min, max) => `可选显式 TTL · ${min}–${max} 秒`,
  seconds: "秒",
  dynamicSingleUse: "单次输入",
  dynamicSingleUseHelp: "成功执行后自动消费动态对象。",
  dynamicSingleUseUnsupported: "设备不支持保留对象，因此始终为单次输入。",
  dynamicCapabilityNote: "上传和清空只表示本地观察；对象不能读回。",
  dynamicUpload: "上传",
  dynamicClear: "清空",
  dynamicUploading: "正在上传…",
  dynamicClearing: "正在清空…",
  dynamicStatusUnknown: "未知",
  dynamicStatusDiscovering: "正在检查能力…",
  dynamicStatusReady: "就绪 · 尚无本地观察",
  dynamicStatusUploading: "正在上传…",
  dynamicStatusClearing: "正在清空…",
  dynamicStatusCommitted: "已在本地记录提交",
  dynamicStatusCleared: "已在本地记录清空",
  dynamicStatusUnsupported: "不支持",
  dynamicStatusError: "错误",
  dynamicUnsupportedHelp: "设备未声明 Dynamic Macro 协议支持。静态宏管理仍可用。",
  dynamicOperationError: "动态宏操作失败。本地状态未知，不要假设对象仍存在。",
  dynamicTextRequired: "请输入非空动态文本。",
  dynamicUnsupportedText: "动态文本仅支持可打印 US ASCII、LF、Tab 和 Backspace。",
  dynamicTextTooLong: (maximum) => `动态文本不能超过 ${maximum} bytes。`,
  dynamicTtlInvalid: "Dynamic Macro TTL 超出支持范围。",
  dynamicCapabilityError: "无法从该设备读取动态宏能力信息。请重新连接后重试。",
  dynamicWorkspace: "Dynamic 场景",
  dynamicWorkspaceEyebrow: "Dynamic 工作区",
  dynamicWorkspaceSummary: "仅存 RAM · 不可读回",
  dynamicPreviewBadge: "预览",
  dynamicPreviewStateLabel: "预览状态",
  dynamicPreviewStateHelp: "预览构建：本页所有数据都来自内存 fixture，不会连接设备，也不会写入磁盘或浏览器存储。",
  dynamicPreviewStateLabels: {
    empty: "空状态",
    new: "新建未保存",
    dirty: "有未保存修改",
    disconnected: "设备已断开",
    unknown: "设备状态未知",
    discovering: "正在读取能力",
    unsupported: "不支持 Dynamic",
    ready: "就绪",
    uploading: "上传中",
    committed: "本次会话已提交",
    clearing: "清除中",
    cleared: "本次会话已清除",
    error: "错误",
    staticLocked: "静态已锁定，Dynamic 可用",
    keepUnsupported: "不支持执行后保留",
    targetMissing: "目标对象不存在",
    capabilityChanged: "能力已变化",
    oversize: "正文超出上限",
  },
  dynamicPreviewMockNote: "仅预览交互：当前构建不会连接设备，这里的结果都不是设备确认。",
  dynamicPreviewDeviceName: "预览键盘",
  dynamicPreviewEntryHelp: "使用内存 fixture 数据查看 Dynamic 场景工作区，无需连接键盘或设备。",
  dynamicLegacyDialog: "旧版对话框",
  dynamicLegacyDialogHelp: "打开旧的动态宏对话框。该入口在新工作区通过视觉验收前临时保留。",
  dynamicWorkspaceWarningTitle: "仅限非敏感文本。",
  dynamicWorkspaceWarning: "动态宏未加密，只适合非机密文本。应用不会替你识别或过滤机密内容。",
  dynamicDeviceReady: "设备就绪",
  dynamicTarget: "上传目标",
  dynamicTargetDevice: "目标设备",
  dynamicTargetDeviceHelp: "预览使用固定示例名称；已连接的工作区会显示本机设备别名。",
  dynamicDeviceAliasUnset: "未设置设备别名",
  dynamicDeviceAliasRequiredHelp: "请先在设置中为该设备设置别名，场景才能以它为目标。",
  dynamicDeviceBound: "该场景已绑定当前连接的设备。",
  dynamicDeviceUnbound: "该场景未绑定当前连接的设备。",
  dynamicDeviceBind: "使用此设备",
  dynamicTargetObject: "动态对象",
  dynamicTargetChoose: "选择目标对象…",
  dynamicTargetUnavailable: "已保存的目标当前不可用",
  dynamicTargetMissingShort: "目标不在当前能力中",
  dynamicTargetMissingHelp: "已保存的目标对象不在当前能力列表里。请重新选择目标；正文和草稿会保留。",
  dynamicTargetPending: "尚未检查",
  dynamicTargetPendingHelp: "目标列表来自设备能力；设备未就绪时不可用。",
  dynamicTargetSingleHelp: "该设备只报告一个动态对象，因此目标是固定的。",
  dynamicTargetUseOnly: "使用此对象",
  dynamicNoObjects: "该设备未报告任何动态对象。",
  dynamicNeedsTarget: "请先选择目标对象。",
  dynamicStaticLockedNote: "静态管理保持锁定，但动态对象仍可用：Dynamic Macro 不经过静态密码闸门。",
  dynamicCapabilityChangedNotice: "设备能力已变化。上传前请重新确认正文长度、TTL、执行后保留和目标对象。",
  dynamicCapabilityDetails: "设备行为与能力详情",
  dynamicCapabilityObjectCount: "动态对象数量",
  dynamicCapabilityObject: "关联对象",
  dynamicCapabilityMaxBytesLabel: "最大长度",
  dynamicCapabilityTtlDefault: "默认 TTL",
  dynamicCapabilityTtlRange: "TTL 范围",
  dynamicCapabilityKeep: "执行后保留",
  dynamicObservation: "本地观察",
  dynamicObservationNone: "尚无本地观察。上传和清空结果只来自本次会话。",
  dynamicObservationUploading: "预览：正在显示向目标对象上传。",
  dynamicObservationCommitted: "预览：本次会话已将目标对象标记为已上传。这不是读回，也不能证明对象仍然存在。",
  dynamicObservationClearing: "预览：正在显示清除目标对象。",
  dynamicObservationCleared: "预览：本次会话已将目标对象标记为已清除。设备不会返回确认。",
  dynamicObservationErrorInterrupted: "预览错误：传输被中断。可重置观察后继续。",
  dynamicObservationErrorTimeout: "预览错误：设备未在超时前确认。可重置观察后继续。",
  dynamicObservationErrorUnsupported: "预览错误：设备以不支持为由拒绝请求。可重置观察后继续。",
  dynamicObservationTarget: "观察目标",
  dynamicObservationReset: "重置观察",
  dynamicObservationRealNote: "这里只是本次连接的本地观察。动态对象仅存于 RAM，会因执行、TTL 或断开而消失，且无法读回。",
  dynamicScenarioListAria: "Dynamic 场景列表",
  dynamicScenarios: "场景",
  dynamicScenarioCount: (count) => `${count} 个场景`,
  dynamicNewScenario: "新建场景",
  dynamicNoScenarios: "还没有场景。",
  dynamicUntitledScenario: "未命名场景",
  dynamicEmptyTitle: "还没有场景",
  dynamicEmptyHelp: "场景是你自己命名的桌面端模板；设备上的动态对象只是上传目标。",
  dynamicScenarioEyebrow: "Dynamic 场景",
  dynamicScenarioName: "场景名称",
  dynamicScenarioNameHelp: "仅用于桌面端显示，不会发送到设备。",
  dynamicScenarioSavedLocally: "已保存到内存（预览）",
  dynamicScenarioSavedToStore: "已保存",
  dynamicScenarioNameRequired: "请先为场景命名再保存。",
  dynamicScenarioNameTooLong: (maximum) => `场景名称最多 ${maximum} bytes。`,
  dynamicScenarioTextTooLongForStore: (maximum) => `场景文件中的正文最多 ${maximum} bytes。`,
  dynamicScenarioCloseMessage: "该场景有未保存修改。仍要关闭工作区吗？未保存的修改只留在内存中，不会写入场景文件。",
  dynamicScenarioCloseAnyway: "仍然关闭",
  dynamicStoreLoading: "正在加载已保存场景…",
  dynamicStoreLoadFailedTitle: "无法加载已保存的场景。",
  dynamicStoreSaveFailedTitle: "场景未能保存。",
  dynamicStoreNotReady: "本地场景库尚不可用。",
  dynamicScenarioNoTarget: "未选择目标对象",
  dynamicScenarioTarget: (label) => `目标：${label}`,
  dynamicScenarioTargetPending: "目标：尚未检查",
  dynamicScenarioTargetMissingShort: "目标不存在",
  dynamicScenarioSwitchMessage: "该场景有未保存修改。仍要切换场景吗？预览草稿会保留在内存中，直到预览重载。",
  dynamicScenarioSwitchAnyway: "仍然切换",
  dynamicScenarioDeleteTitle: "删除场景",
  dynamicScenarioDeleteMessage: (name) => `从预览中移除 ${name}？设备对象及其内容不受影响。`,
  dynamicScenarioDeleteMessageDevice: (name) => `从已保存场景中删除 ${name}？设备对象及其内容不受影响。`,
  dynamicScenarioDeleteConfirm: "删除场景",
  dynamicScenarioSaveAndUpload: "保存并上传",
  dynamicScenarioClearDevice: "清除设备对象",
  dynamicScenarioKeep: "执行后保留",
  dynamicScenarioKeepHelp: "成功执行后保留对象，而不是消费它。",
  dynamicScenarioKeepUnsupported: "该设备不支持执行后保留。请关闭该项后再上传；已保存的选择不会被自动改写。",
  dynamicConfirmUploadTitle: "预览上传",
  dynamicConfirmUploadMessage: (name, target) => `保存 ${name} 并标记为已上传到 ${target}？本次预览不会连接设备。`,
  dynamicConfirmUploadConfirm: "标记为已上传",
  dynamicConfirmClearTitle: "预览清除",
  dynamicConfirmClearMessage: (target) => `将 ${target} 标记为已清除？场景及其正文不受影响。`,
  dynamicConfirmClearConfirm: "标记为已清除",
  dynamicConfirmUploadTitleDevice: "保存并上传",
  dynamicConfirmUploadMessageDevice: (name, target) => `保存 ${name} 并上传到 ${target}？设备只会确认本次上传，没有读回。`,
  dynamicConfirmUploadConfirmDevice: "保存并上传",
  dynamicConfirmClearTitleDevice: "清除设备对象",
  dynamicConfirmClearMessageDevice: (target) => `在设备上清除 ${target}？场景及其正文会保留。`,
  dynamicConfirmClearConfirmDevice: "清除对象",
  dynamicBlockerDisconnected: "请先连接设备，再上传或清除。",
  dynamicBlockerUnknown: "重新连接后设备状态未知。请重新打开设备后再继续。",
  dynamicBlockerOperating: "已有操作正在进行。",
  dynamicBlockerDeviceAliasMissing: "该设备尚未设置别名。请先在设置中设置别名，再把场景绑定到它。",
  dynamicBlockerDeviceUnbound: "该场景未绑定当前连接的设备。请点击“使用此设备”显式绑定。",
  dynamicTextHelpPending: "支持可打印 US ASCII、LF、Tab 和 Backspace；长度上限以设备能力为准。",
  dynamicSampleScenarioWork: "工作终端",
  dynamicSampleScenarioBuild: "构建监视",
  dynamicSampleScenarioScratch: "临时草稿",
};

const MESSAGE_TABLE: Record<Locale, MessageTable> = { en: english, "zh-CN": chinese };

const ERROR_MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    hid_backend_unavailable: "The HID backend could not be initialized.",
    no_device: "No compatible Runtime Macro HID device was found.",
    usage_metadata_missing: "HID Usage metadata is unavailable; choose a device explicitly.",
    ambiguous_devices: "Multiple compatible HID devices were found; choose one explicitly.",
    device_open_failed: "The selected HID device could not be opened; it may be busy or require permission.",
    candidate_not_found: "The selected device is no longer available. Refresh the device list.",
    not_connected: "No Runtime Macro device is connected.",
    timeout: "The HID device did not respond in time.",
    transport_error: "Communication with the HID device failed.",
    protocol_error: "The device returned an invalid protocol response.",
    bad_version: english.oldFirmwareHelp,
    bad_opcode: "The device rejected the protocol command.",
    bad_request: "The device rejected the request.",
    bad_slot: "The device rejected the slot.",
    bad_offset: "The device rejected the data offset.",
    bad_length: "The device rejected the data length.",
    invalid_text: "The device rejected the slot text.",
    storage_error: "Applied for this session, but could not be saved permanently.",
    device_internal_error: "The device reported an internal error.",
    auth_required: "Unlock the device before managing macros.",
    auth_expired: "The authentication window expired. Unlock the device again.",
    auth_failed: "The management password was not accepted.",
    auth_not_configured: "The device has no management password configured.",
    rate_limited: "Too many authentication attempts; wait before trying again.",
    auth_no_challenge: "The authentication challenge is no longer available.",
    credential_invalid: english.credentialInvalid,
    empty_password: english.passwordRequired,
    invalid_authentication_input: "The authentication input is invalid.",
    invalid_slot: "The selected slot is invalid.",
    length_exceeded: "The slot text exceeds the protocol limit.",
    invalid_configuration: "The client configuration is invalid.",
    state_unavailable: "The application state is unavailable.",
    dynamic_unsupported: "This device does not support Dynamic Macro. Static macro management remains available.",
    dynamic_auth_boundary: "The device returned an authentication status for Dynamic Macro; static authentication was not changed.",
    dynamic_empty: english.dynamicTextRequired,
    dynamic_ttl_invalid: english.dynamicTtlInvalid,
    dynamic_keep_unsupported: english.dynamicSingleUseUnsupported,
  },
  "zh-CN": {
    hid_backend_unavailable: "无法初始化 HID 后端。",
    no_device: "未找到兼容的 Runtime Macro HID 设备。",
    usage_metadata_missing: "HID Usage 元数据不可用，请明确选择设备。",
    ambiguous_devices: "找到多个兼容的 HID 设备，请明确选择一个。",
    device_open_failed: "无法打开所选 HID 设备，设备可能正忙或需要权限。",
    candidate_not_found: "所选设备已不可用，请刷新设备列表。",
    not_connected: "没有连接 Runtime Macro 设备。",
    timeout: "HID 设备未及时响应。",
    transport_error: "与 HID 设备通信失败。",
    protocol_error: "设备返回了无效的协议响应。",
    bad_version: chinese.oldFirmwareHelp,
    bad_opcode: "设备拒绝了协议命令。",
    bad_request: "设备拒绝了请求。",
    bad_slot: "设备拒绝了该宏。",
    bad_offset: "设备拒绝了数据偏移量。",
    bad_length: "设备拒绝了数据长度。",
    invalid_text: "设备拒绝了宏正文。",
    storage_error: "本次会话可能已生效，但未能永久保存。",
    device_internal_error: "设备报告了内部错误。",
    auth_required: "请先解锁设备再管理宏。",
    auth_expired: "认证窗口已过期，请重新解锁设备。",
    auth_failed: "管理密码不正确。",
    auth_not_configured: "设备未设置管理密码。",
    rate_limited: "认证尝试过多，请等待后再试。",
    auth_no_challenge: "认证 challenge 已不可用。",
    credential_invalid: chinese.credentialInvalid,
    empty_password: chinese.passwordRequired,
    invalid_authentication_input: "认证输入无效。",
    invalid_slot: "所选宏无效。",
    length_exceeded: "宏正文超过协议限制。",
    invalid_configuration: "客户端配置无效。",
    state_unavailable: "应用状态不可用。",
    dynamic_unsupported: "此设备不支持 Dynamic Macro；静态宏管理仍可用。",
    dynamic_auth_boundary: "设备为 Dynamic Macro 返回了认证状态；静态认证状态未改变。",
    dynamic_empty: chinese.dynamicTextRequired,
    dynamic_ttl_invalid: chinese.dynamicTtlInvalid,
    dynamic_keep_unsupported: chinese.dynamicSingleUseUnsupported,
  },
};

export function getMessages(locale: Locale): MessageTable {
  return MESSAGE_TABLE[locale];
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || value === "zh-CN" || value === "en";
}

export function readLanguagePreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguagePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function resolveLocale(preference: LanguagePreference): Locale {
  if (preference === "zh-CN") return "zh-CN";
  if (preference === "en") return "en";
  const languages = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}

export function writeLanguagePreference(preference: LanguagePreference): void {
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, preference); } catch { /* optional preference */ }
}

export function translateCommandError(errorCode: string, locale: Locale): string {
  return ERROR_MESSAGES[locale][errorCode] ?? MESSAGE_TABLE[locale].operationFailed;
}

export function translateInputError(key: InputErrorKey, locale: Locale): string {
  const copy = MESSAGE_TABLE[locale];
  if (key === "unsupportedText") return copy.inputUnsupportedText;
  if (key === "textTooLong") return copy.inputTextTooLong;
  return copy.inputParseFailed;
}

export function translateSettingsValidation(key: SettingsValidationKey, locale: Locale, minTimeout: number, maxTimeout: number, maxRetries: number): string {
  const copy = MESSAGE_TABLE[locale];
  return key === "timeout" ? `${copy.requestTimeout}: ${copy.millisecondsRange(minTimeout, maxTimeout)}` : `${copy.retries}: ${copy.transportRetriesRange(maxRetries)}`;
}
