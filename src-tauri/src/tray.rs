//! System tray: tray icon, localized menu, window lifecycle helpers and the
//! runtime context the native menu mirrors.
//!
//! This module implements the tray stage of `docs/DYNAMIC-AUTOMATION-PLAN.md`
//! (§4.1, §4.2 and stage 7). It owns exactly two responsibilities:
//!
//! 1. Window lifecycle: restoring the main window, hiding it to the tray instead
//!    of quitting, and an explicit quit item.
//! 2. A bounded view of the running application: whether a device is connected,
//!    the exact `DynamicServiceStatus` tag, the current scenario *display name*
//!    and three action flags. Every value is validated here before it can reach
//!    a menu label, so no arbitrary string ever becomes native menu text.
//!
//! Boundary: the tray never opens HID, never sends a protocol frame and never
//! calls the Dynamic service or the scenario store. The three real actions
//! (`chooseScenario`, `uploadScenario`, `clearDynamic`) restore and focus the
//! main window and emit [`TRAY_ACTION_EVENT`]; the connected window then runs the
//! action through its normal bridge, dirty confirmation and save path. A disabled
//! item never fires, and a click is re-checked against the current context before
//! anything is emitted.
//!
//! Menu labels exist for the two UI locales (`en`, `zh-CN`). Which one is shown
//! is decided by the frontend's `resolveLocale` and applied through the
//! `set_tray_locale` command: this module never derives a language from the
//! environment, stored preferences or device data.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Wry,
};

/// Tray icon id. Stable so the tray can be looked up again for later updates.
pub const TRAY_ID: &str = "main-tray";

/// Stable menu item ids. These are the contract between [`init`] and the menu
/// event handler and stay stable even when labels change.
pub const MENU_OPEN_MAIN: &str = "tray-open-main";
pub const MENU_STATUS_DEVICE: &str = "tray-status-device";
pub const MENU_STATUS_DYNAMIC: &str = "tray-status-dynamic";
pub const MENU_STATUS_SCENARIO: &str = "tray-status-scenario";
pub const MENU_CHOOSE_SCENARIO: &str = "tray-choose-scenario";
pub const MENU_UPLOAD_SCENARIO: &str = "tray-upload-scenario";
pub const MENU_CLEAR_DYNAMIC: &str = "tray-clear-dynamic";
pub const MENU_SETTINGS: &str = "tray-settings";
pub const MENU_QUIT: &str = "tray-quit";

/// Number of entries in [`TrayLabels`] and in the tray menu.
pub const MENU_ITEM_COUNT: usize = 9;

/// Entries that only display state. They are disabled in every context.
pub const STATUS_MENU_IDS: [&str; 3] = [
    MENU_STATUS_DEVICE,
    MENU_STATUS_DYNAMIC,
    MENU_STATUS_SCENARIO,
];
/// Entries that ask the connected window for a real action.
pub const ACTION_MENU_IDS: [&str; 3] = [
    MENU_CHOOSE_SCENARIO,
    MENU_UPLOAD_SCENARIO,
    MENU_CLEAR_DYNAMIC,
];
/// Entries that drive the window lifecycle and the settings modal.
pub const WINDOW_MENU_IDS: [&str; 3] = [MENU_OPEN_MAIN, MENU_SETTINGS, MENU_QUIT];

/// Stable global event name used for the three real tray actions.
pub const TRAY_ACTION_EVENT: &str = "tray-action";

/// Upper bound of the scenario display name, identical to the store schema.
pub const MAX_TRAY_SCENARIO_NAME_BYTES: usize = crate::scenario_store::MAX_SCENARIO_NAME_BYTES;

/// Upper bound of the device alias the tray may display.
///
/// It matches the store display-name bound, so an alias that fits a Scenario can
/// always be shown in a native menu label.
pub const MAX_TRAY_DEVICE_ALIAS_BYTES: usize = crate::scenario_store::MAX_SCENARIO_NAME_BYTES;

const TOOLTIP: &str = "ZMK Runtime Macro";

/// A tray menu locale: exactly the two UI locales of `src/i18n.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayLocale {
    En,
    ZhCn,
}

impl TrayLocale {
    /// Locale used until the frontend reports its resolved locale.
    ///
    /// English is the safe default: it matches the labels the tray is created
    /// with, and an unresolved locale must never be guessed from the host.
    pub const DEFAULT: Self = Self::En;

    /// Parses an exact frontend locale tag.
    ///
    /// Anything else — `system`, a raw navigator language such as `zh-Hans-CN`,
    /// a case variant such as `zh-cn`, or any arbitrary string — is rejected
    /// instead of falling back, so the menu can only ever show a language the
    /// frontend explicitly resolved.
    pub fn from_tag(tag: &str) -> Option<Self> {
        match tag {
            "en" => Some(Self::En),
            "zh-CN" => Some(Self::ZhCn),
            _ => None,
        }
    }

    /// The exact tag accepted by [`Self::from_tag`].
    pub const fn tag(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::ZhCn => "zh-CN",
        }
    }

    /// Every label of this locale.
    pub const fn labels(self) -> TrayLabels {
        TrayLabels::for_locale(self)
    }
}

/// Locally observed Dynamic state as the tray is allowed to show it.
///
/// The tags are exactly the serialized `DynamicServiceStatus` values of the
/// service state layer, so the menu can never invent a status the backend does
/// not publish. They are local observations, not a device readback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayDynamicStatus {
    Unknown,
    Discovering,
    Ready,
    Unsupported,
    Uploading,
    CommittedLocally,
    Clearing,
    ClearedLocally,
    Error,
}

impl TrayDynamicStatus {
    /// Every accepted status, in the order the service layer declares them.
    pub const ALL: [Self; 9] = [
        Self::Unknown,
        Self::Discovering,
        Self::Ready,
        Self::Unsupported,
        Self::Uploading,
        Self::CommittedLocally,
        Self::Clearing,
        Self::ClearedLocally,
        Self::Error,
    ];

    /// Parses an exact serialized service status tag; anything else is rejected
    /// instead of falling back to a default.
    pub fn from_tag(tag: &str) -> Option<Self> {
        match tag {
            "unknown" => Some(Self::Unknown),
            "discovering" => Some(Self::Discovering),
            "ready" => Some(Self::Ready),
            "unsupported" => Some(Self::Unsupported),
            "uploading" => Some(Self::Uploading),
            "committedLocally" => Some(Self::CommittedLocally),
            "clearing" => Some(Self::Clearing),
            "clearedLocally" => Some(Self::ClearedLocally),
            "error" => Some(Self::Error),
            _ => None,
        }
    }

