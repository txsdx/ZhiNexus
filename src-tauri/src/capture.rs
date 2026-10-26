//! User-invoked text selection capture with bounded process provenance; never monitors other applications in the background.
use serde::Serialize;
/// Captured material is reviewed in the creation dialog before it is stored or sent to an AI provider.
#[derive(Serialize)]
pub struct Capture {
    pub text: String,
    pub source: String,
}
/// Read a selection only following the configured explicit shortcut; fall back to the existing clipboard when OS policy prevents it.
#[tauri::command]
pub async fn capture_knowledge() -> Result<Capture, String> {
    tauri::async_runtime::spawn_blocking(capture)
        .await
        .map_err(|e| e.to_string())?
}
/// Preserve clipboard contents when no platform selection API is available, marking its original process as unknown.
fn capture() -> Result<Capture, String> {
    #[cfg(target_os = "windows")]
    return windows_selection();
    #[cfg(target_os = "linux")]
    {
        use arboard::GetExtLinux;
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        if let Ok(text) = clipboard
            .get()
            .clipboard(arboard::LinuxClipboardKind::Primary)
            .text()
        {
            if !text.trim().is_empty() {
                return Ok(Capture {
                    text: text.chars().take(5000).collect(),
                    source: format!(
                        "selection:{}",
                        linux_owner().unwrap_or_else(|| "unknown-X11-process".into())
                    ),
                });
            }
        }
        return clipboard
            .get_text()
            .map(|text| Capture {
                text: text.chars().take(5000).collect(),
                source: "clipboard:unknown-process".into(),
            })
            .map_err(|e| e.to_string());
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    Err("Selection capture is unavailable on this platform".into())
}
/// Resolve X11 selection ownership rather than incorrectly attributing an old clipboard to the foreground application.
#[cfg(target_os = "linux")]
fn linux_owner() -> Option<String> {
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt};
    let (connection, _) = x11rb::connect(None).ok()?;
    let primary = connection
        .intern_atom(false, b"PRIMARY")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let pid_atom = connection
        .intern_atom(false, b"_NET_WM_PID")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let mut window = connection
        .get_selection_owner(primary)
        .ok()?
        .reply()
        .ok()?
        .owner;
    for _ in 0..16 {
        if window == 0 {
            break;
        }
        let reply = connection
            .get_property(false, window, pid_atom, AtomEnum::CARDINAL, 0, 1)
            .ok()?
            .reply()
            .ok()?;
        if let Some(pid) = reply.value32().and_then(|mut v| v.next()) {
            return std::fs::read_to_string(format!("/proc/{pid}/comm"))
                .ok()
                .map(|s| s.trim().chars().take(128).collect());
        }
        let parent = connection.query_tree(window).ok()?.reply().ok()?.parent;
        if parent == window {
            break;
        }
        window = parent;
    }
    None
}
/// Request an ordinary Ctrl+C after modifiers are released; elevated/protected windows remain governed by Windows UIPI.
#[cfg(target_os = "windows")]
fn windows_selection() -> Result<Capture, String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            DataExchange::GetClipboardSequenceNumber,
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::{
            Input::KeyboardAndMouse::{
                GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
                KEYEVENTF_KEYUP, VK_CONTROL, VK_SHIFT,
            },
            WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
        },
    };
    let original = unsafe { GetForegroundWindow() };
    let mut process = "unknown-process".to_string();
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(original, &mut pid);
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !handle.is_null() {
            let mut path = [0u16; 32768];
            let mut size = path.len() as u32;
            if QueryFullProcessImageNameW(handle, 0, path.as_mut_ptr(), &mut size) != 0 {
                let name = String::from_utf16_lossy(&path[..size as usize]);
                process = std::path::Path::new(&name)
                    .file_name()
                    .map(|s| s.to_string_lossy().chars().take(128).collect())
                    .unwrap_or(process);
            }
            CloseHandle(handle);
        }
    }
    let before = unsafe { GetClipboardSequenceNumber() };
    for _ in 0..100 {
        if unsafe { GetAsyncKeyState(VK_CONTROL as i32) } >= 0
            && unsafe { GetAsyncKeyState(VK_SHIFT as i32) } >= 0
        {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    if unsafe { GetAsyncKeyState(VK_CONTROL as i32) } < 0
        || unsafe { GetAsyncKeyState(VK_SHIFT as i32) } < 0
        || unsafe { GetForegroundWindow() } != original
    {
        let text = arboard::Clipboard::new()
            .and_then(|mut c| c.get_text())
            .map_err(|e| e.to_string())?;
        return Ok(Capture {
            text: text.chars().take(5000).collect(),
            source: "clipboard:unknown-process".into(),
        });
    }
    let input = |key: u16, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let keys = [
        input(VK_CONTROL, false),
        input(0x43, false),
        input(0x43, true),
        input(VK_CONTROL, true),
    ];
    unsafe {
        SendInput(
            keys.len() as u32,
            keys.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }
    let mut changed = false;
    for _ in 0..60 {
        if unsafe { GetClipboardSequenceNumber() } != before {
            changed = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(15));
    }
    let text = arboard::Clipboard::new()
        .and_then(|mut c| c.get_text())
        .map_err(|e| e.to_string())?;
    Ok(Capture {
        text: text.chars().take(5000).collect(),
        source: if changed {
            format!("selection:{process}")
        } else {
            "clipboard:unknown-process".into()
        },
    })
}
