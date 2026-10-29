//! Generate Tauri platform bindings and capability checks at compile time.
fn main() {
    println!("cargo:rerun-if-env-changed=ZHINEXUS_GITHUB_UPDATE_TOKEN");
    tauri_build::build()
}
