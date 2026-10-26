//! Register the small Android installer bridge; verification and download remain in the shared native update service.
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Wry,
};
/// Handle to the application-owned Android plugin registered from the generated project source.
pub struct ApkInstaller(pub PluginHandle<Wry>);
/// Initialize the Android implementation without adding a desktop command surface.
pub fn init() -> TauriPlugin<Wry> {
    Builder::new("zhinexus-updates")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin("io.github.txsdx.zhinexus.updates", "UpdateInstaller")?;
            app.manage(ApkInstaller(handle));
            Ok(())
        })
        .build()
}
