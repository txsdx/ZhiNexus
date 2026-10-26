//! Windows startup diagnostics and explicitly enabled loopback automation for testing the unmodified data-root rules.
use std::{fs, io::Write, path::Path, time::SystemTime};

/// Keep the normal panic reporter and append diagnostics locally; never upload them through synchronization.
pub fn install_diagnostics(root: &Path) {
    let recovery = root.join("recovery");
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if fs::create_dir_all(&recovery).is_ok() {
            if let Ok(mut file) = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(recovery.join("native-startup.log"))
            {
                let _ = writeln!(
                    file,
                    "{:?}: {info}\n{}",
                    SystemTime::now(),
                    std::backtrace::Backtrace::force_capture()
                );
                let _ = file.sync_all();
            }
        }
        previous(info);
    }));
}

/// WebView2 can ignore inherited environment arguments; enable a validated loopback port through Tauri's documented builder API.
pub fn automation_arguments() -> Option<String> {
    if std::env::var("TAURI_WEBVIEW_AUTOMATION").ok().as_deref() != Some("true") {
        return None;
    }
    let port = std::env::var("ZHINEXUS_TEST_DEBUG_PORT")
        .ok()?
        .parse::<u16>()
        .ok()?;
    if port < 1024 {
        return None;
    }
    Some(format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-address=127.0.0.1 --remote-debugging-port={port}"))
}