    /// The exact serialized tag accepted by [`Self::from_tag`].
    pub const fn tag(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Discovering => "discovering",
            Self::Ready => "ready",
            Self::Unsupported => "unsupported",
            Self::Uploading => "uploading",
            Self::CommittedLocally => "committedLocally",
            Self::Clearing => "clearing",
            Self::ClearedLocally => "clearedLocally",
            Self::Error => "error",
        }
    }

    /// Localized menu text for this status.
    ///
    /// `committedLocally` / `clearedLocally` say "local" on purpose: they repeat
    /// the local acknowledgement of this session and are not a device readback.
    pub const fn label(self, locale: TrayLocale) -> &'static str {
        match (self, locale) {
            (Self::Unknown, TrayLocale::En) => "Unknown",
            (Self::Unknown, TrayLocale::ZhCn) => "未知",
            (Self::Discovering, TrayLocale::En) => "Checking…",
            (Self::Discovering, TrayLocale::ZhCn) => "正在检查…",
            (Self::Ready, TrayLocale::En) => "Ready",
            (Self::Ready, TrayLocale::ZhCn) => "就绪",
            (Self::Unsupported, TrayLocale::En) => "Unsupported",
            (Self::Unsupported, TrayLocale::ZhCn) => "不支持",
            (Self::Uploading, TrayLocale::En) => "Uploading…",
            (Self::Uploading, TrayLocale::ZhCn) => "正在上传…",
            (Self::CommittedLocally, TrayLocale::En) => "Sent · local confirmation",
            (Self::CommittedLocally, TrayLocale::ZhCn) => "已发送 · 本地确认",
            (Self::Clearing, TrayLocale::En) => "Clearing…",
            (Self::Clearing, TrayLocale::ZhCn) => "正在清除…",
            (Self::ClearedLocally, TrayLocale::En) => "Cleared · local confirmation",
            (Self::ClearedLocally, TrayLocale::ZhCn) => "已清除 · 本地确认",
            (Self::Error, TrayLocale::En) => "Error",
            (Self::Error, TrayLocale::ZhCn) => "错误",
        }
    }
}

/// A rejected tray runtime input. Both variants carry a stable code and a
/// message that never echoes the rejected value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayContextError {
    /// The status tag is not one of the serialized service statuses.
    UnsupportedStatus,
    /// The scenario display name is empty, too long or contains control characters.
    InvalidScenarioName,
    /// The device alias is empty, too long or contains control characters.
    InvalidDeviceAlias,
}

impl TrayContextError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::UnsupportedStatus => "unsupported_tray_status",
            Self::InvalidScenarioName => "invalid_tray_scenario_name",
            Self::InvalidDeviceAlias => "invalid_tray_alias",
        }
    }

    pub const fn message(self) -> &'static str {
        match self {
            Self::UnsupportedStatus => "Unsupported tray status.",
            Self::InvalidScenarioName => {
                "The tray scenario name must be non-empty, at most 64 bytes and free of control characters."
            }
            Self::InvalidDeviceAlias => {
                "The tray device alias must be non-empty, at most 64 bytes and free of control characters."
            }
        }
    }
}

impl std::fmt::Display for TrayContextError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message())
    }
}

impl std::error::Error for TrayContextError {}

/// Bounded view of the running application that the native menu mirrors.
///
/// It holds only display data: no dynamic text, no HID path, no serial number,
/// no device identifier. The scenario name is validated before it is stored, so
/// it can never contain control characters or grow past the store bound.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayRuntimeContext {
    device_connected: bool,
    dynamic_status: TrayDynamicStatus,
    current_scenario_name: Option<String>,
    /// Local alias of the connected device; always `None` while disconnected.
    device_alias: Option<String>,
    can_choose_scenario: bool,
    can_upload_scenario: bool,
    can_clear_dynamic: bool,
}

impl Default for TrayRuntimeContext {
    fn default() -> Self {
        Self {
            device_connected: false,
            dynamic_status: TrayDynamicStatus::Unknown,
            current_scenario_name: None,
            device_alias: None,
            can_choose_scenario: false,
            can_upload_scenario: false,
            can_clear_dynamic: false,
        }
    }
}

impl TrayRuntimeContext {
    /// Validates every field and builds the context.
    pub fn new(
        device_connected: bool,
        dynamic_status: TrayDynamicStatus,
        current_scenario_name: Option<String>,
        device_alias: Option<String>,
        can_choose_scenario: bool,
        can_upload_scenario: bool,
        can_clear_dynamic: bool,
    ) -> Result<Self, TrayContextError> {
        // A supplied alias is always validated, so an unsafe value is refused
        // instead of being dropped silently; it is only *displayed* while a
        // device is connected.
        let device_alias = normalize_device_alias(device_alias)?;
        Ok(Self {
            device_connected,
            dynamic_status,
            current_scenario_name: normalize_scenario_name(current_scenario_name)?,
            device_alias: if device_connected { device_alias } else { None },
            can_choose_scenario,
            can_upload_scenario,
            can_clear_dynamic,
        })
    }

    pub const fn device_connected(&self) -> bool {
        self.device_connected
    }

    pub const fn dynamic_status(&self) -> TrayDynamicStatus {
        self.dynamic_status
    }

    pub fn current_scenario_name(&self) -> Option<&str> {
        self.current_scenario_name.as_deref()
    }

    /// Alias of the connected device, or `None` while it has none.
    pub fn device_alias(&self) -> Option<&str> {
        self.device_alias.as_deref()
    }

    /// The window can only show the workspace of a connected device, so the
    /// choose flag never survives a lost connection.
    pub const fn choose_scenario_enabled(&self) -> bool {
        self.device_connected && self.can_choose_scenario
    }

    /// Upload and clear are device operations: they require the connection the
    /// frontend reported *and* the frontend's own blocker-free state.
    pub const fn upload_scenario_enabled(&self) -> bool {
        self.device_connected && self.can_upload_scenario
    }

    pub const fn clear_dynamic_enabled(&self) -> bool {
        self.device_connected && self.can_clear_dynamic
    }
}

/// Raw runtime state a connected window publishes for the native menu.
///
/// The command takes this as its single input object, so the Tauri IPC contract
/// is one bounded payload instead of seven flat arguments. Every field is
/// validated by [`Self::to_context`]: an unknown status tag or an unsafe display
/// name is rejected instead of being sanitized into the menu silently.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayRuntimeStateInput {
    pub device_connected: bool,
    pub dynamic_status: String,
    pub current_scenario_name: Option<String>,
    pub device_alias: Option<String>,
    pub can_choose_scenario: bool,
    pub can_upload_scenario: bool,
    pub can_clear_dynamic: bool,
}

impl TrayRuntimeStateInput {
    /// The only path from frontend input into the menu.
    pub fn to_context(&self) -> Result<TrayRuntimeContext, TrayContextError> {
        let status = TrayDynamicStatus::from_tag(&self.dynamic_status)
            .ok_or(TrayContextError::UnsupportedStatus)?;
        TrayRuntimeContext::new(
            self.device_connected,
            status,
            self.current_scenario_name.clone(),
            self.device_alias.clone(),
            self.can_choose_scenario,
            self.can_upload_scenario,
            self.can_clear_dynamic,
        )
    }
}

