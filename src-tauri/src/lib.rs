pub mod auth;
pub mod autostart;
pub mod client;
pub mod commands;
pub mod dynamic_service;
pub mod error;
pub mod hid;
pub mod protocol;
pub mod scenario_store;
pub mod tray;

use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch restores the existing window instead of starting a
        // second instance, including when the window is hidden in the tray.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A login-autostart launch must not raise the window either: logging
            // in starts the app in the tray even when one instance already runs.
            if autostart::is_autostart_launch(argv) {
                return;
            }
            tray::show_main_window(app);
        }))
        // Official autostart plugin: it owns the platform login entry, and this
        // app only reads or changes it on an explicit user action in Settings.
        .plugin(autostart::plugin())
        .manage(Arc::new(Mutex::new(commands::AppState::default())))
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::connect_device,
            commands::disconnect_device,
            commands::get_connection,
            commands::refresh_auth_state,
            commands::authenticate,
            commands::set_password,
            commands::lock_device,
            commands::list_slots,
            commands::get_slot,
            commands::set_slot,
            commands::clear_slot,
            commands::get_dynamic_capabilities,
            commands::get_dynamic_state,
            commands::upload_dynamic,
            commands::clear_dynamic,
            commands::get_settings,
            commands::set_settings,
            commands::set_tray_locale,
            commands::set_tray_runtime_state,
            scenario_store::load_scenarios,
            scenario_store::save_scenarios,
        ])
        .setup(|app| {
            tray::init(app)?;
            // The main window is created hidden so a login-autostart launch
            // cannot flash it. An autostart launch stays in the tray; every other
            // launch shows and focuses the window immediately. Neither path
            // connects to a device, runs a capability discovery or touches a
            // Dynamic object, so `DynamicService` still starts in `unknown`.
            if !autostart::is_autostart_launch(std::env::args()) {
                tray::show_main_window(app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
