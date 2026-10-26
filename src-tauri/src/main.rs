//! Desktop binary entry point; the shared library is also used by Android.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Start the shared ZhiNexus application runtime.
fn main() {
    zhinexus_lib::run();
}
