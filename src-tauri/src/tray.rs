//! System tray foundation: tray icon, localized menu and main-window lifecycle
//! helpers.
//!
//! This implements the tray foundation stage of `docs/DYNAMIC-AUTOMATION-PLAN.md`
//! (§4.1 and §4.2). Only the window lifecycle is real here: restoring the main
//! window, hiding it to the tray instead of quitting, and an explicit quit item.
//!
//! The status rows and the Dynamic actions are presentation placeholders: there
//! is no `DynamicService` yet, so they are disabled and never open HID, never
//! send a protocol frame and never change macro or firmware state. Their labels
//! carry an explicit `preview only` / `预览` marker so a static placeholder can
//! never be presented as a real device or Dynamic result.
//!
//! Menu labels exist for the two UI locales (`en`, `zh-CN`). Which one is shown
//! is decided by the frontend's `resolveLocale` and applied through the
//! `set_tray_locale` command: this module never derives a language from the
//! environment, stored preferences or device data.

use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Wry,
};

/// Tray icon id. Stable so the tray can be looked up again once real state
/// updates (device, scenario, observed Dynamic state) are wired in.
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

    /// Every menu label of this locale.
    pub const fn labels(self) -> TrayLabels {
        TrayLabels::for_locale(self)
    }
}

/// Every label of the native tray menu for one locale.
///
/// The labels live here and not in the frontend message tables because the tray
/// menu is a native menu owned by Rust. Menu item ids stay the contract; only
/// the text follows the UI locale.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrayLabels {
    pub open_main: &'static str,
    pub status_device: &'static str,
    pub status_dynamic: &'static str,
    pub status_scenario: &'static str,
    pub choose_scenario: &'static str,
    pub upload_scenario: &'static str,
    pub clear_dynamic: &'static str,
    pub settings: &'static str,
    pub quit: &'static str,
}

/// English labels. Placeholder rows and Dynamic actions say `preview only`, so a
/// static row can never be read as real device or Dynamic state.
const ENGLISH_LABELS: TrayLabels = TrayLabels {
    open_main: "Open ZMK Runtime Macro",
    status_device: "Device: preview only",
    status_dynamic: "Dynamic status: preview only",
    status_scenario: "Current scenario: preview only",
    choose_scenario: "Choose scenario (preview)",
    upload_scenario: "Upload current scenario (preview)",
    clear_dynamic: "Clear Dynamic Object (preview)",
    settings: "Settings",
    quit: "Quit ZMK Runtime Macro",
};

/// Simplified Chinese labels. Every placeholder contains `预览`.
const CHINESE_LABELS: TrayLabels = TrayLabels {
    open_main: "打开 ZMK Runtime Macro",
    status_device: "设备：仅预览",
    status_dynamic: "Dynamic 状态：仅预览",
    status_scenario: "当前场景：仅预览",
    choose_scenario: "选择场景（预览）",
    upload_scenario: "上传当前场景（预览）",
    clear_dynamic: "清除 Dynamic Object（预览）",
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

    /// Pairs every stable menu item id with this locale's label, in menu order.
    pub const fn entries(self) -> [(&'static str, &'static str); MENU_ITEM_COUNT] {
        [
            (MENU_OPEN_MAIN, self.open_main),
            (MENU_STATUS_DEVICE, self.status_device),
            (MENU_STATUS_DYNAMIC, self.status_dynamic),
            (MENU_STATUS_SCENARIO, self.status_scenario),
            (MENU_CHOOSE_SCENARIO, self.choose_scenario),
            (MENU_UPLOAD_SCENARIO, self.upload_scenario),
            (MENU_CLEAR_DYNAMIC, self.clear_dynamic),
            (MENU_SETTINGS, self.settings),
            (MENU_QUIT, self.quit),
        ]
    }
}

/// Live handles to the tray menu items, kept so labels can be replaced in place
/// after [`init`] without rebuilding the menu.
///
/// Only text changes on a locale switch: ids, menu structure, enabled/disabled
/// state and menu event handling stay untouched.
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
}

