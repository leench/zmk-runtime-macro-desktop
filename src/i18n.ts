export type LanguagePreference = "system" | "zh-CN" | "en";
export type Locale = "zh-CN" | "en";

export const LANGUAGE_STORAGE_KEY = "zmk-runtime-macro-language:v1";

export type InputErrorKey = "unsupportedText" | "textTooLong" | "parseFailed";
export type SettingsValidationKey = "timeout" | "retries";

export type Messages = {
  appName: string;
  statusReconnecting: string;
  statusChecking: string;
  statusConnected: string;
  statusDisconnected: string;
  runtimeMacroDevice: string;
  reconnectOrRefresh: string;
  reconnectDevice: string;
  settings: string;
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  preferences: string;
  connectionSettings: string;
  close: string;
  language: string;
  languageFollowSystem: string;
  languageChinese: string;
  languageEnglish: string;
  languageHelp: string;
  autoReconnect: string;
  autoReconnectHelp: string;
  requestTimeout: string;
  retries: string;
  millisecondsRange: (min: number, max: number) => string;
  transportRetriesRange: (max: number) => string;
  settingsHelp: string;
  saved: string;
  saving: string;
  saveSettings: string;
  reconnect: string;
  connection: string;
  chooseInterface: string;
  notConnected: string;
  checkingCompatibleDevices: string;
  noCompatibleDevice: string;
  unnamedDevice: string;
  runtimeMacro: string;
  usageMetadataUnavailable: string;
  interfaceNumber: (number: number) => string;
  connectSelected: string;
  refresh: string;
  configuration: string;
  macroSlots: string;
  slotCount: (count: number) => string;
  refreshSlots: string;
  disconnect: string;
  diagnostics: string;
  connectionDetails: string;
  connected: string;
  disconnected: string;
  protocol: string;
  transport: string;
  device: string;
  vidPid: string;
  interface: string;
  usage: string;
  slotCountLabel: string;
  lastOperation: string;
  lastErrorCode: string;
  none: string;
  diagnosticsHelp: string;
  macroSlotsAria: string;
  noSlotsReturned: string;
  connectToLoadSlots: string;
  empty: string;
  unsavedChanges: string;
  inspector: string;
  selectSlot: string;
  chooseSlotHelp: string;
  slotLabel: (slot: string) => string;
  lastSaved: string;
  name: string;
  localLabelHelp: string;
  macro: string;
  bytes: (count: number) => string;
  loadingSlot: string;
  retry: string;
  noMacroConfigured: string;
  addMacro: string;
  macroContent: string;
  hideMacroContent: string;
  revealMacroContent: string;
  hide: string;
  reveal: string;
  macroControlHelp: string;
  insertControlCharacter: string;
  insertLf: string;
  insertTab: string;
  insertBackspace: string;
  clearMacro: string;
  save: string;
  clearThisMacro: string;
  cancel: string;
  clear: string;
  disconnectNote: string;
  closeUnsavedTitle: string;
  closeUnsavedMessage: string;
  closeWithoutSaving: string;
  switchUnsavedMessage: string;
  noChanges: string;
  deviceDisconnected: string;
  errorRetry: string;
  storageError: string;
  genericError: string;
  inputUnsupportedText: string;
  inputTextTooLong: string;
  inputParseFailed: string;
  settingsTimeoutInvalid: (min: number, max: number) => string;
  settingsRetriesInvalid: (max: number) => string;
  settingsUnavailable: string;
};

