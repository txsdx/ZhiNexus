//! Opaque floating capture window and a bounded RPC bridge to the main webview's single database writer.
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;
const LABEL: &str = "quick-capture";
type Reply = Result<Value, String>;
struct Waiter {
    responder: &'static str,
    sender: oneshot::Sender<Reply>,
}
#[derive(Default)]
struct Pending {
    queue: VecDeque<Request>,
    waiters: HashMap<String, Waiter>,
}
impl Pending {
    fn finish(
        &mut self,
        responder: &str,
        id: &str,
        value: Option<Value>,
        error: Option<String>,
    ) -> Result<(), String> {
        if self
            .waiters
            .get(id)
            .is_some_and(|w| w.responder != responder)
        {
            return Err("Invalid capture responder".into());
        }
        if let Some(waiter) = self.waiters.remove(id) {
            let _ = waiter.sender.send(match error {
                Some(e) => Err(e),
                None => Ok(value.unwrap_or(Value::Null)),
            });
        }
        Ok(())
    }
}
/// Only a validated request body and opaque delivery identifier cross between the two local webviews.
#[derive(Clone, Serialize)]
pub struct Request {
    pub id: String,
    pub body: Value,
}
/// The bridge never opens SQLite; main owns every capture mutation and staged attachment.
#[derive(Default)]
pub struct Bridge {
    pending: Mutex<Pending>,
    ready: AtomicBool,
    frozen: AtomicBool,
}
fn permit(window: &tauri::WebviewWindow, label: &str) -> Result<(), String> {
    if window.label() != label {
        Err("Invalid capture window".into())
    } else {
        Ok(())
    }
}
fn finish(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    id: String,
    value: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    let bridge = app.state::<Bridge>();
    let mut pending = bridge
        .pending
        .lock()
        .map_err(|_| "Capture bridge unavailable")?;
    pending.finish(window.label(), &id, value, error)
}
async fn wait(app: &tauri::AppHandle, id: &str, receiver: oneshot::Receiver<Reply>) -> Reply {
    let response = tokio::time::timeout(Duration::from_secs(60), receiver).await;
    if let Ok(mut pending) = app.state::<Bridge>().pending.lock() {
        pending.waiters.remove(id);
        pending.queue.retain(|r| r.id != id);
    }
    response
        .map_err(|_| "Capture request timed out; draft retained")?
        .map_err(|_| "Capture bridge disconnected")?
}
/// Forward only floating-window requests; queued wakeups survive main-webview startup without a second database connection.
#[tauri::command]
pub async fn capture_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    body: Value,
) -> Reply {
    permit(&window, LABEL)?;
    let bridge = app.state::<Bridge>();
    if bridge.frozen.load(Ordering::SeqCst) {
        return Err("正在退出或迁移，草稿已保留 / Capture paused for shutdown".into());
    }
    if serde_json::to_vec(&body).map_err(|e| e.to_string())?.len() > 32 * 1024 * 1024 {
        return Err("Capture request exceeds 32 MiB".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    {
        let mut pending = bridge
            .pending
            .lock()
            .map_err(|_| "Capture bridge unavailable")?;
        if pending.waiters.len() >= 64 {
            return Err("Capture request queue is full".into());
        }
        pending.queue.push_back(Request {
            id: id.clone(),
            body,
        });
        pending.waiters.insert(
            id.clone(),
            Waiter {
                responder: "main",
                sender,
            },
        );
    }
    let _ = app.emit_to("main", "capture:requests", ());
    wait(&app, &id, receiver).await
}
/// Drain the main writer's queue only; the auxiliary webview has no SQL, filesystem or provider capability.
#[tauri::command]
pub fn take_capture_requests(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Vec<Request>, String> {
    permit(&window, "main")?;
    let bridge = app.state::<Bridge>();
    let mut pending = bridge
        .pending
        .lock()
        .map_err(|_| "Capture bridge unavailable")?;
    let requests: Vec<_> = pending.queue.drain(..).collect();
    Ok(requests
        .into_iter()
        .filter(|r| pending.waiters.contains_key(&r.id))
        .collect())
}
/// Complete a main-writer operation without exposing arbitrary native command execution to the child.
#[tauri::command]
pub fn complete_capture_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    value: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    permit(&window, "main")?;
    finish(&app, &window, id, value, error)
}
/// Mark the child's close/flush listeners as ready before it accepts editable input.
#[tauri::command]
pub fn capture_window_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    ready: bool,
) -> Result<(), String> {
    permit(&window, LABEL)?;
    app.state::<Bridge>().ready.store(ready, Ordering::SeqCst);
    Ok(())
}
/// Wait for pending imports and draft persistence before the main process releases its database.
#[tauri::command]
pub async fn flush_capture_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    freeze: bool,
) -> Result<(), String> {
    permit(&window, "main")?;
    let bridge = app.state::<Bridge>();
    if app.get_webview_window(LABEL).is_none() || !bridge.ready.load(Ordering::SeqCst) {
        if freeze {
            bridge.frozen.store(true, Ordering::SeqCst);
        }
        return Ok(());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    bridge
        .pending
        .lock()
        .map_err(|_| "Capture bridge unavailable")?
        .waiters
        .insert(
            id.clone(),
            Waiter {
                responder: LABEL,
                sender,
            },
        );
    if let Err(e) = app.emit_to(
        LABEL,
        "capture:flush",
        serde_json::json!({"id":id,"freeze":freeze}),
    ) {
        bridge
            .pending
            .lock()
            .map_err(|_| "Capture bridge unavailable")?
            .waiters
            .remove(&id);
        return Err(e.to_string());
    }
    wait(&app, &id, receiver).await?;
    if freeze {
        bridge.frozen.store(true, Ordering::SeqCst);
    }
    Ok(())
}
/// Acknowledge the exact flush request after the child has finished persistent writes.
#[tauri::command]
pub fn complete_capture_flush(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    error: Option<String>,
) -> Result<(), String> {
    permit(&window, LABEL)?;
    finish(&app, &window, id, None, error)
}
/// Resume editable controls if a shutdown or migration failed after the capture draft was flushed.
#[tauri::command]
pub fn resume_capture_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    permit(&window, "main")?;
    app.state::<Bridge>().frozen.store(false, Ordering::SeqCst);
    let _ = app.emit_to(LABEL, "capture:resume", ());
    Ok(())
}
/// Open or raise one ordinary opaque OS window, retaining its user-resized bounds while hidden.
#[tauri::command]
pub async fn open_quick_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    permit(&window, "main")?;
    if let Some(existing) = app.get_webview_window(LABEL) {
        let _ = existing.unminimize();
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        let _ = existing.emit("capture:opened", ());
        return Ok(());
    }
    let mut width: f64 = 560.;
    let mut height: f64 = 640.;
    if let Ok(Some(monitor)) = app.primary_monitor() {
        width = width.min((monitor.size().width as f64 / monitor.scale_factor() - 48.).max(320.));
        height =
            height.min((monitor.size().height as f64 / monitor.scale_factor() - 80.).max(360.));
    }
    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        LABEL,
        tauri::WebviewUrl::App("index.html?quick-capture=1".into()),
    )
    .title("知枢 · 记录新知识 / Quick capture")
    .inner_size(width, height)
    .min_inner_size(320., 360.)
    .resizable(true)
    .decorations(true)
    .transparent(false)
    .always_on_top(true)
    .shadow(false)
    .center()
    .background_color(tauri::utils::config::Color(255, 255, 255, 255))
    .disable_drag_drop_handler()
    .data_directory(
        app.state::<crate::paths::StorageLocation>()
            .root
            .join("webview"),
    );
    #[cfg(target_os = "windows")]
    let builder = match crate::startup::automation_arguments() {
        Some(arguments) => builder.additional_browser_args(&arguments),
        None => builder,
    };
    let capture = builder.build().map_err(|e| e.to_string())?;
    let handle = app.clone();
    capture.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } if !crate::desktop::is_exiting(&handle) => {
            api.prevent_close();
            if handle.state::<Bridge>().ready.load(Ordering::SeqCst) {
                let _ = handle.emit_to(LABEL, "capture:close", ());
            } else if let Some(window) = handle.get_webview_window(LABEL) {
                let _ = window.hide();
            }
        }
        tauri::WindowEvent::Destroyed => {
            handle
                .state::<Bridge>()
                .ready
                .store(false, Ordering::SeqCst);
        }
        _ => {}
    });
    Ok(())
}
/// Toggle the floating window's pin without granting that capability to imported content or another window.
#[tauri::command]
pub fn set_capture_topmost(window: tauri::WebviewWindow, topmost: bool) -> Result<(), String> {
    permit(&window, LABEL)?;
    window.set_always_on_top(topmost).map_err(|e| e.to_string())
}
/// Hide the old floating surface after its acknowledged flush, retaining its bounds for the next shortcut.
#[tauri::command]
pub fn hide_quick_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    permit(&window, "main")?;
    if let Some(capture) = app.get_webview_window(LABEL) {
        capture.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
/// User-selected existing knowledge opens in the main window only after an explicit capture action.
#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    permit(&window, "main")?;
    crate::desktop::show(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wrong_responder_cannot_consume_a_pending_request() {
        let mut pending = Pending::default();
        let (sender, mut receiver) = oneshot::channel();
        pending.waiters.insert(
            "save".into(),
            Waiter {
                responder: "main",
                sender,
            },
        );
        assert!(pending.finish(LABEL, "save", None, None).is_err());
        assert!(pending.waiters.contains_key("save"));
        assert!(matches!(
            receiver.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        pending
            .finish(
                "main",
                "save",
                Some(serde_json::json!({"saved":true})),
                None,
            )
            .unwrap();
        assert_eq!(receiver.try_recv().unwrap().unwrap()["saved"], true);
        assert!(pending.waiters.is_empty());
        pending
            .finish("main", "save", None, Some("late duplicate".into()))
            .unwrap();
        assert!(matches!(
            receiver.try_recv(),
            Err(oneshot::error::TryRecvError::Closed)
        ));
    }
    #[test]
    fn failed_flush_reaches_the_caller_and_dropped_callers_are_removed() {
        let mut pending = Pending::default();
        let (sender, mut receiver) = oneshot::channel();
        pending.waiters.insert(
            "flush".into(),
            Waiter {
                responder: LABEL,
                sender,
            },
        );
        pending
            .finish(LABEL, "flush", None, Some("storage unavailable".into()))
            .unwrap();
        assert_eq!(
            receiver.try_recv().unwrap(),
            Err("storage unavailable".into())
        );
        let (sender, receiver) = oneshot::channel();
        pending.waiters.insert(
            "abandoned".into(),
            Waiter {
                responder: "main",
                sender,
            },
        );
        drop(receiver);
        pending.finish("main", "abandoned", None, None).unwrap();
        assert!(pending.waiters.is_empty());
    }
}