/// A display name is safe when it is non-empty once trimmed, within the store
/// bound in bytes and free of control characters.
fn normalize_scenario_name(raw: Option<String>) -> Result<Option<String>, TrayContextError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > MAX_TRAY_SCENARIO_NAME_BYTES
        || trimmed.chars().any(char::is_control)
    {
        return Err(TrayContextError::InvalidScenarioName);
    }
    Ok(Some(trimmed.to_string()))
}

/// A device alias is a display name of the same shape as a scenario name: it is
/// trimmed, bounded in bytes and refused when it carries a control character, so
/// arbitrary frontend text can never become a native menu label.
fn normalize_device_alias(raw: Option<String>) -> Result<Option<String>, TrayContextError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > MAX_TRAY_DEVICE_ALIAS_BYTES
        || trimmed.chars().any(char::is_control)
    {
        return Err(TrayContextError::InvalidDeviceAlias);
    }
    Ok(Some(trimmed.to_string()))
}

/// Every label of the native tray menu for one locale. The owned strings are
/// produced by [`TrayLabels::render`], because two rows embed runtime state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayRenderedLabels {
    pub open_main: String,
    pub status_device: String,
    pub status_dynamic: String,
    pub status_scenario: String,
    pub choose_scenario: String,
    pub upload_scenario: String,
    pub clear_dynamic: String,
    pub settings: String,
    pub quit: String,
}

/// Every label of the native tray menu for one locale.
///
/// The labels live here and not in the frontend message tables because the tray
/// menu is a native menu owned by Rust. Menu item ids stay the contract; only
/// the text follows the UI locale.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrayLabels {
    locale: TrayLocale,
    pub open_main: &'static str,
    pub device_prefix: &'static str,
    pub device_connected: &'static str,
    pub device_disconnected: &'static str,
    pub dynamic_prefix: &'static str,
    pub scenario_prefix: &'static str,
    pub scenario_none: &'static str,
    pub choose_scenario: &'static str,
    pub upload_scenario: &'static str,
    pub clear_dynamic: &'static str,
    pub settings: &'static str,
    pub quit: &'static str,
}

const ENGLISH_LABELS: TrayLabels = TrayLabels {
    locale: TrayLocale::En,
    open_main: "Open ZMK Runtime Macro",
    device_prefix: "Device: ",
    device_connected: "Device: connected",
    device_disconnected: "Device: not connected",
    dynamic_prefix: "Dynamic status: ",
    scenario_prefix: "Current scenario: ",
    scenario_none: "none",
    choose_scenario: "Choose scenario",
    upload_scenario: "Upload current scenario",
    clear_dynamic: "Clear Dynamic Object",
    settings: "Settings",
    quit: "Quit ZMK Runtime Macro",
};

const CHINESE_LABELS: TrayLabels = TrayLabels {
    locale: TrayLocale::ZhCn,
    open_main: "打开 ZMK Runtime Macro",
    device_prefix: "设备：",
    device_connected: "设备：已连接",
    device_disconnected: "设备：未连接",
    dynamic_prefix: "Dynamic 状态：",
    scenario_prefix: "当前场景：",
    scenario_none: "无",
    choose_scenario: "选择场景",
    upload_scenario: "上传当前场景",
    clear_dynamic: "清除 Dynamic Object",
    settings: "设置",
    quit: "退出 ZMK Runtime Macro",
};

impl TrayLabels {
    pub const fn for_locale(locale: TrayLocale) -> Self {
        match locale {
            TrayLocale::En => ENGLISH_LABELS,
            TrayLocale::ZhCn => CHINESE_LABELS,
        }
    }

    pub const fn locale(self) -> TrayLocale {
        self.locale
    }

    /// Renders every menu label for one runtime context.
    ///
    /// The three status rows show real state; the three action rows only change
    /// their enabled flag, never their text.
    pub fn render(self, context: &TrayRuntimeContext) -> TrayRenderedLabels {
        let device = match context.device_alias.as_deref() {
            Some(alias) => format!("{}{}", self.device_prefix, alias),
            None if context.device_connected => self.device_connected.to_string(),
            None => self.device_disconnected.to_string(),
        };
        let scenario = context
            .current_scenario_name
            .as_deref()
            .unwrap_or(self.scenario_none);
        TrayRenderedLabels {
            open_main: self.open_main.to_string(),
            status_device: device,
            status_dynamic: format!(
                "{}{}",
                self.dynamic_prefix,
                context.dynamic_status.label(self.locale)
            ),
            status_scenario: format!("{}{}", self.scenario_prefix, scenario),
            choose_scenario: self.choose_scenario.to_string(),
            upload_scenario: self.upload_scenario.to_string(),
            clear_dynamic: self.clear_dynamic.to_string(),
            settings: self.settings.to_string(),
            quit: self.quit.to_string(),
        }
    }
}

impl TrayRenderedLabels {
    /// Pairs every stable menu item id with its rendered text, in menu order.
    pub fn entries(&self) -> [(&'static str, &str); MENU_ITEM_COUNT] {
        [
            (MENU_OPEN_MAIN, &self.open_main),
            (MENU_STATUS_DEVICE, &self.status_device),
            (MENU_STATUS_DYNAMIC, &self.status_dynamic),
            (MENU_STATUS_SCENARIO, &self.status_scenario),
            (MENU_CHOOSE_SCENARIO, &self.choose_scenario),
            (MENU_UPLOAD_SCENARIO, &self.upload_scenario),
            (MENU_CLEAR_DYNAMIC, &self.clear_dynamic),
            (MENU_SETTINGS, &self.settings),
            (MENU_QUIT, &self.quit),
        ]
    }
}

/// Whether one menu item is interactive in this context.
///
/// The three status rows are display-only and stay disabled in every context.
pub fn menu_item_enabled(id: &str, context: &TrayRuntimeContext) -> bool {
    match id {
        MENU_OPEN_MAIN | MENU_SETTINGS | MENU_QUIT => true,
        MENU_CHOOSE_SCENARIO => context.choose_scenario_enabled(),
        MENU_UPLOAD_SCENARIO => context.upload_scenario_enabled(),
        MENU_CLEAR_DYNAMIC => context.clear_dynamic_enabled(),
        _ => false,
    }
}

/// One real tray action. The serialized tags are the contract with the frontend
/// listener; only these three exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrayAction {
    ChooseScenario,
    UploadScenario,
    ClearDynamic,
}

impl TrayAction {
    pub const ALL: [Self; 3] = [
        Self::ChooseScenario,
        Self::UploadScenario,
        Self::ClearDynamic,
    ];

