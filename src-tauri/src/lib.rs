//! Minimal native boundary: SQLite, TLS networking, files, notifications and desktop integrations.

#[cfg(target_os = "android")]
mod android_updates;
mod capture;
mod paths;
#[cfg(target_os = "windows")]
mod startup;
mod storage;
pub mod updates;
use tauri::Manager;

/// Initialize supported plugins and run the desktop or Android application event loop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            capture::capture_knowledge,
            updates::update_identity,
            updates::install_platform_update,
            paths::storage_configuration,
            storage::prepare_storage,
            storage::recover_storage,
            storage::journal_storage,
            storage::read_storage_journal,
            storage::checkpoint_storage
        ])
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(android_updates::init());
    let mut context = tauri::generate_context!();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }
    builder
        .setup(|app| {
            let location = paths::initialize(app.handle())?;
            #[cfg(target_os = "windows")]
            startup::install_diagnostics(&location.root);
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            let webview_data = location.root.join("webview");
            app.manage(location);
            for config in &app.config().app.windows {
                let window = tauri::WebviewWindowBuilder::from_config(app, config)?;
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                let window = window.data_directory(webview_data.clone());
                #[cfg(target_os = "windows")]
                let window = match startup::automation_arguments() {
                    Some(arguments) => window.additional_browser_args(&arguments),
                    None => window,
                };
                window.build()?;
            }
            Ok(())
        })
        .run(context)
        .expect("ZhiNexus native runtime failed to start");
}
