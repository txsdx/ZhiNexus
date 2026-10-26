//! Bounded desktop MCP stdio sessions: direct child processes, newline JSON-RPC, cancellation and owned cleanup.
use std::{
    collections::HashMap,
    process::Stdio,
    sync::{Arc, Mutex},
};
use tauri::Manager;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{mpsc, Mutex as AsyncMutex},
};
const MAX_MESSAGE: u64 = 2 * 1024 * 1024;
/// A child is killed on drop; only this app's session can send input or drain output.
struct Session {
    child: AsyncMutex<Child>,
    input: AsyncMutex<Option<ChildStdin>>,
    output: AsyncMutex<mpsc::Receiver<Result<String, String>>>,
}
/// Session handles are opaque UUIDs, bounded to prevent unbounded process creation.
#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Arc<Session>>>);
/// Launch configuration comes exclusively from the user's locally enabled MCP settings.
#[derive(serde::Deserialize)]
pub struct StdioConfig {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    cwd: Option<String>,
}
/// Read bounded JSON-RPC lines without collecting unbounded child output in memory.
async fn read_lines(
    reader: impl tokio::io::AsyncRead + Unpin,
    sender: mpsc::Sender<Result<String, String>>,
) {
    let mut reader = BufReader::new(reader);
    loop {
        let mut bytes = Vec::new();
        let result = (&mut reader)
            .take(MAX_MESSAGE + 1)
            .read_until(b'\n', &mut bytes)
            .await;
        let message = match result {
            Ok(0) => break,
            Ok(n) if n as u64 > MAX_MESSAGE => {
                let _ = sender.send(Err("MCP message exceeds 2 MiB".into())).await;
                break;
            }
            Ok(_) => String::from_utf8(bytes)
                .map_err(|_| "MCP stdout must contain UTF-8 newline JSON-RPC".into()),
            Err(_) => Err("MCP output stream failed".into()),
        };
        let failed = message.is_err();
        if sender.send(message).await.is_err() || failed {
            break;
        }
    }
}
/// Start a direct executable, never a shell or a remotely proposed command string.
#[tauri::command]
pub async fn mcp_start(app: tauri::AppHandle, config: StdioConfig) -> Result<String, String> {
    if config.command.trim().is_empty()
        || config.command.len() > 4096
        || config.command.contains(['\0', '\n', '\r'])
        || config.args.len() > 128
        || config
            .args
            .iter()
            .any(|v| v.len() > 32768 || v.contains('\0'))
        || config.env.len() > 128
        || config.env.iter().any(|(k, v)| {
            k.is_empty() || k.contains(['\0', '=']) || v.contains('\0') || v.len() > 32768
        })
    {
        return Err("Invalid MCP command configuration".into());
    }
    let state = app.state::<Sessions>();
    // Reserve under the registry lock before spawning; no await holds this lock.
    let mut registry = state.0.lock().map_err(|_| "MCP registry unavailable")?;
    if registry.len() >= 8 {
        return Err("最多同时连接 8 个 stdio MCP / Maximum 8 stdio sessions".into());
    }
    let mut command = Command::new(&config.command);
    command
        .args(&config.args)
        .envs(&config.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if let Some(cwd) = config.cwd.filter(|s| !s.is_empty()) {
        let path = std::path::Path::new(&cwd);
        if !path.is_absolute() || !path.is_dir() {
            return Err("MCP working directory must be an existing absolute directory".into());
        }
        command.current_dir(path);
    }
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| {
        format!(
            "无法启动 MCP（检查程序与参数）/ Cannot start MCP: {}",
            e
        )
    })?;
    let input = child.stdin.take().ok_or("MCP stdin unavailable")?;
    let output = child.stdout.take().ok_or("MCP stdout unavailable")?;
    let (sender, receiver) = mpsc::channel(64);
    tauri::async_runtime::spawn(read_lines(output, sender));
    let id = uuid::Uuid::new_v4().to_string();
    registry.insert(
        id.clone(),
        Arc::new(Session {
            child: AsyncMutex::new(child),
            input: AsyncMutex::new(Some(input)),
            output: AsyncMutex::new(receiver),
        }),
    );
    Ok(id)
}
/// Resolve a caller-owned UUID without returning a process ID or filesystem handle.
fn session(app: &tauri::AppHandle, id: &str) -> Result<Arc<Session>, String> {
    app.state::<Sessions>()
        .0
        .lock()
        .map_err(|_| "MCP registry unavailable")?
        .get(id)
        .cloned()
        .ok_or("MCP session is closed".into())
}
/// Send one validated protocol message with a size bound; embedded newlines are encoded by JSON.stringify.
#[tauri::command]
pub async fn mcp_send(app: tauri::AppHandle, id: String, message: String) -> Result<(), String> {
    if message.len() as u64 > MAX_MESSAGE
        || message.contains(['\n', '\r'])
        || serde_json::from_str::<serde_json::Value>(&message).is_err()
    {
        return Err("Invalid MCP JSON-RPC frame".into());
    }
    let session = session(&app, &id)?;
    let mut input = session.input.lock().await;
    let input = input.as_mut().ok_or("MCP stdin is closed")?;
    input
        .write_all(message.as_bytes())
        .await
        .map_err(|_| "MCP stdin failed")?;
    input
        .write_all(b"\n")
        .await
        .map_err(|_| "MCP stdin failed")?;
    input.flush().await.map_err(|_| "MCP stdin failed".into())
}
/// Long polling avoids event races; an idle timeout is distinct from process EOF.
#[tauri::command]
pub async fn mcp_next(app: tauri::AppHandle, id: String) -> Result<serde_json::Value, String> {
    let session = session(&app, &id)?;
    let mut output = session.output.lock().await;
    match tokio::time::timeout(std::time::Duration::from_secs(20), output.recv()).await {
        Err(_) => Ok(serde_json::json!({"idle":true})),
        Ok(None) => Ok(serde_json::json!({"closed":true})),
        Ok(Some(Ok(line))) => Ok(serde_json::json!({"message":line})),
        Ok(Some(Err(error))) => Err(error),
    }
}
/// Remove the session first, close stdin and terminate only its directly owned child.
#[tauri::command]
pub async fn mcp_close(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let session = app
        .state::<Sessions>()
        .0
        .lock()
        .map_err(|_| "MCP registry unavailable")?
        .remove(&id);
    if let Some(session) = session {
        session.input.lock().await.take();
        let mut child = session.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    Ok(())
}
/// Terminate owned children during native exit even when their webview did not send a close message.
pub fn shutdown(app: &tauri::AppHandle) {
    if let Ok(mut sessions) = app.state::<Sessions>().0.lock() {
        for (_, session) in sessions.drain() {
            if let Ok(mut child) = session.child.try_lock() {
                let _ = child.start_kill();
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    /// Truncated and oversized child frames cannot grow the protocol queue without bounds.
    #[test]
    fn stdio_reader_enforces_frame_limit() {
        tauri::async_runtime::block_on(async {
            let (tx, mut rx) = mpsc::channel(2);
            let data = vec![b'x'; MAX_MESSAGE as usize + 2];
            read_lines(&data[..], tx).await;
            assert!(rx.recv().await.unwrap().is_err());
        });
    }
}