    pub const fn tag(self) -> &'static str {
        match self {
            Self::ChooseScenario => "chooseScenario",
            Self::UploadScenario => "uploadScenario",
            Self::ClearDynamic => "clearDynamic",
        }
    }

    pub fn from_tag(tag: &str) -> Option<Self> {
        match tag {
            "chooseScenario" => Some(Self::ChooseScenario),
            "uploadScenario" => Some(Self::UploadScenario),
            "clearDynamic" => Some(Self::ClearDynamic),
            _ => None,
        }
    }

    /// The menu item that triggers this action.
    pub const fn menu_id(self) -> &'static str {
        match self {
            Self::ChooseScenario => MENU_CHOOSE_SCENARIO,
            Self::UploadScenario => MENU_UPLOAD_SCENARIO,
            Self::ClearDynamic => MENU_CLEAR_DYNAMIC,
        }
    }

    pub fn from_menu_id(id: &str) -> Option<Self> {
        match id {
            MENU_CHOOSE_SCENARIO => Some(Self::ChooseScenario),
            MENU_UPLOAD_SCENARIO => Some(Self::UploadScenario),
            MENU_CLEAR_DYNAMIC => Some(Self::ClearDynamic),
            _ => None,
        }
    }
}

/// Event payload of one tray action. It carries the action and nothing else: no
/// dynamic text, no HID path, no serial number and no device identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayActionPayload {
    pub action: TrayAction,
}

/// Lives inside [`TrayMenuItems`]: the last locale and context the menu shows.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TrayMenuState {
    locale: TrayLocale,
    context: TrayRuntimeContext,
    /// Bumped on every stored change so a render can tell whether a newer state
    /// landed while it was updating the menu.
    version: u64,
}

impl Default for TrayMenuState {
    fn default() -> Self {
        Self {
            locale: TrayLocale::DEFAULT,
            context: TrayRuntimeContext::default(),
            version: 0,
        }
    }
}

/// Lock-free mirror of the three action flags.
///
/// The menu event handler runs on the main thread while the same thread may be
/// mid-dispatch, so it must never wait for the state lock: a click is re-checked
/// against these flags instead. They are written by [`TrayMenuItems::refresh`]
/// from exactly the same predicate that sets `MenuItem::set_enabled`.
#[derive(Debug, Default)]
struct TrayActionFlags {
    choose: AtomicBool,
    upload: AtomicBool,
    clear: AtomicBool,
}

impl TrayActionFlags {
    fn store(&self, context: &TrayRuntimeContext) {
        self.choose.store(
            menu_item_enabled(MENU_CHOOSE_SCENARIO, context),
            Ordering::Relaxed,
        );
        self.upload.store(
            menu_item_enabled(MENU_UPLOAD_SCENARIO, context),
            Ordering::Relaxed,
        );
        self.clear.store(
            menu_item_enabled(MENU_CLEAR_DYNAMIC, context),
            Ordering::Relaxed,
        );
    }

    fn get(&self, action: TrayAction) -> bool {
        match action {
            TrayAction::ChooseScenario => self.choose.load(Ordering::Relaxed),
            TrayAction::UploadScenario => self.upload.load(Ordering::Relaxed),
            TrayAction::ClearDynamic => self.clear.load(Ordering::Relaxed),
        }
    }
}

/// Live handles to the tray menu items, kept so text and enabled state can be
/// replaced in place after [`init`] without rebuilding the menu.
///
/// Ids, menu structure and menu event handling never change; only text and the
/// enabled flag follow the locale and the runtime context.
pub struct TrayMenuItems {
    open_main: MenuItem<Wry>,
    status_device: MenuItem<Wry>,
    status_dynamic: MenuItem<Wry>,
    status_scenario: MenuItem<Wry>,
    choose_scenario: MenuItem<Wry>,
    upload_scenario: MenuItem<Wry>,
    clear_dynamic: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    state: Mutex<TrayMenuState>,
    action_flags: TrayActionFlags,
}

impl TrayMenuItems {
    /// Creates every menu item for `state` and keeps its handle.
    fn build(app: &App, state: TrayMenuState) -> tauri::Result<Self> {
        let items = Self::build_items(app, &state)?;
        items.refresh(&state)?;
        Ok(items)
    }

    fn build_items(app: &App, state: &TrayMenuState) -> tauri::Result<Self> {
        let initial = state.locale.labels().render(&state.context);
        Ok(Self {
            open_main: MenuItemBuilder::with_id(MENU_OPEN_MAIN, initial.open_main).build(app)?,
            status_device: MenuItemBuilder::with_id(MENU_STATUS_DEVICE, initial.status_device)
                .enabled(false)
                .build(app)?,
            status_dynamic: MenuItemBuilder::with_id(MENU_STATUS_DYNAMIC, initial.status_dynamic)
                .enabled(false)
                .build(app)?,
            status_scenario: MenuItemBuilder::with_id(
                MENU_STATUS_SCENARIO,
                initial.status_scenario,
            )
            .enabled(false)
            .build(app)?,
            choose_scenario: MenuItemBuilder::with_id(
                MENU_CHOOSE_SCENARIO,
                initial.choose_scenario,
            )
            .enabled(false)
            .build(app)?,
            upload_scenario: MenuItemBuilder::with_id(
                MENU_UPLOAD_SCENARIO,
                initial.upload_scenario,
            )
            .enabled(false)
            .build(app)?,
            clear_dynamic: MenuItemBuilder::with_id(MENU_CLEAR_DYNAMIC, initial.clear_dynamic)
                .enabled(false)
                .build(app)?,
            settings: MenuItemBuilder::with_id(MENU_SETTINGS, initial.settings).build(app)?,
            quit: MenuItemBuilder::with_id(MENU_QUIT, initial.quit).build(app)?,
            state: Mutex::new(state.clone()),
            action_flags: TrayActionFlags::default(),
        })
    }

