pub mod auth;
pub mod client;
pub mod commands;
pub mod error;
pub mod hid;
pub mod protocol;
pub mod tray;

use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch restores the existing window instead of starting a
        // second instance, including when the window is hidden in the tray.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::show_main_window(app);
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
            commands::get_dynamic_capabilities,
            commands::upload_dynamic,
            commands::clear_dynamic,
            commands::get_settings,
            commands::set_settings,
        ])
        .setup(|app| {
            tray::init(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