const english: Messages = {
  appName: "ZMK Runtime Macro",
  statusReconnecting: "Reconnecting…",
  statusChecking: "Checking device…",
  statusConnected: "Connected",
  statusDisconnected: "Device disconnected",
  runtimeMacroDevice: "Runtime Macro device",
  reconnectOrRefresh: "Reconnect or refresh device",
  reconnectDevice: "Reconnect device",
  settings: "Settings",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  preferences: "Preferences",
  connectionSettings: "Connection settings",
  close: "Close",
  language: "Language",
  languageFollowSystem: "Follow system",
  languageChinese: "中文",
  languageEnglish: "English",
  languageHelp: "Follow system uses Chinese for zh-* locales and English otherwise.",
  autoReconnect: "Auto reconnect",
  autoReconnectHelp: "Retry unexpected disconnects with a bounded backoff.",
  requestTimeout: "Request timeout",
  retries: "Retries",
  millisecondsRange: (min, max) => `Milliseconds · ${min}–${max}`,
  transportRetriesRange: (max) => `Transport retries · 0–${max}`,
  settingsHelp: "Timeout and retries apply on next connection. Macro content is never stored in preferences.",
  saved: "✓ Saved",
  saving: "Saving…",
  saveSettings: "Save settings",
  reconnect: "Reconnect",
  connection: "Connection",
  chooseInterface: "Choose a Runtime Macro interface",
  notConnected: "Not connected",
  checkingCompatibleDevices: "Checking for compatible Runtime Macro devices…",
  noCompatibleDevice: "No compatible Runtime Macro device found.",
  unnamedDevice: "Unnamed device",
  runtimeMacro: "Runtime Macro",
  usageMetadataUnavailable: "Usage metadata unavailable",
  interfaceNumber: (number) => `Interface ${number}`,
  connectSelected: "Connect selected",
  refresh: "Refresh",
  configuration: "Configuration",
  macroSlots: "Macro Slots",
  slotCount: (count) => `${count} slots`,
  refreshSlots: "Refresh slots",
  disconnect: "Disconnect",
  diagnostics: "Diagnostics",
  connectionDetails: "Connection details",
  connected: "Connected",
  disconnected: "Disconnected",
  protocol: "Protocol",
  transport: "Transport",
  device: "Device",
  vidPid: "VID / PID",
  interface: "Interface",
  usage: "Usage",
  slotCountLabel: "Slot count",
  lastOperation: "Last operation",
  lastErrorCode: "Last error code",
  none: "None",
  diagnosticsHelp: "Diagnostics never include macro content, HID paths, serial numbers, or raw reports.",
  macroSlotsAria: "Macro slots",
  noSlotsReturned: "The device returned no slots.",
  connectToLoadSlots: "Connect a device to load slots.",
  empty: "Empty",
  unsavedChanges: "● Unsaved changes",
  inspector: "Inspector",
  selectSlot: "Select a slot",
  chooseSlotHelp: "Choose a slot to view and edit its macro.",
  slotLabel: (slot) => `Slot ${slot}`,
  lastSaved: "Last saved",
  name: "Name",
  localLabelHelp: "Local label · not written to the keyboard",
  macro: "Macro",
  bytes: (count) => `${count} bytes`,
  loadingSlot: "Loading slot…",
  retry: "Retry",
  noMacroConfigured: "No macro configured",
  addMacro: "Add macro",
  macroContent: "Macro content",
  hideMacroContent: "Hide macro content",
  revealMacroContent: "Reveal macro content",
  hide: "Hide",
  reveal: "Reveal",
  macroControlHelp: "Reveal to edit. Enter inserts ↵ · Tab inserts ⇥ · use the button below for ⌫.",
  insertControlCharacter: "Insert control character",
  insertLf: "Insert LF",
  insertTab: "Insert Tab",
  insertBackspace: "Insert Backspace",
  clearMacro: "Clear macro…",
  save: "Save",
  clearThisMacro: "Clear this macro?",
  cancel: "Cancel",
  clear: "Clear",
  disconnectNote: "Device disconnected. Your unsaved changes remain in memory.",
  closeUnsavedTitle: "Unsaved changes",
  closeUnsavedMessage: "This window has unsaved changes.",
  closeWithoutSaving: "Close without saving",
  switchUnsavedMessage: "This slot has unsaved changes. Switch slots anyway?",
  noChanges: "No changes",
  deviceDisconnected: "Device disconnected",
  errorRetry: "Try again.",
  storageError: "Applied for this session, but could not be saved permanently.",
  genericError: "The operation failed. Try again.",
  inputUnsupportedText: "Macro text supports printable US ASCII, LF, Tab, and Backspace only.",
  inputTextTooLong: "Macro text cannot exceed 256 bytes.",
  inputParseFailed: "Macro text could not be parsed.",
  settingsTimeoutInvalid: (min, max) => `Request timeout must be an integer from ${min} to ${max} ms.`,
  settingsRetriesInvalid: (max) => `Retries must be an integer from 0 to ${max}.`,
  settingsUnavailable: "Settings could not be loaded. Try again.",
};

