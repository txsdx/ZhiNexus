//! Preserve native startup failures in the selected Windows data root when a GUI executable has no console.
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
