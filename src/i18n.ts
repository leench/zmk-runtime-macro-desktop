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
