//! Minimal native boundary: SQLite, TLS networking, files, notifications and desktop integrations.

#[cfg(target_os = "android")]
mod android_updates;
mod capture;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop;
#[cfg(any(target_os = "windows", test))]
mod executable_update;
mod github_release;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod mcp;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod migration;
mod network;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod ocr;
mod paths;
#[cfg(target_os = "windows")]
mod startup;
mod storage;
mod storage_cleanup;
pub mod updates;
use tauri::Manager;

/// Initialize supported plugins and run the desktop or Android application event loop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(updates::UpdateState::default());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .manage(desktop::DesktopState::default())
        .manage(mcp::Sessions::default())
        .manage(ocr::CaptureState::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if !args.iter().any(|arg| arg == "--background") {
                desktop::show(app);
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, key, event| desktop::shortcut(app, key, event.state))
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        capture::capture_knowledge,
        network::configure_network,
        updates::update_identity,
        updates::read_update_manifest,
        updates::install_platform_update,
        updates::prepare_platform_update,
        paths::storage_configuration,
        storage::prepare_storage,
        storage::recover_storage,
        storage::journal_storage,
        storage::read_storage_journal,
        storage::repair_storage_journal,
        storage_cleanup::cleanup_storage,
        storage::checkpoint_storage,
        desktop::desktop_configuration,
        desktop::configure_desktop,
        desktop::begin_shortcut_capture,
        desktop::end_shortcut_capture,
        desktop::take_desktop_actions,
        desktop::quit_desktop,
        migration::storage_migration_plan,
        migration::launch_storage_migration,
        ocr::begin_ocr_capture,
        ocr::ocr_frame,
        ocr::finish_ocr_capture,
        ocr::cancel_ocr_capture,
        ocr::recognize_ocr,
        mcp::mcp_start,
        mcp::mcp_send,
        mcp::mcp_next,
        mcp::mcp_close
    ]);
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        capture::capture_knowledge,
        network::configure_network,
        updates::update_identity,
        updates::read_update_manifest,
        updates::install_platform_update,
        updates::prepare_platform_update,
        paths::storage_configuration,
        storage::prepare_storage,
        storage::recover_storage,
        storage::journal_storage,
        storage::read_storage_journal,
        storage::repair_storage_journal,
        storage_cleanup::cleanup_storage,
        storage::checkpoint_storage
    ]);
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
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            desktop::initialize(app.handle())?;
            Ok(())
        })
        .build(context)
        .expect("ZhiNexus native runtime failed to start")
        .run(|_app, event| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if matches!(event, tauri::RunEvent::Exit) {
                mcp::shutdown(_app);
            }
            #[cfg(any(target_os = "android", target_os = "ios"))]
            let _ = event;
        });
}