impl TrayMenuItems {
    /// Creates every menu item with `labels` and keeps its handle. The disabled
    /// preview entries stay disabled here.
    fn build(app: &App, labels: TrayLabels) -> tauri::Result<Self> {
        Ok(Self {
            open_main: MenuItemBuilder::with_id(MENU_OPEN_MAIN, labels.open_main).build(app)?,
            status_device: MenuItemBuilder::with_id(MENU_STATUS_DEVICE, labels.status_device)
                .enabled(false)
                .build(app)?,
            status_dynamic: MenuItemBuilder::with_id(MENU_STATUS_DYNAMIC, labels.status_dynamic)
                .enabled(false)
                .build(app)?,
            status_scenario: MenuItemBuilder::with_id(MENU_STATUS_SCENARIO, labels.status_scenario)
                .enabled(false)
                .build(app)?,
            choose_scenario: MenuItemBuilder::with_id(MENU_CHOOSE_SCENARIO, labels.choose_scenario)
                .enabled(false)
                .build(app)?,
            upload_scenario: MenuItemBuilder::with_id(MENU_UPLOAD_SCENARIO, labels.upload_scenario)
                .enabled(false)
                .build(app)?,
            clear_dynamic: MenuItemBuilder::with_id(MENU_CLEAR_DYNAMIC, labels.clear_dynamic)
                .enabled(false)
                .build(app)?,
            settings: MenuItemBuilder::with_id(MENU_SETTINGS, labels.settings).build(app)?,
            quit: MenuItemBuilder::with_id(MENU_QUIT, labels.quit).build(app)?,
        })
    }

    /// Replaces the text of every existing menu item with `locale`'s labels.
    pub fn apply(&self, locale: TrayLocale) -> tauri::Result<()> {
        let labels = locale.labels();
        self.open_main.set_text(labels.open_main)?;
        self.status_device.set_text(labels.status_device)?;
        self.status_dynamic.set_text(labels.status_dynamic)?;
        self.status_scenario.set_text(labels.status_scenario)?;
        self.choose_scenario.set_text(labels.choose_scenario)?;
        self.upload_scenario.set_text(labels.upload_scenario)?;
        self.clear_dynamic.set_text(labels.clear_dynamic)?;
        self.settings.set_text(labels.settings)?;
        self.quit.set_text(labels.quit)?;
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

/// Creates the tray icon and its menu.
///
/// Must run inside the Tauri `setup` hook: tray and menu creation talk to the
/// platform UI and require a live application instance. The menu item handles
/// are managed afterwards so the `set_tray_locale` command can update their
/// labels.
pub fn init(app: &App) -> tauri::Result<()> {
    let items = TrayMenuItems::build(app, TrayLocale::DEFAULT.labels())?;

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
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN_MAIN | MENU_SETTINGS => show_main_window(app),
            // Explicit quit bypasses the frontend close-to-tray path. Dropping
            // the managed state still performs the best-effort LOCK on shutdown.
            MENU_QUIT => app.exit(0),
            // Disabled preview rows and Dynamic actions never emit menu events;
            // every other id is intentionally ignored.
            _ => {}
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
    use std::collections::HashSet;

    /// Marker every English placeholder label must contain, compared
    /// case-insensitively.
    const PREVIEW_MARKER_EN: &str = "preview";
    /// Marker every Simplified Chinese placeholder label must contain.
    const PREVIEW_MARKER_ZH_CN: &str = "预览";

    /// Entries without a real service behind them. They must say so in the
    /// label, because a static row can never stand in for real device or
    /// Dynamic state.
    const PREVIEW_IDS: [&str; 6] = [
        MENU_STATUS_DEVICE,
        MENU_STATUS_DYNAMIC,
        MENU_STATUS_SCENARIO,
        MENU_CHOOSE_SCENARIO,
        MENU_UPLOAD_SCENARIO,
        MENU_CLEAR_DYNAMIC,
    ];

    /// Enabled entries with real behavior (window lifecycle only).
    const ACTION_IDS: [&str; 3] = [MENU_OPEN_MAIN, MENU_SETTINGS, MENU_QUIT];

    const LOCALES: [TrayLocale; 2] = [TrayLocale::En, TrayLocale::ZhCn];

    fn label_for(labels: TrayLabels, id: &str) -> &'static str {
        labels
            .entries()
            .into_iter()
            .find(|(entry_id, _)| *entry_id == id)
            .map(|(_, label)| label)
            .unwrap_or_else(|| panic!("no label for menu id {id}"))
    }

    #[test]
    fn menu_item_ids_are_unique_and_namespaced() {
        let ids = [
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
        assert!(ids.iter().all(|id| id.starts_with("tray-")));
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), ids.len());
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
        // the frontend can report a resolved locale.
        assert_eq!(TrayLocale::DEFAULT.labels(), ENGLISH_LABELS);
    }

