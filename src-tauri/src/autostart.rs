//! Login autostart through the official Tauri autostart plugin.
//!
//! The plugin owns the platform entry (a Linux autostart `.desktop` entry, a
//! macOS launch agent, a Windows registry value) and exposes exactly three
//! commands — `enable`, `disable`, `is_enabled` — behind the `autostart:default`
//! capability. This app never writes that entry on its own: nothing here enables
//! autostart, and the only caller of the plugin is the explicit toggle in the
//! settings modal.
//!
//! What this module adds is the two decisions the app has to make itself:
//!
//! 1. The exact startup flag the login entry passes ([`AUTOSTART_ARG`]). It only
//!    tells the app to start in the tray: it carries no password, no macro text
//!    and no device identifier, because the login entry is written to a file or a
//!    registry value on the user's machine.
//! 2. The launch semantics. The main window is created hidden
//!    (`src-tauri/tauri.conf.json`) so an autostart launch cannot flash it, every
//!    other launch shows it, and a second autostart launch never raises an
//!    already running instance.
//!
//! An autostart launch changes nothing else: it does not connect to a device, it
//! does not send `AUTH_INFO`, it runs no capability discovery and it reads or
//! writes no Dynamic object. `DynamicService` therefore starts in `unknown`, and
//! the app stays idle in the tray until the user acts.

use tauri::{plugin::TauriPlugin, Runtime};

/// Exact command-line flag the login-autostart entry passes to the app.
///
/// Only this exact argument counts as an autostart launch, so a near miss such
/// as `--autostart-extra`, `--autostart=1` or `--AUTOSTART` stays an ordinary
/// launch and can never silently suppress the main window.
pub const AUTOSTART_ARG: &str = "--autostart";

/// Whether one argument list is a login-autostart launch.
///
/// Used for the first launch and for a second launch that reaches the
/// single-instance callback, so both decide from the same rule.
pub fn is_autostart_launch<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == AUTOSTART_ARG)
}

/// The official autostart plugin, registered with the fixed startup flag.
///
/// The plugin name stays `autostart`, which is what the `autostart:default`
/// capability and the frontend's `plugin:autostart|…` calls are pinned to.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_autostart::Builder::new()
        .args([AUTOSTART_ARG])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// The reviewed configuration, read at compile time so an edit to it has to
    /// keep the invariants below.
    const TAURI_CONF: &str = include_str!("../tauri.conf.json");
    const CAPABILITIES: &str = include_str!("../capabilities/default.json");

    fn tauri_conf() -> Value {
        serde_json::from_str(TAURI_CONF).expect("tauri.conf.json is valid JSON")
    }

    fn capabilities() -> Value {
        serde_json::from_str(CAPABILITIES).expect("capabilities/default.json is valid JSON")
    }

    fn capability_permissions() -> Vec<String> {
        capabilities()["permissions"]
            .as_array()
            .expect("a permission list")
            .iter()
            .map(|permission| {
                permission
                    .as_str()
                    .expect("a permission string")
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn only_the_exact_autostart_flag_counts() {
        assert_eq!(AUTOSTART_ARG, "--autostart");
        // The login entry, and the same entry seen again by a second instance.
        assert!(is_autostart_launch([AUTOSTART_ARG]));
        assert!(is_autostart_launch(["app", AUTOSTART_ARG]));
        assert!(is_autostart_launch(
            ["app", "--other", AUTOSTART_ARG]
                .into_iter()
                .map(String::from)
        ));

        // Anything else is an ordinary launch: no near miss may hide the window.
        assert!(!is_autostart_launch(std::iter::empty::<&str>()));
        assert!(!is_autostart_launch(["app"]));
        for near_miss in [
            "--autostart=1",
            "--autostart=true",
            "autostart",
            "--autostart-extra",
            "--AUTOSTART",
            "Autostart",
            "--autostart ",
            " --autostart",
        ] {
            assert!(
                !is_autostart_launch(["app", near_miss]),
                "{near_miss:?} must not count as an autostart launch"
            );
        }
    }

    #[test]
    fn the_startup_flag_is_a_single_bare_switch() {
        // One bare switch is the whole payload, so the login entry can never
        // carry a password, macro text, a serial number or a HID path.
        assert!(AUTOSTART_ARG.starts_with("--"));
        assert_eq!(AUTOSTART_ARG.split_whitespace().count(), 1);
        assert!(!AUTOSTART_ARG.contains('='));
        assert!(AUTOSTART_ARG
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-'));
    }

    #[test]
    fn the_main_window_is_created_hidden() {
        // The window has to start hidden: a config-declared visible window is
        // already on screen before `setup` could hide it, which is exactly the
        // flash an autostart launch must not produce. `setup` shows it again for
        // every ordinary launch.
        let conf = tauri_conf();
        let window = conf["app"]["windows"]
            .as_array()
            .and_then(|windows| windows.first())
            .expect("the main window is declared in the config");
        assert_eq!(
            window["visible"],
            Value::Bool(false),
            "the main window must be created hidden"
        );
        // The tray is the only entry point while the window is hidden, and it is
        // created in `setup` together with the window decision.
        assert_eq!(
            conf["productName"],
            Value::String("zmk-runtime-macro-desktop".into())
        );
    }

    #[test]
    fn the_capability_grants_only_the_autostart_commands() {
        let permissions = capability_permissions();
        assert!(
            permissions
                .iter()
                .any(|permission| permission == "autostart:default"),
            "the autostart plugin needs its permission set"
        );
        // `autostart:default` is exactly enable/disable/is_enabled: no second
        // autostart permission and no non-core plugin permission is granted.
        assert_eq!(
            permissions
                .iter()
                .filter(|permission| permission.starts_with("autostart:"))
                .count(),
            1
        );
        for permission in &permissions {
            assert!(
                permission.starts_with("core:") || permission == "autostart:default",
                "{permission} widens the capability surface beyond core plus autostart"
            );
        }
        // The window still needs the permissions the tray lifecycle relies on.
        for required in [
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "core:window:allow-hide",
        ] {
            assert!(permissions.iter().any(|permission| permission == required));
        }
        // The browser preview must keep working: no new window is targeted.
        let windows = capabilities()["windows"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0], Value::String("main".into()));
    }

    #[test]
    fn the_bundle_targets_the_three_desktop_platforms() {
        // The plugin supports Linux, Windows and macOS only; the bundle list must
        // not promise an installer for a platform the plugin cannot serve.
        let conf = tauri_conf();
        let targets: Vec<&str> = conf["bundle"]["targets"]
            .as_array()
            .expect("a bundle target list")
            .iter()
            .map(|target| target.as_str().expect("a target string"))
            .collect();
        for target in ["appimage", "deb", "dmg", "nsis"] {
            assert!(targets.contains(&target), "{target} is no longer bundled");
        }
    }
}
