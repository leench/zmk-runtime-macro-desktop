//! System tray foundation: tray icon, menu and main-window lifecycle helpers.
//!
//! This implements the tray foundation stage of `docs/DYNAMIC-AUTOMATION-PLAN.md`
//! (§4.1 and §4.2). Only the window lifecycle is real here: restoring the main
//! window, hiding it to the tray instead of quitting, and an explicit quit item.
//!
//! The status rows and the Dynamic actions are presentation placeholders: there
//! is no `DynamicService` yet, so they are disabled and never open HID, never
//! send a protocol frame and never change macro or firmware state. Their labels
//! carry an explicit `preview only` marker so a static placeholder can never be
//! presented as a real device or Dynamic result.

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
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

// Native menu labels are English-only for now and are not part of the UI locale
// files. Action items that still only have a presentation placeholder say so in
// the label itself.
const LABEL_OPEN_MAIN: &str = "Open ZMK Runtime Macro";
const LABEL_STATUS_DEVICE: &str = "Device: preview only";
const LABEL_STATUS_DYNAMIC: &str = "Dynamic status: preview only";
const LABEL_STATUS_SCENARIO: &str = "Current scenario: preview only";
const LABEL_CHOOSE_SCENARIO: &str = "Choose scenario (preview)";
const LABEL_UPLOAD_SCENARIO: &str = "Upload current scenario (preview)";
const LABEL_CLEAR_DYNAMIC: &str = "Clear Dynamic Object (preview)";
const LABEL_SETTINGS: &str = "Settings";
const LABEL_QUIT: &str = "Quit ZMK Runtime Macro";
const TOOLTIP: &str = "ZMK Runtime Macro";

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
/// platform UI and require a live application instance.
pub fn init(app: &App) -> tauri::Result<()> {
    let open_main = MenuItemBuilder::with_id(MENU_OPEN_MAIN, LABEL_OPEN_MAIN).build(app)?;
    let status_device = MenuItemBuilder::with_id(MENU_STATUS_DEVICE, LABEL_STATUS_DEVICE)
        .enabled(false)
        .build(app)?;
    let status_dynamic = MenuItemBuilder::with_id(MENU_STATUS_DYNAMIC, LABEL_STATUS_DYNAMIC)
        .enabled(false)
        .build(app)?;
    let status_scenario = MenuItemBuilder::with_id(MENU_STATUS_SCENARIO, LABEL_STATUS_SCENARIO)
        .enabled(false)
        .build(app)?;
    let choose_scenario = MenuItemBuilder::with_id(MENU_CHOOSE_SCENARIO, LABEL_CHOOSE_SCENARIO)
        .enabled(false)
        .build(app)?;
    let upload_scenario = MenuItemBuilder::with_id(MENU_UPLOAD_SCENARIO, LABEL_UPLOAD_SCENARIO)
        .enabled(false)
        .build(app)?;
    let clear_dynamic = MenuItemBuilder::with_id(MENU_CLEAR_DYNAMIC, LABEL_CLEAR_DYNAMIC)
        .enabled(false)
        .build(app)?;
    let settings = MenuItemBuilder::with_id(MENU_SETTINGS, LABEL_SETTINGS).build(app)?;
    let quit = MenuItemBuilder::with_id(MENU_QUIT, LABEL_QUIT).build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open_main)
        .separator()
        .item(&status_device)
        .item(&status_dynamic)
        .item(&status_scenario)
        .separator()
        .item(&choose_scenario)
        .item(&upload_scenario)
        .item(&clear_dynamic)
        .separator()
        .item(&settings)
        .item(&quit)
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

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
    fn placeholder_entries_stay_marked_as_preview() {
        // No device state, observed Dynamic state or scenario store is wired to
        // the tray yet, so every placeholder must say so and must never read
        // like a real device or ACK result.
        let placeholders = [
            LABEL_STATUS_DEVICE,
            LABEL_STATUS_DYNAMIC,
            LABEL_STATUS_SCENARIO,
            LABEL_CHOOSE_SCENARIO,
            LABEL_UPLOAD_SCENARIO,
            LABEL_CLEAR_DYNAMIC,
        ];
        for label in placeholders {
            let lowercase = label.to_lowercase();
            assert!(
                lowercase.contains("preview"),
                "{label} is not marked as preview"
            );
            for forbidden in ["ready", "committedlocally", "clearedlocally"] {
                assert!(!lowercase.contains(forbidden), "{label} claims {forbidden}");
            }
        }
    }
}
