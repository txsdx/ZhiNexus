//! Desktop binary entry point; the shared library is also used by Android.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Start the shared ZhiNexus application runtime.
fn main() {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    match zhinexus_lib::migration::finish_storage_migration() {
        Ok(true) => return,
        Err(error) => {
            eprintln!("Data migration: {error}");
            return;
        }
        Ok(false) => {}
    }
    #[cfg(target_os = "windows")]
    match zhinexus_lib::updates::finish_portable_update() {
        Ok(true) => return,
        Err(error) => {
            eprintln!("Portable update failed: {error}");
            return;
        }
        Ok(false) => {}
    }
    zhinexus_lib::run();
}