const chinese: Messages = {
  appName: "ZMK Runtime Macro",
  statusReconnecting: "正在重新连接…",
  statusChecking: "正在检查设备…",
  statusConnected: "已连接",
  statusDisconnected: "设备已断开",
  runtimeMacroDevice: "Runtime Macro 设备",
  reconnectOrRefresh: "重新连接或刷新设备",
  reconnectDevice: "重新连接设备",
  settings: "设置",
  theme: "主题",
  themeSystem: "跟随系统",
  themeLight: "浅色",
  themeDark: "深色",
  preferences: "偏好设置",
  connectionSettings: "连接设置",
  close: "关闭",
  language: "语言",
  languageFollowSystem: "跟随系统",
  languageChinese: "中文",
  languageEnglish: "English",
  languageHelp: "跟随系统在 zh-* 语言环境使用中文，其他情况使用 English。",
  autoReconnect: "自动重连",
  autoReconnectHelp: "意外断开后使用有限退避次数重试。",
  requestTimeout: "请求超时",
  retries: "重试次数",
  millisecondsRange: (min, max) => `毫秒 · ${min}–${max}`,
  transportRetriesRange: (max) => `传输重试 · 0–${max}`,
  settingsHelp: "超时和重试次数将在下次连接时生效。宏正文不会存入偏好设置。",
  saved: "✓ 已保存",
  saving: "正在保存…",
  saveSettings: "保存设置",
  reconnect: "重新连接",
  connection: "连接",
  chooseInterface: "选择 Runtime Macro 接口",
  notConnected: "未连接",
  checkingCompatibleDevices: "正在检查兼容的 Runtime Macro 设备…",
  noCompatibleDevice: "未找到兼容的 Runtime Macro 设备。",
  unnamedDevice: "未命名设备",
  runtimeMacro: "Runtime Macro",
  usageMetadataUnavailable: "Usage 元数据不可用",
  interfaceNumber: (number) => `接口 ${number}`,
  connectSelected: "连接所选设备",
  refresh: "刷新",
  configuration: "配置",
  macroSlots: "宏插槽",
  slotCount: (count) => `${count} 个插槽`,
  refreshSlots: "刷新插槽",
  disconnect: "断开连接",
  diagnostics: "诊断",
  connectionDetails: "连接详情",
  connected: "已连接",
  disconnected: "已断开",
  protocol: "协议",
  transport: "传输",
  device: "设备",
  vidPid: "VID / PID",
  interface: "接口",
  usage: "Usage",
  slotCountLabel: "插槽数量",
  lastOperation: "最近操作",
  lastErrorCode: "最近错误代码",
  none: "无",
  diagnosticsHelp: "诊断信息不会包含宏正文、HID 路径、序列号或原始报告。",
  macroSlotsAria: "宏插槽",
  noSlotsReturned: "设备没有返回插槽。",
  connectToLoadSlots: "连接设备以加载插槽。",
  empty: "空",
  unsavedChanges: "● 未保存修改",
  inspector: "检查器",
  selectSlot: "选择插槽",
  chooseSlotHelp: "选择一个插槽以查看和编辑宏。",
  slotLabel: (slot) => `插槽 ${slot}`,
  lastSaved: "上次保存",
  name: "名称",
  localLabelHelp: "本机标签 · 不会写入键盘",
  macro: "宏",
  bytes: (count) => `${count} bytes`,
  loadingSlot: "正在加载插槽…",
  retry: "重试",
  noMacroConfigured: "未配置宏",
  addMacro: "添加宏",
  macroContent: "宏正文",
  hideMacroContent: "隐藏宏正文",
  revealMacroContent: "显示宏正文",
  hide: "隐藏",
  reveal: "显示",
  macroControlHelp: "显示后才能编辑。Enter 插入 ↵ · Tab 插入 ⇥ · 使用下面的按钮插入 ⌫。",
  insertControlCharacter: "插入控制字符",
  insertLf: "插入 LF",
  insertTab: "插入 Tab",
  insertBackspace: "插入 Backspace",
  clearMacro: "清空宏…",
  save: "保存",
  clearThisMacro: "清空此宏？",
  cancel: "取消",
  clear: "清空",
  disconnectNote: "设备已断开。未保存的修改仍保留在内存中。",
  closeUnsavedTitle: "有未保存修改",
  closeUnsavedMessage: "当前窗口有未保存修改。",
  closeWithoutSaving: "不保存并关闭",
  switchUnsavedMessage: "当前插槽有未保存修改，仍要切换插槽吗？",
  noChanges: "没有修改",
  deviceDisconnected: "设备已断开",
  errorRetry: "请重试。",
  storageError: "本次会话可能已生效，但未能永久保存。",
  genericError: "操作失败，请重试。",
  inputUnsupportedText: "宏正文仅支持可打印 US ASCII、LF、Tab 和 Backspace。",
  inputTextTooLong: "宏正文不能超过 256 bytes。",
  inputParseFailed: "宏正文无法解析。",
  settingsTimeoutInvalid: (min, max) => `请求超时必须是 ${min} 到 ${max} 毫秒之间的整数。`,
  settingsRetriesInvalid: (max) => `重试次数必须是 0 到 ${max} 之间的整数。`,
  settingsUnavailable: "无法加载设置，请重试。",
};

const MESSAGE_TABLE: Record<Locale, Messages> = {
  en: english,
  "zh-CN": chinese,
};

