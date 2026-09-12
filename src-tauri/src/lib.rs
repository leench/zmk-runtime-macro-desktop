pub mod api;
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

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The window state and the local device alias map are created before the
    // builder so the loopback API can be handed the same instances the Tauri
    // commands use: one application state, one alias map, no second writer.
    let state: Arc<Mutex<commands::AppState>> = Arc::new(Mutex::new(commands::AppState::default()));
    let device_aliases: Arc<Mutex<api::DeviceAliasRegistry>> =
        Arc::new(Mutex::new(api::DeviceAliasRegistry::default()));
    let api_state = Arc::clone(&state);
    let api_aliases = Arc::clone(&device_aliases);

    let app = tauri::Builder::default()
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
        .manage(state)
        .manage(device_aliases)
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::connect_device,
            commands::disconnect_device,
            commands::prepare_tray_close,
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
            commands::set_device_aliases,
            scenario_store::load_scenarios,
            scenario_store::save_scenarios,
        ])
        .setup(move |app| {
            tray::init(app)?;
            // The local automation API starts with the application, including a
            // tray-only autostart launch. It stays optional: a busy port or an
            // unavailable listener leaves the desktop app fully usable, and the
            // failure is never logged with operating-system text. It reports a
            // completed write to the window through a payload-free event. The
            // returned handle is the explicit stop the exit path below uses.
            app.manage(api::start(app.handle().clone(), api_state, api_aliases));
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
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            // Stop the acceptor first: while it runs it holds a reference to the
            // shared application state, and an explicit stop releases the
            // listener and that reference instead of leaving them to the process
            // teardown.
            if let Some(server) = app.try_state::<api::ApiServer>() {
                server.shutdown();
            }
            // The platform event loop ends with `std::process::exit`, so the
            // managed state destructor does not run on the quit path: release the
            // session explicitly, through the same single HID worker and the same
            // best-effort LOCK an explicit disconnect uses.
            if let Some(state) = app.try_state::<Arc<Mutex<commands::AppState>>>() {
                commands::release_session_on_exit(Arc::clone(state.inner()));
            }
        }
    });
}
