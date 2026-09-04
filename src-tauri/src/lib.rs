pub mod client;
pub mod commands;
pub mod error;
pub mod hid;
pub mod protocol;

use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(commands::AppState::default())))
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::connect_device,
            commands::disconnect_device,
            commands::get_connection,
            commands::list_slots,
            commands::get_slot,
            commands::set_slot,
            commands::clear_slot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
