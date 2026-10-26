//! Explicit screenshot selection with a DPI-correct overlay and local Windows/Tesseract OCR; screenshots stay local by default.
use base64::Engine;
use std::{
    io::Cursor,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::Manager;
/// A single active screenshot prevents overlapping capture overlays and unbounded image retention.
#[derive(Default)]
pub struct CaptureState {
    active: AtomicBool,
    frame: Mutex<Option<Frame>>,
}
/// Pixel data is retained only until the user confirms or cancels a region.
struct Frame {
    id: String,
    image: image::RgbaImage,
    png: String,
    origin: (i32, i32),
    windows: Vec<SourceWindow>,
}
/// Window bounds are sampled before the overlay appears, so provenance comes from the selected region's center.
struct SourceWindow {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
    name: String,
}
/// Record only bounded process names and geometry, never window titles or command lines.
fn source_windows() -> Vec<SourceWindow> {
    xcap::Window::all()
        .unwrap_or_default()
        .into_iter()
        .take(512)
        .filter_map(|window| {
            if window.is_minimized().ok()? {
                return None;
            }
            Some(SourceWindow {
                x: window.x().ok()? as i64,
                y: window.y().ok()? as i64,
                width: window.width().ok()? as i64,
                height: window.height().ok()? as i64,
                name: window.app_name().ok()?.chars().take(128).collect(),
            })
        })
        .collect()
}
/// Serialize PNG with explicit image and payload bounds before crossing IPC.
fn png(image: &image::RgbaImage) -> Result<String, String> {
    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    if buffer.get_ref().len() > 24 * 1024 * 1024 {
        return Err("截图过大，请降低屏幕分辨率后重试 / Screenshot exceeds size limit".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(buffer.into_inner()))
}
/// Capture the monitor under the pointer before displaying any overlay or focusing the main app.
pub async fn begin(app: tauri::AppHandle) -> Result<(), String> {
    if app
        .state::<CaptureState>()
        .active
        .swap(true, Ordering::SeqCst)
    {
        return Err("已有截图选择窗口 / A screenshot is already being selected".into());
    }
    let handle = app.clone();
    let result=tauri::async_runtime::spawn_blocking(move||{
        let cursor=handle.cursor_position().map_err(|e|e.to_string())?;
        let monitor=xcap::Monitor::from_point(cursor.x as i32,cursor.y as i32).map_err(|_|"无法截取当前屏幕，请检查系统录屏权限 / Screen capture permission or monitor unavailable")?;
        let image=monitor.capture_image().map_err(|e|format!("截图失败 / Capture failed: {e}"))?;
        if image.width() as u64*image.height() as u64>40_000_000{return Err("Screen exceeds 40 megapixels".into());}
        let windows=source_windows();
        let encoded=png(&image)?;let width=image.width();let height=image.height();let x=monitor.x().map_err(|e|e.to_string())?;let y=monitor.y().map_err(|e|e.to_string())?;
        *handle.state::<CaptureState>().frame.lock().map_err(|_|"Capture state unavailable")?=Some(Frame{id:uuid::Uuid::new_v4().to_string(),image,png:encoded,origin:(x,y),windows});
        let window=tauri::WebviewWindowBuilder::new(&handle,"ocr-overlay",tauri::WebviewUrl::App("index.html?ocr-overlay=1".into()))
            .title("知枢 · 截图识别").decorations(false).resizable(false).always_on_top(true)
            .skip_taskbar(true).visible(false)
            .data_directory(handle.state::<crate::paths::StorageLocation>().root.join("webview"));
        #[cfg(target_os="windows")]
        let window=match crate::startup::automation_arguments(){Some(arguments)=>window.additional_browser_args(&arguments),None=>window};
        let window=window.build().map_err(|e|e.to_string())?;
        window.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;window.set_size(tauri::PhysicalSize::new(width,height)).map_err(|e|e.to_string())?;
        window.show().map_err(|e|e.to_string())?;window.set_focus().map_err(|e|e.to_string())?;
        let cleanup=handle.clone();window.on_window_event(move|event|{if matches!(event,tauri::WindowEvent::Destroyed){if let Ok(mut frame)=cleanup.state::<CaptureState>().frame.lock(){frame.take();}cleanup.state::<CaptureState>().active.store(false,Ordering::SeqCst);}});
        Ok(())
    }).await.map_err(|e|e.to_string()).and_then(|v|v);
    if result.is_err() {
        app.state::<CaptureState>()
            .active
            .store(false, Ordering::SeqCst);
        if let Ok(mut frame) = app.state::<CaptureState>().frame.lock() {
            frame.take();
        }
        if let Some(window) = app.get_webview_window("ocr-overlay") {
            let _ = window.destroy();
        }
    }
    result
}
/// Start screen selection from an explicit UI button, in addition to the native hotkey and tray item.
#[tauri::command]
pub async fn begin_ocr_capture(app: tauri::AppHandle) -> Result<(), String> {
    begin(app).await
}
/// Only the dedicated local overlay may read the captured screen; it never initializes the knowledge database.
#[tauri::command]
pub fn ocr_frame(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
    if window.label() != "ocr-overlay" {
        return Err("Screen data is restricted to the capture overlay".into());
    }
    let state = app.state::<CaptureState>();
    let frame = state.frame.lock().map_err(|_| "Capture unavailable")?;
    let frame = frame.as_ref().ok_or("Capture expired")?;
    Ok(
        serde_json::json!({"id":frame.id,"width":frame.image.width(),"height":frame.image.height(),"image":format!("data:image/png;base64,{}",frame.png)}),
    )
}
/// Validate a physical-pixel crop against its token before raising the editable OCR result dialog.
#[tauri::command]
pub fn finish_ocr_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if window.label() != "ocr-overlay" {
        return Err("Invalid capture window".into());
    }
    let state = app.state::<CaptureState>();
    let mut frame = state.frame.lock().map_err(|_| "Capture unavailable")?;
    let current = frame.as_ref().ok_or("Capture expired")?;
    if id != current.id
        || width < 4
        || height < 4
        || x.checked_add(width)
            .is_none_or(|v| v > current.image.width())
        || y.checked_add(height)
            .is_none_or(|v| v > current.image.height())
    {
        return Err("Invalid capture region".into());
    }
    let image = image::imageops::crop_imm(&current.image, x, y, width, height).to_image();
    let encoded = png(&image)?;
    let point = (
        current.origin.0 as i64 + x as i64 + (width / 2) as i64,
        current.origin.1 as i64 + y as i64 + (height / 2) as i64,
    );
    let process = current
        .windows
        .iter()
        .find(|window| {
            point.0 >= window.x
                && point.1 >= window.y
                && point.0 < window.x + window.width
                && point.1 < window.y + window.height
        })
        .map(|window| window.name.as_str())
        .unwrap_or("unknown-process");
    let source = format!("screenshot:{process}");
    frame.take();
    drop(frame);
    window.destroy().map_err(|e| e.to_string())?;
    state.active.store(false, Ordering::SeqCst);
    crate::desktop::push(
        &app,
        crate::desktop::Action {
            kind: "ocr".into(),
            text: String::new(),
            source,
            image: Some(format!("data:image/png;base64,{encoded}")),
        },
    );
    crate::desktop::show(&app);
    Ok(())
}
/// Cancel without retaining screenshot data or creating an entry.
#[tauri::command]
pub fn cancel_ocr_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    if window.label() != "ocr-overlay" {
        return Err("Invalid capture window".into());
    }
    app.state::<CaptureState>()
        .frame
        .lock()
        .map_err(|_| "Capture unavailable")?
        .take();
    app.state::<CaptureState>()
        .active
        .store(false, Ordering::SeqCst);
    window.destroy().map_err(|e| e.to_string())
}
/// Decode bounded PNG data and invoke an offline OCR engine; no network request is made here.
#[tauri::command]
pub async fn recognize_ocr(image: String) -> Result<String, String> {
    if image.len() > 32 * 1024 * 1024 {
        return Err("OCR image exceeds size limit".into());
    }
    let value = image
        .strip_prefix("data:image/png;base64,")
        .ok_or("OCR requires PNG image data")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|_| "Invalid OCR image")?;
    tauri::async_runtime::spawn_blocking(move || local_ocr(&bytes))
        .await
        .map_err(|e| e.to_string())?
}
/// Validate pixel dimensions before an external/local decoder can allocate image storage.
fn decode(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "Invalid OCR PNG")?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(160 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| "OCR image is invalid or too large".into())
}
/// Windows uses installed OS recognition languages, with resizing to the documented OCR dimension limit.
#[cfg(target_os = "windows")]
fn local_ocr(bytes: &[u8]) -> Result<String, String> {
    use windows::{
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };
    let image = decode(bytes)?;
    std::thread::spawn(move||unsafe{RoInitialize(RO_INIT_MULTITHREADED).map_err(|e|e.to_string())?;let result=(||->windows::core::Result<String>{let limit=OcrEngine::MaxImageDimension()?;let scaled=image.thumbnail(limit,limit);let mut png=Cursor::new(Vec::new());scaled.write_to(&mut png,image::ImageFormat::Png).map_err(|_|windows::core::Error::from_hresult(windows::core::HRESULT(0x8007000Du32 as i32)))?;let stream=InMemoryRandomAccessStream::new()?;let writer=DataWriter::CreateDataWriter(&stream)?;writer.WriteBytes(png.get_ref())?;writer.StoreAsync()?.join()?;writer.FlushAsync()?.join()?;writer.DetachStream()?;stream.Seek(0)?;let decoder=BitmapDecoder::CreateAsync(&stream)?.join()?;let bitmap=decoder.GetSoftwareBitmapAsync()?.join()?;let engine=OcrEngine::TryCreateFromUserProfileLanguages()?;Ok(engine.RecognizeAsync(&bitmap)?.join()?.Text()?.to_string())})();RoUninitialize();result.map_err(|_|"系统 OCR 不可用，请在 Windows 中安装中文/英语 OCR 语言，或手动选择 AI 识别 / Install Windows OCR languages or explicitly choose AI recognition".into())}).join().map_err(|_|"OCR worker failed".to_string())?
}
/// Ubuntu uses Tesseract's installed Chinese and English data through stdin, avoiding screenshot files.
#[cfg(target_os = "linux")]
fn local_ocr(bytes: &[u8]) -> Result<String, String> {
    use std::{
        io::Write,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let _ = decode(bytes)?;
    let mut child=Command::new("tesseract").args(["stdin","stdout","-l","chi_sim+eng"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|_|"请安装 tesseract-ocr、tesseract-ocr-eng、tesseract-ocr-chi-sim，或手动选择 AI 识别 / Install Tesseract languages or choose AI recognition")?;
    let data = bytes.to_vec();
    let mut input = child.stdin.take().ok_or("OCR stdin unavailable")?;
    let writer = std::thread::spawn(move || input.write_all(&data));
    let output = child.stdout.take().ok_or("OCR stdout unavailable")?;
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut result = Vec::new();
        output
            .take(2 * 1024 * 1024)
            .read_to_end(&mut result)
            .map(|_| result)
    });
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let _ = writer.join();
                let result = reader
                    .join()
                    .map_err(|_| "OCR output unavailable")?
                    .map_err(|_| "OCR output failed")?;
                if !status.success() {
                    return Err(
                        "本地 OCR 未完成，请检查语言包 / Local OCR failed; check language data"
                            .into(),
                    );
                }
                return Ok(String::from_utf8_lossy(&result).trim().to_string());
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = writer.join();
                let _ = reader.join();
                return Err("本地 OCR 超时 / Local OCR timed out".into());
            }
        }
    }
}
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn local_ocr(_bytes: &[u8]) -> Result<String, String> {
    Err("Local OCR is unavailable on this platform".into())
}