    #[test]
    fn every_label_table_covers_the_complete_menu() {
        for locale in LOCALES {
            let entries = locale.labels().entries();
            assert_eq!(entries.len(), MENU_ITEM_COUNT);
            let ids: Vec<&str> = entries.iter().map(|(id, _)| *id).collect();
            assert_eq!(ids.iter().collect::<HashSet<_>>().len(), MENU_ITEM_COUNT);
            for id in ACTION_IDS.iter().chain(PREVIEW_IDS.iter()) {
                assert!(ids.contains(id), "{id} is missing from {locale:?} labels");
            }
        }
    }

    #[test]
    fn every_locale_translates_every_label() {
        let english = TrayLocale::En.labels();
        let chinese = TrayLocale::ZhCn.labels();
        for (id, _) in english.entries() {
            let en = label_for(english, id);
            let zh = label_for(chinese, id);
            assert!(!en.is_empty(), "{id} has an empty English label");
            assert!(!zh.is_empty(), "{id} has an empty Chinese label");
            assert_ne!(en, zh, "{id} is not translated");
        }
        // No two entries may share the same text: a duplicated label would make
        // the menu ambiguous.
        for labels in [english, chinese] {
            let texts: Vec<&str> = labels
                .entries()
                .into_iter()
                .map(|(_, label)| label)
                .collect();
            assert_eq!(texts.iter().collect::<HashSet<_>>().len(), MENU_ITEM_COUNT);
        }
    }

    #[test]
    fn placeholder_entries_stay_marked_as_preview() {
        // No device state, observed Dynamic state or scenario store is wired to
        // the tray yet, so every placeholder must say so in both locales and
        // must never read like a real device or ACK result.
        for locale in LOCALES {
            let labels = locale.labels();
            let marker = match locale {
                TrayLocale::En => PREVIEW_MARKER_EN,
                TrayLocale::ZhCn => PREVIEW_MARKER_ZH_CN,
            };
            for id in PREVIEW_IDS {
                let label = label_for(labels, id);
                let searched = if locale == TrayLocale::En {
                    label.to_lowercase()
                } else {
                    label.to_string()
                };
                assert!(
                    searched.contains(marker),
                    "{label} is not marked as preview"
                );
                for forbidden in [
                    "ready",
                    "committedlocally",
                    "clearedlocally",
                    "就绪",
                    "已提交",
                    "已清除",
                    "已连接",
                ] {
                    assert!(!searched.contains(forbidden), "{label} claims {forbidden}");
                }
            }
        }
    }

    #[test]
    fn real_actions_never_claim_to_be_a_preview() {
        for locale in LOCALES {
            let labels = locale.labels();
            for id in ACTION_IDS {
                let label = label_for(labels, id);
                assert!(
                    !label.to_lowercase().contains(PREVIEW_MARKER_EN),
                    "{label} is a real action and must not say preview"
                );
                assert!(!label.contains(PREVIEW_MARKER_ZH_CN));
            }
        }
    }
}
