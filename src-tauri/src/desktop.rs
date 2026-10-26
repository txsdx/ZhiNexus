//! Desktop lifecycle, owned global shortcuts, tray navigation and OS startup integration.
use std::{
    collections::{HashSet, VecDeque},
    fs,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
/// Preferences are per device and follow its selected storage root.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub background: bool,
    pub autostart: bool,
    pub capture_shortcut: String,
    pub ocr_shortcut: String,
    pub show_shortcut: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            background: true,
            autostart: false,
            capture_shortcut: "CommandOrControl+Shift+N".into(),
            ocr_shortcut: "CommandOrControl+Shift+O".into(),
            show_shortcut: "CommandOrControl+Shift+Space".into(),
        }
    }
}
/// Native callbacks queue capture results until the main webview has mounted its listener.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub kind: String,
    pub text: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}
/// State owns only this application's registrations and a bounded pending-action queue.
#[derive(Default)]
pub struct DesktopState {
    settings: Mutex<Preferences>,
    pending: Mutex<VecDeque<Action>>,
    capture_lease: Mutex<Option<String>>,
    exiting: AtomicBool,
    warning: Mutex<String>,
}
/// Bring the main window back without destroying its editor or agent context.
pub fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
/// Queue user-requested work before raising the window, so early startup cannot drop a capture.
pub fn push(app: &tauri::AppHandle, action: Action) {
    if let Ok(mut pending) = app.state::<DesktopState>().pending.lock() {
        if pending.len() >= 16 {
            pending.pop_front();
        }
        pending.push_back(action);
    }
    let _ = app.emit_to("main", "desktop:pending", ());
}
/// Bypass close-to-tray for verified update/migration helpers or explicit user exit.
pub fn mark_exiting(app: &tauri::AppHandle) {
    app.state::<DesktopState>()
        .exiting
        .store(true, Ordering::SeqCst);
}
/// Interpret shortcut events on the native side, so hidden windows remain responsive.
pub fn shortcut(app: &tauri::AppHandle, shortcut: &Shortcut, state: ShortcutState) {
    if app
        .state::<DesktopState>()
        .capture_lease
        .lock()
        .map_or(true, |v| v.is_some())
        || state != ShortcutState::Pressed
    {
        return;
    }
    let settings = match app.state::<DesktopState>().settings.lock() {
        Ok(v) => v.clone(),
        Err(_) => return,
    };
    let matches = |key: &str| Shortcut::from_str(key).is_ok_and(|s| s.id() == shortcut.id());
    if matches(&settings.show_shortcut) {
        show(app);
    } else if matches(&settings.ocr_shortcut) {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = crate::ocr::begin(handle.clone()).await {
                push(
                    &handle,
                    Action {
                        kind: "error".into(),
                        text: error,
                        source: String::new(),
                        image: None,
                    },
                );
                show(&handle);
            }
        });
    } else if matches(&settings.capture_shortcut) {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let captured = crate::capture::capture_knowledge().await;
            let (text, source) = captured.map(|c| (c.text, c.source)).unwrap_or_default();
            push(
                &handle,
                Action {
                    kind: "capture".into(),
                    text,
                    source,
                    image: None,
                },
            );
            show(&handle);
        });
    }
}
/// Drain results atomically; events are wakeups, while this queue carries the durable-in-process payload.
#[tauri::command]
pub fn take_desktop_actions(app: tauri::AppHandle) -> Vec<Action> {
    app.state::<DesktopState>()
        .pending
        .lock()
        .map(|mut q| q.drain(..).collect())
        .unwrap_or_default()
}
/// Expose native preferences and nonfatal registration diagnostics.
#[tauri::command]
pub fn desktop_configuration(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<DesktopState>();
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Desktop settings unavailable")?
        .clone();
    let warning = state
        .warning
        .lock()
        .map_err(|_| "Desktop diagnostics unavailable")?
        .clone();
    Ok(serde_json::json!({"settings":settings,"warning":warning}))
}
/// Validate syntax and uniqueness before changing any OS registration.
fn keys(settings: &Preferences) -> Result<Vec<Shortcut>, String> {
    let mut seen = HashSet::new();
    let mut keys = Vec::new();
    for text in [
        &settings.capture_shortcut,
        &settings.ocr_shortcut,
        &settings.show_shortcut,
    ] {
        if text.trim().is_empty() {
            continue;
        }
        let key = Shortcut::from_str(text).map_err(|_| "快捷键格式无效 / Invalid shortcut")?;
        if !seen.insert(key.id()) {
            return Err("快捷键不可重复 / Shortcuts must be distinct".into());
        }
        keys.push(key);
    }
    Ok(keys)
}
/// Apply registrations transactionally: register new keys first, roll back on conflict, then release old owned keys.
#[tauri::command]
pub fn configure_desktop(app: tauri::AppHandle, settings: Preferences) -> Result<(), String> {
    if app
        .state::<DesktopState>()
        .capture_lease
        .lock()
        .map_err(|_| "Shortcut state unavailable")?
        .is_some()
    {
        return Err("正在录制快捷键 / Shortcut capture active".into());
    }
    let requested = keys(&settings)?;
    let state = app.state::<DesktopState>();
    let previous = state
        .settings
        .lock()
        .map_err(|_| "Desktop settings unavailable")?
        .clone();
    let old = keys(&previous)?;
    let active: HashSet<_> = old
        .iter()
        .filter(|key| app.global_shortcut().is_registered(**key))
        .map(|key| key.id())
        .collect();
    let mut added = Vec::new();
    for key in &requested {
        if !active.contains(&key.id()) {
            if app.global_shortcut().register(*key).is_err() {
                for key in added {
                    let _ = app.global_shortcut().unregister(key);
                }
                return Err("快捷键被占用，请修改后重试 / Shortcut is already in use".into());
            }
            added.push(*key);
        }
    }
    let root = app.state::<crate::paths::StorageLocation>().root.clone();
    let save = (|| {
        startup(settings.autostart)?;
        let pending = root.join(".desktop-settings.json");
        fs::write(
            &pending,
            serde_json::to_vec(&settings).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(pending, root.join("desktop.json")).map_err(|e| e.to_string())
    })();
    if let Err(error) = save {
        for key in added {
            let _ = app.global_shortcut().unregister(key);
        }
        let _ = startup(previous.autostart);
        return Err(error);
    }
    let wanted: HashSet<_> = requested.iter().map(|key| key.id()).collect();
    for key in old {
        if !wanted.contains(&key.id()) && active.contains(&key.id()) {
            let _ = app.global_shortcut().unregister(key);
        }
    }
    *state
        .settings
        .lock()
        .map_err(|_| "Desktop settings unavailable")? = settings;
    *state
        .warning
        .lock()
        .map_err(|_| "Desktop diagnostics unavailable")? = String::new();
    Ok(())
}
/// Quit only after frontend unsaved-edit checks and storage queue drainage.
#[tauri::command]
pub fn quit_desktop(app: tauri::AppHandle) {
    mark_exiting(&app);
    app.exit(0);
}
/// Fit the initial physical bounds to the current monitor; WebView already applies the OS scale to CSS pixels.
fn fit_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let (Ok(Some(monitor)), Ok(size)) = (window.current_monitor(), window.outer_size()) {
            let area = monitor.work_area();
            let width = size.width.min(area.size.width.saturating_sub(32));
            let height = size.height.min(area.size.height.saturating_sub(32));
            if width < size.width || height < size.height {
                let _ = window.set_min_size(Some(tauri::LogicalSize::new(
                    320.,
                    (height as f64 / monitor.scale_factor()).min(600.),
                )));
                let _ = window.set_size(tauri::PhysicalSize::new(width, height));
                let _ = window.center();
            }
        }
    }
}
/// Install a tray and close handler after the main webview exists; startup failures stay visible in settings.
pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let path = app
        .state::<crate::paths::StorageLocation>()
        .root
        .join("desktop.json");
    let settings = if path.exists() {
        serde_json::from_slice::<Preferences>(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|_| "Invalid desktop settings")?
    } else {
        Preferences::default()
    };
    if let Err(error) = configure_desktop(app.clone(), settings) {
        *app.state::<DesktopState>()
            .warning
            .lock()
            .map_err(|_| "Desktop diagnostics unavailable")? = error;
    }
    let show_item = MenuItem::with_id(app, "show", "显示主窗口 / Show", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let add = MenuItem::with_id(app, "add", "快速添加 / Quick add", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let ocr = MenuItem::with_id(app, "ocr", "截图识别 / Screenshot OCR", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "退出 / Quit", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let menu =
        Menu::with_items(app, &[&show_item, &add, &ocr, &quit]).map_err(|e| e.to_string())?;
    let mut tray = TrayIconBuilder::with_id("zhinexus-tray")
        .tooltip("知枢 · ZhiNexus")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show(app),
            "add" => {
                push(
                    app,
                    Action {
                        kind: "capture".into(),
                        text: String::new(),
                        source: "tray".into(),
                        image: None,
                    },
                );
                show(app);
            }
            "ocr" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = crate::ocr::begin(handle.clone()).await {
                        push(
                            &handle,
                            Action {
                                kind: "error".into(),
                                text: error,
                                source: String::new(),
                                image: None,
                            },
                        );
                        show(&handle);
                    }
                });
            }
            "quit" => {
                push(
                    app,
                    Action {
                        kind: "quit".into(),
                        text: String::new(),
                        source: String::new(),
                        image: None,
                    },
                );
                show(app);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    if let Err(error) = tray.build(app) {
        app.state::<DesktopState>()
            .settings
            .lock()
            .map_err(|_| "Desktop settings unavailable")?
            .background = false;
        *app.state::<DesktopState>()
            .warning
            .lock()
            .map_err(|_| "Desktop diagnostics unavailable")? = format!("Tray unavailable: {error}");
    }
    if let Some(window) = app.get_webview_window("main") {
        let handle = app.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = handle.state::<DesktopState>();
                if !state.exiting.load(Ordering::SeqCst)
                    && state.settings.lock().is_ok_and(|s| s.background)
                {
                    api.prevent_close();
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }
        });
    }
    fit_window(app);
    if std::env::args().any(|arg| arg == "--background") {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
    Ok(())
}
/// Store a real Windows Startup shortcut using the public COM shell-link API.
#[cfg(target_os = "windows")]
fn startup(enabled: bool) -> Result<(), String> {
    use windows::{
        core::{Interface, HSTRING},
        Win32::{
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{IShellLinkW, ShellLink},
        },
    };
    let dir = dirs::config_dir()
        .ok_or("Missing application-data directory")?
        .join("Microsoft/Windows/Start Menu/Programs/Startup");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let link_path = dir.join("ZhiNexus.lnk");
    if !enabled {
        if link_path.exists() {
            fs::remove_file(link_path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // A dedicated thread owns its COM apartment and balances CoUninitialize.
    std::thread::spawn(move || unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        let result = (|| {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| e.to_string())?;
            link.SetPath(&HSTRING::from(exe.as_os_str()))
                .map_err(|e| e.to_string())?;
            link.SetWorkingDirectory(&HSTRING::from(
                exe.parent()
                    .ok_or("Missing executable directory")?
                    .as_os_str(),
            ))
            .map_err(|e| e.to_string())?;
            link.SetArguments(windows::core::w!("--background"))
                .map_err(|e| e.to_string())?;
            link.SetDescription(windows::core::w!("知枢 · ZhiNexus"))
                .map_err(|e| e.to_string())?;
            let persist: IPersistFile = link.cast().map_err(|e| e.to_string())?;
            persist
                .Save(&HSTRING::from(link_path.as_os_str()), true)
                .map_err(|e| e.to_string())
        })();
        CoUninitialize();
        result
    })
    .join()
    .map_err(|_| "Startup shortcut worker failed".to_string())?
}
/// Use the standard per-user XDG autostart file on Ubuntu; no privileged system service is installed.
#[cfg(target_os = "linux")]
fn startup(enabled: bool) -> Result<(), String> {
    let dir = dirs::config_dir()
        .ok_or("Missing config directory")?
        .join("autostart");
    let path = dir.join("zhinexus.desktop");
    if !enabled {
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();
    if exe.contains(['\n', '\r']) {
        return Err("Invalid executable path".into());
    }
    let escaped = exe
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('`', "\\`")
        .replace('$', "\\$")
        .replace('%', "%%");
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(path,format!("[Desktop Entry]\nType=Application\nName=ZhiNexus\nExec=\"{escaped}\" --background\nTerminal=false\n")).map_err(|e|e.to_string())
}
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn startup(enabled: bool) -> Result<(), String> {
    if enabled {
        Err("Autostart is not supported on this platform".into())
    } else {
        Ok(())
    }
}

/// Temporarily release only our own global registrations so an already assigned key can reach the webview.
#[tauri::command]
pub fn begin_shortcut_capture(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<DesktopState>();
    let mut lease = state
        .capture_lease
        .lock()
        .map_err(|_| "Shortcut state unavailable")?;
    if lease.is_some() {
        return Err("另一个快捷键正在录制 / Another capture is active".into());
    }
    let owned = keys(
        &*state
            .settings
            .lock()
            .map_err(|_| "Desktop settings unavailable")?,
    )?;
    for key in &owned {
        if app.global_shortcut().is_registered(*key) {
            if let Err(error) = app.global_shortcut().unregister(*key) {
                for old in &owned {
                    if !app.global_shortcut().is_registered(*old) {
                        let _ = app.global_shortcut().register(*old);
                    }
                }
                return Err(error.to_string());
            }
        }
    }
    let token = uuid::Uuid::new_v4().to_string();
    *lease = Some(token.clone());
    let timeout_token = token.clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(35)).await;
        let _ = end_shortcut_capture(handle, timeout_token);
    });
    Ok(token)
}
/// Restore registrations for the matching lease; stale blur callbacks cannot end a newer recording.
#[tauri::command]
pub fn end_shortcut_capture(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    let mut lease = state
        .capture_lease
        .lock()
        .map_err(|_| "Shortcut state unavailable")?;
    if lease.as_ref() != Some(&token) {
        return Ok(());
    }
    let owned = keys(
        &*state
            .settings
            .lock()
            .map_err(|_| "Desktop settings unavailable")?,
    )?;
    let mut errors = Vec::new();
    for key in owned {
        if !app.global_shortcut().is_registered(key) {
            if let Err(e) = app.global_shortcut().register(key) {
                errors.push(e.to_string());
            }
        }
    }
    *lease = None;
    if !errors.is_empty() {
        let error = format!(
            "无法恢复快捷键，请重新保存设置 / Could not restore shortcuts: {}",
            errors.join("; ")
        );
        *state
            .warning
            .lock()
            .map_err(|_| "Desktop diagnostics unavailable")? = error.clone();
        return Err(error);
    }
    Ok(())
}
