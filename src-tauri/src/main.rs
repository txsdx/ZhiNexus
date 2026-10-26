//! Desktop binary entry point; the shared library is also used by Android.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Start the shared ZhiNexus application runtime.
fn main() {
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