    /// The menu item handle of one stable id.
    fn item_for(&self, id: &str) -> Option<&MenuItem<Wry>> {
        match id {
            MENU_OPEN_MAIN => Some(&self.open_main),
            MENU_STATUS_DEVICE => Some(&self.status_device),
            MENU_STATUS_DYNAMIC => Some(&self.status_dynamic),
            MENU_STATUS_SCENARIO => Some(&self.status_scenario),
            MENU_CHOOSE_SCENARIO => Some(&self.choose_scenario),
            MENU_UPLOAD_SCENARIO => Some(&self.upload_scenario),
            MENU_CLEAR_DYNAMIC => Some(&self.clear_dynamic),
            MENU_SETTINGS => Some(&self.settings),
            MENU_QUIT => Some(&self.quit),
            _ => None,
        }
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, TrayMenuState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Whether one action is currently offered.
    ///
    /// This reads a lock-free mirror, because the menu event handler runs on the
    /// main thread and must never block on the state lock.
    pub fn action_enabled(&self, action: TrayAction) -> bool {
        self.action_flags.get(action)
    }

    /// Applies the given locale and keeps the current runtime context.
    pub fn set_locale(&self, locale: TrayLocale) -> tauri::Result<()> {
        self.update(|state| state.locale = locale)
    }

    /// Applies one validated runtime context and keeps the current locale.
    pub fn set_context(&self, context: TrayRuntimeContext) -> tauri::Result<()> {
        self.update(|state| state.context = context)
    }

    /// Stores one change, then renders the newest state.
    ///
    /// The state lock is never held while menu items are updated: those calls
    /// dispatch to the main thread and block, so holding the lock across them
    /// could deadlock against the menu event handler. Rendering the newest
    /// snapshot afterwards means a change that lands in between is still shown
    /// (and it renders itself as well), so no update is lost.
    fn update(&self, apply: impl FnOnce(&mut TrayMenuState)) -> tauri::Result<()> {
        let mut version = {
            let mut state = self.lock_state();
            apply(&mut state);
            state.version = state.version.wrapping_add(1);
            state.version
        };
        // Bounded: a newer state always renders itself, so this only has to
        // catch the snapshot that was replaced while it was being rendered.
        for _ in 0..8 {
            let (snapshot, snapshot_version) = {
                let state = self.lock_state();
                (state.clone(), state.version)
            };
            self.refresh(&snapshot)?;
            if snapshot_version == version {
                break;
            }
            version = snapshot_version;
        }
        Ok(())
    }

    /// Rewrites every label and enabled flag from `state`.
    fn refresh(&self, state: &TrayMenuState) -> tauri::Result<()> {
        let rendered = state.locale.labels().render(&state.context);
        for (id, text) in rendered.entries() {
            let Some(item) = self.item_for(id) else {
                continue;
            };
            item.set_text(text)?;
            item.set_enabled(menu_item_enabled(id, &state.context))?;
        }
        // The mirror is stored last, so a click only sees flags that match the
        // menu the user could actually have clicked.
        self.action_flags.store(&state.context);
        Ok(())
    }
}

/// Shows, unminimizes and focuses the main window.
///
/// Used by the tray icon, the tray menu and the single-instance plugin so every
/// window entry point behaves the same after a hide-to-tray or a second launch.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Restores the window and asks the connected window to run `action`.
///
/// The tray performs no device work itself: the frontend listener owns the
/// bridge call, the save-before-upload order and the confirmation dialogs.
fn emit_action(app: &AppHandle, action: TrayAction) {
    show_main_window(app);
    let _ = app.emit(TRAY_ACTION_EVENT, TrayActionPayload { action });
}

/// Creates the tray icon and its menu.
///
/// Must run inside the Tauri `setup` hook: tray and menu creation talk to the
/// platform UI and require a live application instance. The menu item handles
/// are managed afterwards so `set_tray_locale` and `set_tray_runtime_state` can
/// update their labels and enabled flags.
pub fn init(app: &App) -> tauri::Result<()> {
    let items = TrayMenuItems::build(app, TrayMenuState::default())?;

    let menu = MenuBuilder::new(app)
        .item(&items.open_main)
        .separator()
        .item(&items.status_device)
        .item(&items.status_dynamic)
        .item(&items.status_scenario)
        .separator()
        .item(&items.choose_scenario)
        .item(&items.upload_scenario)
        .item(&items.clear_dynamic)
        .separator()
        .item(&items.settings)
        .item(&items.quit)
        .build()?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(TOOLTIP)
        // Left click restores the window; the menu stays on right click.
        // Linux shows the menu on any click (platform limitation); the menu
        // also contains the restore item, so the window stays reachable there.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                MENU_OPEN_MAIN | MENU_SETTINGS => show_main_window(app),
                // Explicit quit bypasses the frontend close-to-tray path. The
                // `RunEvent::Exit` handler in `lib.rs` stops the local API server
                // and performs the best-effort session release/LOCK, because the
                // platform event loop ends the process without running the
                // managed state destructor.
                MENU_QUIT => app.exit(0),
                _ => {
                    let Some(action) = TrayAction::from_menu_id(id) else {
                        return;
                    };
                    // Belt and braces: the click is re-checked against the current
                    // flags, so a stale or platform-forced activation of a
                    // disabled entry never reaches the window.
                    let Some(items) = app.try_state::<TrayMenuItems>() else {
                        return;
                    };
                    if !items.action_enabled(action) {
                        return;
                    }
                    emit_action(app, action);
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    // Reuse the window icon embedded from `bundle.icon` in `tauri.conf.json`
    // (the first PNG there). No extra asset or plugin dependency is added.
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;

    // The tray is a process-wide singleton created once in `setup`, so one
    // managed slot is enough; `manage` cannot fail here.
    app.manage(items);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    const LOCALES: [TrayLocale; 2] = [TrayLocale::En, TrayLocale::ZhCn];

    const ALL_MENU_IDS: [&str; MENU_ITEM_COUNT] = [
        MENU_OPEN_MAIN,
        MENU_STATUS_DEVICE,
        MENU_STATUS_DYNAMIC,
        MENU_STATUS_SCENARIO,
        MENU_CHOOSE_SCENARIO,
        MENU_UPLOAD_SCENARIO,
        MENU_CLEAR_DYNAMIC,
        MENU_SETTINGS,
        MENU_QUIT,
    ];

    /// One runtime-state input and its validated context.
    ///
    /// Kept as a helper so every test states the raw fields exactly as the
    /// frontend sends them.
    fn context_from_parts(
        device_connected: bool,
        dynamic_status: &str,
        current_scenario_name: Option<String>,
        device_alias: Option<String>,
        can_choose_scenario: bool,
        can_upload_scenario: bool,
        can_clear_dynamic: bool,
    ) -> Result<TrayRuntimeContext, TrayContextError> {
        TrayRuntimeStateInput {
            device_connected,
            dynamic_status: dynamic_status.to_string(),
            current_scenario_name,
            device_alias,
            can_choose_scenario,
            can_upload_scenario,
            can_clear_dynamic,
        }
        .to_context()
    }

    /// Contexts a menu can be rendered in: nothing connected, a connected but
    /// blocked workspace, and a fully usable connected workspace.
    fn contexts() -> Vec<TrayRuntimeContext> {
        vec![
            TrayRuntimeContext::default(),
            TrayRuntimeContext::new(
                true,
                TrayDynamicStatus::Discovering,
                None,
                None,
                false,
                false,
                false,
            )
            .expect("context"),
            TrayRuntimeContext::new(
                true,
                TrayDynamicStatus::Ready,
                Some("Work terminal".to_string()),
                Some("Work keyboard".to_string()),
                true,
                true,
                true,
            )
            .expect("context"),
        ]
    }

    fn label_for(rendered: &TrayRenderedLabels, id: &str) -> String {
        rendered
            .entries()
            .into_iter()
            .find(|(entry_id, _)| *entry_id == id)
            .map(|(_, label)| label.to_string())
            .unwrap_or_else(|| panic!("no label for menu id {id}"))
    }

    #[test]
    fn menu_item_ids_are_unique_and_namespaced() {
        assert!(ALL_MENU_IDS.iter().all(|id| id.starts_with("tray-")));
        assert_eq!(
            ALL_MENU_IDS.iter().collect::<HashSet<_>>().len(),
            MENU_ITEM_COUNT
        );

        // Every id belongs to exactly one group, and the groups cover the menu.
        let mut grouped: Vec<&str> = STATUS_MENU_IDS
            .iter()
            .chain(ACTION_MENU_IDS.iter())
            .chain(WINDOW_MENU_IDS.iter())
            .copied()
            .collect();
        grouped.sort_unstable();
        let mut all = ALL_MENU_IDS.to_vec();
        all.sort_unstable();
        assert_eq!(grouped, all);
        assert_eq!(
            grouped.iter().collect::<HashSet<_>>().len(),
            MENU_ITEM_COUNT
        );
    }

    #[test]
    fn only_the_two_exact_ui_locale_tags_are_accepted() {
        assert_eq!(TrayLocale::from_tag("en"), Some(TrayLocale::En));
        assert_eq!(TrayLocale::from_tag("zh-CN"), Some(TrayLocale::ZhCn));
        // Everything else is rejected instead of falling back to a default.
        for rejected in [
            "",
            " ",
            "EN",
            "En",
            "zh-cn",
            "ZH-CN",
            "zh",
            "zh-CN ",
            "zh-Hans-CN",
            "en-US",
            "en_US",
            "system",
            "english",
            "zh-CN;en",
            "de",
            "fr-FR",
        ] {
            assert_eq!(
                TrayLocale::from_tag(rejected),
                None,
                "{rejected:?} must not be accepted as a tray locale"
            );
        }
    }

    #[test]
    fn locale_tags_round_trip_and_default_to_english() {
        assert_eq!(TrayLocale::En.tag(), "en");
        assert_eq!(TrayLocale::ZhCn.tag(), "zh-CN");
        for locale in LOCALES {
            assert_eq!(TrayLocale::from_tag(locale.tag()), Some(locale));
        }
        assert_eq!(TrayLocale::DEFAULT, TrayLocale::En);
        // The initial menu text is the English set: the tray is created before
        // the frontend can report a resolved locale or any runtime state.
        assert_eq!(TrayLocale::DEFAULT.labels(), ENGLISH_LABELS);
        assert_eq!(ENGLISH_LABELS.locale(), TrayLocale::En);
        assert_eq!(CHINESE_LABELS.locale(), TrayLocale::ZhCn);
    }

    #[test]
    fn dynamic_status_tags_are_the_exact_service_status_values() {
        let tags: Vec<&str> = TrayDynamicStatus::ALL.iter().map(|s| s.tag()).collect();
        assert_eq!(
            tags,
            vec![
                "unknown",
                "discovering",
                "ready",
                "unsupported",
                "uploading",
                "committedLocally",
                "clearing",
                "clearedLocally",
                "error",
            ]
        );
        assert_eq!(tags.iter().collect::<HashSet<_>>().len(), tags.len());
        for status in TrayDynamicStatus::ALL {
            assert_eq!(TrayDynamicStatus::from_tag(status.tag()), Some(status));
        }
        // Near misses, other languages and protocol-style spellings are rejected
        // instead of being mapped onto a status.
        for rejected in [
            "",
            " ",
            "Ready",
            "READY",
            "unknown ",
            " unknown",
            "committed",
            "committedlocally",
            "committed_locally",
            "cleared",
            "cleared_locally",
            "ok",
            "idle",
            "none",
            "system",
            "error\n",
        ] {
            assert_eq!(
                TrayDynamicStatus::from_tag(rejected),
                None,
                "{rejected:?} must not be accepted as a tray status"
            );
        }
    }

    #[test]
    fn runtime_state_input_deserializes_the_camel_case_payload() {
        let input: TrayRuntimeStateInput = serde_json::from_value(json!({
            "deviceConnected": true,
            "dynamicStatus": "ready",
            "currentScenarioName": "Work terminal",
            "deviceAlias": "Work keyboard",
            "canChooseScenario": true,
            "canUploadScenario": false,
            "canClearDynamic": false,
        }))
        .expect("input");
        let context = input.to_context().expect("context");
        assert_eq!(context.device_alias(), Some("Work keyboard"));
        assert_eq!(context.current_scenario_name(), Some("Work terminal"));

        // The IPC contract is exact, not best-effort: snake_case keys, a missing
        // field and a non-object payload are all refused.
        for rejected in [
            json!({
                "device_connected": true,
                "dynamic_status": "ready",
                "current_scenario_name": null,
                "device_alias": null,
                "can_choose_scenario": true,
                "can_upload_scenario": true,
                "can_clear_dynamic": true,
            }),
            json!({ "deviceConnected": true, "dynamicStatus": "ready" }),
            json!([1, 2, 3]),
            json!("ready"),
            json!(null),
        ] {
            assert!(
                serde_json::from_value::<TrayRuntimeStateInput>(rejected).is_err(),
                "a malformed payload must be refused"
            );
        }

        // An unknown status tag inside a well-formed payload is a validation
        // error instead of a silent fallback.
        let unknown: TrayRuntimeStateInput = serde_json::from_value(json!({
            "deviceConnected": true,
            "dynamicStatus": "Ready",
            "currentScenarioName": null,
            "deviceAlias": null,
            "canChooseScenario": false,
            "canUploadScenario": false,
            "canClearDynamic": false,
        }))
        .expect("input");
        assert_eq!(
            unknown.to_context().unwrap_err(),
            TrayContextError::UnsupportedStatus
        );
    }

    #[test]
    fn context_rejects_unknown_status_and_unsafe_scenario_names() {
        let error = context_from_parts(true, "Ready", None, None, true, true, true).unwrap_err();
        assert_eq!(error, TrayContextError::UnsupportedStatus);
        assert_eq!(error.code(), "unsupported_tray_status");
        assert!(!error.message().contains("Ready"));

        // An empty, blank, over-long or control-character name is refused: a
        // rejected value never reaches a native menu label.
        for rejected in [
            "",
            "   ",
            "\n",
            "name\nwith-newline",
            "name\twith-tab",
            "control\u{7f}",
            "c1\u{9f}",
            "nul\u{0}",
        ] {
            let error = context_from_parts(
                true,
                "ready",
                Some(rejected.to_string()),
                None,
                true,
                true,
                true,
            )
            .unwrap_err();
            assert_eq!(error, TrayContextError::InvalidScenarioName, "{rejected:?}");
            assert_eq!(error.code(), "invalid_tray_scenario_name");
            // The sanitized message never echoes the rejected value and never
            // carries a control character itself.
            assert!(!error.message().contains("with-newline"));
            assert!(!error.message().chars().any(char::is_control));
        }

        assert_eq!(
            context_from_parts(
                true,
                "ready",
                Some("n".repeat(MAX_TRAY_SCENARIO_NAME_BYTES + 1)),
                None,
                true,
                true,
                true,
            )
            .unwrap_err(),
            TrayContextError::InvalidScenarioName
        );
        // The bound is the store bound in bytes, so a multi-byte name that fits
        // in characters but not in bytes is refused as well.
        let cjk = "场".repeat(MAX_TRAY_SCENARIO_NAME_BYTES / 3 + 1);
        assert!(cjk.chars().count() <= MAX_TRAY_SCENARIO_NAME_BYTES);
        assert_eq!(
            context_from_parts(true, "ready", Some(cjk), None, true, true, true).unwrap_err(),
            TrayContextError::InvalidScenarioName
        );

        // Accepted values are kept as-is, only trimmed and bounded.
        let context = context_from_parts(
            true,
            "committedLocally",
            Some("  Work terminal  ".to_string()),
            Some("  Work keyboard  ".to_string()),
            true,
            false,
            true,
        )
        .expect("context");
        assert_eq!(context.current_scenario_name(), Some("Work terminal"));
        assert_eq!(
            context.dynamic_status(),
            TrayDynamicStatus::CommittedLocally
        );
        assert!(context.device_connected());
        assert_eq!(context.device_alias(), Some("Work keyboard"));
        // None and an empty list of flags are always accepted.
        let idle =
            context_from_parts(false, "unknown", None, None, false, false, false).expect("context");
        assert_eq!(idle, TrayRuntimeContext::default());
    }

    #[test]
    fn context_validates_the_device_alias_and_drops_it_while_disconnected() {
        // A well-formed alias is trimmed and kept for the device row.
        let context = context_from_parts(
            true,
            "ready",
            None,
            Some("  Work keyboard  ".to_string()),
            false,
            false,
            false,
        )
        .expect("context");
        assert_eq!(context.device_alias(), Some("Work keyboard"));

        // An empty, over-long or control-character alias is refused with a stable
        // sanitized error, and the message never echoes the rejected value.
        for rejected in [
            "",
            "   ",
            "name\nwith-newline",
            "name\twith-tab",
            "control\u{7f}",
            "nul\u{0}",
        ] {
            let error = context_from_parts(
                true,
                "ready",
                None,
                Some(rejected.to_string()),
                false,
                false,
                false,
            )
            .unwrap_err();
            assert_eq!(error, TrayContextError::InvalidDeviceAlias, "{rejected:?}");
            assert_eq!(error.code(), "invalid_tray_alias");
            assert!(!error.message().contains("with-newline"));
            assert!(!error.message().chars().any(char::is_control));
        }
        for rejected in [
            "n".repeat(MAX_TRAY_DEVICE_ALIAS_BYTES + 1),
            // Multi-byte aliases are bounded in bytes, so this one fits in
            // characters but not in the alias bound.
            "场".repeat(MAX_TRAY_DEVICE_ALIAS_BYTES / 3 + 1),
        ] {
            assert_eq!(
                context_from_parts(true, "ready", None, Some(rejected), false, false, false)
                    .unwrap_err(),
                TrayContextError::InvalidDeviceAlias
            );
        }

        // A disconnected window never shows the previous device's alias, and a
        // bad alias is still refused instead of being dropped silently.
        let disconnected = context_from_parts(
            false,
            "unknown",
            None,
            Some("Work keyboard".to_string()),
            false,
            false,
            false,
        )
        .expect("context");
        assert_eq!(disconnected.device_alias(), None);
        assert_eq!(
            context_from_parts(
                false,
                "unknown",
                None,
                Some("bad\nalias".to_string()),
                false,
                false,
                false,
            )
            .unwrap_err(),
            TrayContextError::InvalidDeviceAlias
        );
    }

    #[test]
    fn device_alias_bound_matches_the_store_schema() {
        assert_eq!(
            MAX_TRAY_DEVICE_ALIAS_BYTES,
            crate::scenario_store::MAX_SCENARIO_NAME_BYTES
        );
    }

    #[test]
    fn scenario_name_bound_matches_the_store_schema() {
        assert_eq!(
            MAX_TRAY_SCENARIO_NAME_BYTES,
            crate::scenario_store::MAX_SCENARIO_NAME_BYTES
        );
    }

    #[test]
    fn actions_require_a_connected_device_and_a_clear_frontend_context() {
        // The frontend flags alone never enable a device action.
        let disconnected = TrayRuntimeContext::new(
            false,
            TrayDynamicStatus::Ready,
            Some("Work".to_string()),
            Some("Work keyboard".to_string()),
            true,
            true,
            true,
        )
        .expect("context");
        assert!(!disconnected.choose_scenario_enabled());
        assert!(!disconnected.upload_scenario_enabled());
        assert!(!disconnected.clear_dynamic_enabled());
        for id in ACTION_MENU_IDS {
            assert!(!menu_item_enabled(id, &disconnected), "{id}");
        }

        // A connected but blocked workspace disables the two device actions and
        // only offers the chooser.
        let blocked = TrayRuntimeContext::new(
            true,
            TrayDynamicStatus::Discovering,
            None,
            None,
            true,
            false,
            false,
        )
        .expect("context");
        assert!(blocked.choose_scenario_enabled());
        assert!(!blocked.upload_scenario_enabled());
        assert!(!blocked.clear_dynamic_enabled());

        // A ready workspace enables all three.
        let ready = TrayRuntimeContext::new(
            true,
            TrayDynamicStatus::Ready,
            Some("Work".to_string()),
            Some("Work keyboard".to_string()),
            true,
            true,
            true,
        )
        .expect("context");
        assert!(ready.choose_scenario_enabled());
        assert!(ready.upload_scenario_enabled());
        assert!(ready.clear_dynamic_enabled());
        for id in ACTION_MENU_IDS {
            assert!(menu_item_enabled(id, &ready), "{id}");
        }
    }

    #[test]
    fn status_rows_are_never_interactive_and_lifecycle_items_always_are() {
        for locale in LOCALES {
            for context in contexts() {
                let rendered = locale.labels().render(&context);
                for id in STATUS_MENU_IDS {
                    assert!(
                        !menu_item_enabled(id, &context),
                        "{id} must stay display-only ({locale:?})"
                    );
                }
                for id in WINDOW_MENU_IDS {
                    assert!(menu_item_enabled(id, &context), "{id}");
                }
                // Nothing outside the two known groups is ever interactive.
                for (id, _) in rendered.entries() {
                    if !ALL_MENU_IDS.contains(&id) {
                        assert!(!menu_item_enabled(id, &context), "{id}");
                    }
                }
                assert!(!menu_item_enabled("tray-unknown", &context));
            }
        }
    }

    #[test]
    fn disabled_context_keeps_only_the_window_lifecycle_items() {
        let context = TrayRuntimeContext::default();
        let enabled: Vec<&str> = ALL_MENU_IDS
            .into_iter()
            .filter(|id| menu_item_enabled(id, &context))
            .collect();
        assert_eq!(enabled, WINDOW_MENU_IDS.to_vec());
    }

    #[test]
    fn render_covers_the_whole_menu_in_both_locales_with_unique_text() {
        for locale in LOCALES {
            for context in contexts() {
                let rendered = locale.labels().render(&context);
                let entries = rendered.entries();
                assert_eq!(entries.len(), MENU_ITEM_COUNT);
                let ids: Vec<&str> = entries.iter().map(|(id, _)| *id).collect();
                assert_eq!(ids.iter().collect::<HashSet<_>>().len(), MENU_ITEM_COUNT);
                for id in ALL_MENU_IDS {
                    assert!(ids.contains(&id), "{id} missing from {locale:?} labels");
                }
                let texts: Vec<&str> = entries.iter().map(|(_, text)| *text).collect();
                assert!(texts.iter().all(|text| !text.is_empty()));
                // A duplicated label would make the menu ambiguous.
                assert_eq!(texts.iter().collect::<HashSet<_>>().len(), MENU_ITEM_COUNT);
            }
        }

        // Every entry is translated: an English label never equals its Chinese
        // counterpart in the same context.
        for context in contexts() {
            let en = TrayLocale::En.labels().render(&context);
            let zh = TrayLocale::ZhCn.labels().render(&context);
            for (id, _) in en.entries() {
                assert_ne!(
                    label_for(&en, id),
                    label_for(&zh, id),
                    "{id} is not translated"
                );
            }
        }
    }

    #[test]
    fn status_rows_follow_the_runtime_context() {
        let disconnected = TrayLocale::En
            .labels()
            .render(&TrayRuntimeContext::default());
        assert_eq!(
            label_for(&disconnected, MENU_STATUS_DEVICE),
            "Device: not connected"
        );
        assert_eq!(
            label_for(&disconnected, MENU_STATUS_DYNAMIC),
            "Dynamic status: Unknown"
        );
        assert_eq!(
            label_for(&disconnected, MENU_STATUS_SCENARIO),
            "Current scenario: none"
        );
        let zh_disconnected = TrayLocale::ZhCn
            .labels()
            .render(&TrayRuntimeContext::default());
        assert_eq!(
            label_for(&zh_disconnected, MENU_STATUS_SCENARIO),
            "当前场景：无"
        );

        let ready = TrayRuntimeContext::new(
            true,
            TrayDynamicStatus::CommittedLocally,
            Some("Work terminal".to_string()),
            Some("Work keyboard".to_string()),
            true,
            true,
            true,
        )
        .expect("context");
        let en = TrayLocale::En.labels().render(&ready);
        assert_eq!(label_for(&en, MENU_STATUS_DEVICE), "Device: Work keyboard");
        assert_eq!(
            label_for(&en, MENU_STATUS_DYNAMIC),
            "Dynamic status: Sent · local confirmation"
        );
        assert_eq!(
            label_for(&en, MENU_STATUS_SCENARIO),
            "Current scenario: Work terminal"
        );
        // A local acknowledgement never reads like a device readback.
        assert!(label_for(&en, MENU_STATUS_DYNAMIC).contains("local"));
        let zh = TrayLocale::ZhCn.labels().render(&ready);
        assert_eq!(label_for(&zh, MENU_STATUS_DEVICE), "设备：Work keyboard");
        assert_eq!(
            label_for(&zh, MENU_STATUS_DYNAMIC),
            "Dynamic 状态：已发送 · 本地确认"
        );
        assert_eq!(
            label_for(&zh, MENU_STATUS_SCENARIO),
            "当前场景：Work terminal"
        );
        assert!(label_for(&zh, MENU_STATUS_DYNAMIC).contains("本地"));

        // A connected device without an alias only says that it is connected: the
        // menu never invents a name and never falls back to a device identity.
        let unnamed =
            TrayRuntimeContext::new(true, TrayDynamicStatus::Ready, None, None, true, true, true)
                .expect("context");
        assert_eq!(
            label_for(
                &TrayLocale::En.labels().render(&unnamed),
                MENU_STATUS_DEVICE
            ),
            "Device: connected"
        );
        assert_eq!(
            label_for(
                &TrayLocale::ZhCn.labels().render(&unnamed),
                MENU_STATUS_DEVICE
            ),
            "设备：已连接"
        );

        // Every status has its own localized label, and it is always a real
        // status word rather than a placeholder.
        for status in TrayDynamicStatus::ALL {
            let labels = TrayRuntimeContext::new(true, status, None, None, false, false, false)
                .expect("context");
            for locale in LOCALES {
                let rendered = locale.labels().render(&labels);
                let text = label_for(&rendered, MENU_STATUS_DYNAMIC);
                let prefix = locale.labels().dynamic_prefix;
                assert!(text.starts_with(prefix), "{text}");
                assert_eq!(text.trim_end(), format!("{prefix}{}", status.label(locale)));
            }
        }
    }

    #[test]
    fn rendered_labels_never_claim_to_be_a_preview() {
        // Every row now carries real state or a real action, so the previous
        // "preview only" marker must be gone in both locales.
        for locale in LOCALES {
            for context in contexts() {
                let rendered = locale.labels().render(&context);
                for (id, text) in rendered.entries() {
                    let searched = text.to_lowercase();
                    assert!(!searched.contains("preview"), "{id} still says preview");
                    assert!(!text.contains("预览"), "{id} still says 预览");
                    assert!(!searched.contains("(preview)"), "{id}");
                }
            }
        }
    }

    #[test]
    fn action_payloads_are_exactly_the_three_camel_case_actions() {
        assert_eq!(TRAY_ACTION_EVENT, "tray-action");
        assert_eq!(TrayAction::ALL.len(), 3);
        let tags: Vec<&str> = TrayAction::ALL.iter().map(|action| action.tag()).collect();
        assert_eq!(
            tags,
            vec!["chooseScenario", "uploadScenario", "clearDynamic"]
        );
        assert_eq!(tags.iter().collect::<HashSet<_>>().len(), 3);

        for action in TrayAction::ALL {
            assert_eq!(TrayAction::from_tag(action.tag()), Some(action));
            assert_eq!(TrayAction::from_menu_id(action.menu_id()), Some(action));
            assert_eq!(
                serde_json::to_value(TrayActionPayload { action }).expect("payload"),
                json!({ "action": action.tag() })
            );
        }

        // The three action ids and the three action tags are one-to-one.
        let ids: Vec<&str> = TrayAction::ALL.iter().map(|a| a.menu_id()).collect();
        assert_eq!(ids, ACTION_MENU_IDS.to_vec());

        // Nothing else can be turned into an action, including the other menu
        // ids and near misses of the real tags.
        for rejected in [
            MENU_OPEN_MAIN,
            MENU_SETTINGS,
            MENU_QUIT,
            MENU_STATUS_DYNAMIC,
            "",
            "choose",
            "upload",
            "clear",
            "uploadScenario ",
            "uploadscenario",
            "clearDynamicObject",
            "chooseScenario\n",
        ] {
            assert_eq!(TrayAction::from_tag(rejected), None, "{rejected:?}");
            assert_eq!(TrayAction::from_menu_id(rejected), None, "{rejected:?}");
        }
    }

    #[test]
    fn payload_carries_no_text_identifier_or_device_information() {
        for action in TrayAction::ALL {
            let value = serde_json::to_value(TrayActionPayload { action }).expect("payload");
            let object = value.as_object().expect("object");
            assert_eq!(object.len(), 1);
            assert_eq!(object.keys().collect::<Vec<_>>(), vec!["action"]);
            assert_eq!(
                value["action"].as_str().map(TrayAction::from_tag),
                Some(Some(action))
            );
        }
    }
}