const ERROR_MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    hid_backend_unavailable: "The HID backend could not be initialized.",
    no_device: "No compatible Runtime Macro HID device was found.",
    usage_metadata_missing: "HID Usage metadata is unavailable; choose a device explicitly.",
    ambiguous_devices: "Multiple compatible HID devices were found; choose one explicitly.",
    device_open_failed: "The selected HID device could not be opened; it may be busy or require permission.",
    timeout: "The HID device did not respond in time.",
    transport_error: "Communication with the HID device failed.",
    protocol_error: "The device returned an invalid protocol response.",
    bad_version: "The device uses an unsupported protocol version.",
    bad_opcode: "The device rejected the protocol command.",
    bad_request: "The device rejected the request.",
    bad_slot: "The device rejected the slot.",
    bad_offset: "The device rejected the data offset.",
    bad_length: "The device rejected the data length.",
    invalid_text: "The device rejected the slot text.",
    storage_error: english.storageError,
    device_internal_error: "The device reported an internal error.",
    device_error: "The device returned an unexpected status.",
    invalid_slot: "The selected slot is invalid.",
    length_exceeded: "The slot text exceeds the protocol limit.",
    invalid_configuration: "The client configuration is invalid.",
    state_unavailable: "The application state is unavailable.",
    candidate_not_found: "The selected device is no longer available. Refresh the device list.",
    not_connected: "No Runtime Macro device is connected.",
  },
  "zh-CN": {
    hid_backend_unavailable: "无法初始化 HID 后端。",
    no_device: "未找到兼容的 Runtime Macro HID 设备。",
    usage_metadata_missing: "HID Usage 元数据不可用，请明确选择设备。",
    ambiguous_devices: "找到多个兼容的 HID 设备，请明确选择一个。",
    device_open_failed: "无法打开所选 HID 设备，设备可能正忙或需要权限。",
    timeout: "HID 设备未及时响应。",
    transport_error: "与 HID 设备通信失败。",
    protocol_error: "设备返回了无效的协议响应。",
    bad_version: "设备使用了不支持的协议版本。",
    bad_opcode: "设备拒绝了协议命令。",
    bad_request: "设备拒绝了请求。",
    bad_slot: "设备拒绝了该插槽。",
    bad_offset: "设备拒绝了数据偏移量。",
    bad_length: "设备拒绝了数据长度。",
    invalid_text: "设备拒绝了插槽正文。",
    storage_error: chinese.storageError,
    device_internal_error: "设备报告了内部错误。",
    device_error: "设备返回了意外状态。",
    invalid_slot: "所选插槽无效。",
    length_exceeded: "插槽正文超过协议限制。",
    invalid_configuration: "客户端配置无效。",
    state_unavailable: "应用状态不可用。",
    candidate_not_found: "所选设备已不可用，请刷新设备列表。",
    not_connected: "没有连接 Runtime Macro 设备。",
  },
};

export function getMessages(locale: Locale): Messages {
  return MESSAGE_TABLE[locale];
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || value === "zh-CN" || value === "en";
}

export function readLanguagePreference(): LanguagePreference {
  try {
    if (typeof localStorage === "undefined") {
      return "system";
    }
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguagePreference(value)) {
      return value;
    }
  } catch {
    // Fall back to the system language when storage is unavailable.
  }
  return "system";
}

export function resolveLocale(preference: LanguagePreference): Locale {
  if (preference === "zh-CN") {
    return "zh-CN";
  }
  if (preference === "en") {
    return "en";
  }

  const systemLanguages =
    typeof navigator === "undefined"
      ? []
      : [
          ...(Array.isArray(navigator.languages) ? navigator.languages : []),
          ...(typeof navigator.language === "string" ? [navigator.language] : []),
        ];
  return systemLanguages.some((language) => language.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en";
}

export function writeLanguagePreference(preference: LanguagePreference): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Language preference is optional and never affects device operations.
  }
}

export function translateCommandError(errorCode: string, locale: Locale): string {
  return ERROR_MESSAGES[locale][errorCode] ?? MESSAGE_TABLE[locale].genericError;
}

export function translateInputError(key: InputErrorKey, locale: Locale): string {
  const copy = MESSAGE_TABLE[locale];
  switch (key) {
    case "unsupportedText":
      return copy.inputUnsupportedText;
    case "textTooLong":
      return copy.inputTextTooLong;
    case "parseFailed":
      return copy.inputParseFailed;
  }
}

export function translateSettingsValidation(
  key: SettingsValidationKey,
  locale: Locale,
  minTimeout: number,
  maxTimeout: number,
  maxRetries: number,
): string {
  const copy = MESSAGE_TABLE[locale];
  return key === "timeout"
    ? copy.settingsTimeoutInvalid(minTimeout, maxTimeout)
    : copy.settingsRetriesInvalid(maxRetries);
}
