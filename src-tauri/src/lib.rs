pub mod auth;
pub mod client;
pub mod commands;
pub mod error;
pub mod hid;
pub mod protocol;

use std::sync::{Arc, Mutex};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
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
            commands::get_settings,
            commands::set_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
