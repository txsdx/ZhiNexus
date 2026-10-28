//! HTTPS, SHA-256 and optional Minisign verification before platform installers or portable replacement are launched.
use base64::Engine;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;
#[cfg(not(target_os = "android"))]
use tauri_plugin_opener::OpenerExt;

/// Only the four release artifact kinds are accepted; arbitrary shell commands and destination paths are forbidden.
#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Setup,
    Portable,
    Apk,
    Deb,
}
/// Update metadata comes from the pinned project Release and is verified again at the native boundary.
#[derive(serde::Deserialize)]
pub struct PlatformUpdate {
    pub kind: Kind,
    pub url: String,
    pub sha256: String,
    pub signature: Option<String>,
    pub version: String,
}
/// Resolve the running platform, patch version and portable-executable identity independently of the Release tag.
#[tauri::command]
pub fn update_identity(app: tauri::AppHandle) -> serde_json::Value {
    let location = app.state::<crate::paths::StorageLocation>();
    let executable = std::env::current_exe().unwrap_or_default();
    let portable = location.portable
        || executable
            .file_stem()
            .is_some_and(|s| s.to_string_lossy().ends_with("_protable"));
    serde_json::json!({"platform":if cfg!(target_os="windows"){"windows-x86_64"}else if cfg!(target_os="android"){"android-arm64"}else{"linux-x86_64"},"version":app.package_info().version.to_string(),"portable":portable})
}
/// Read the private repository manifest without exposing the embedded credential to the webview.
#[tauri::command]
pub async fn read_update_manifest(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    crate::github_release::ReleaseClient::new(&app, std::time::Duration::from_secs(60))?
        .latest_manifest()
        .await
}
/// Validate repository ownership and platform compatibility before any outbound request or file write.
fn validate(update: &PlatformUpdate) -> Result<&'static str, String> {
    let url = reqwest::Url::parse(&update.url).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.path().starts_with("/txsdx/ZhiNexus/releases/download/")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || update.sha256.len() != 64
        || !update.sha256.bytes().all(|c| c.is_ascii_hexdigit())
        || semver::Version::parse(&update.version).is_err()
    {
        return Err("Untrusted update metadata".into());
    }
    let extension = match update.kind {
        Kind::Setup | Kind::Portable if cfg!(target_os = "windows") => "exe",
        Kind::Apk if cfg!(target_os = "android") => "apk",
        Kind::Deb if cfg!(target_os = "linux") => "deb",
        _ => return Err("Artifact does not match this platform".into()),
    };
    if !url.path().ends_with(&format!(".{extension}")) {
        return Err("Unexpected artifact extension".into());
    }
    Ok(extension)
}
/// Enforce configured publisher signatures without silently downgrading to unsigned installation.
fn verify_publisher(
    app: &tauri::AppHandle,
    path: &Path,
    update: &PlatformUpdate,
) -> Result<(), String> {
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if key.is_empty() {
        return Ok(());
    }
    let signature = update
        .signature
        .as_ref()
        .ok_or("Publisher signature required")?;
    let decode = |value: &str| -> Result<String, String> {
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(value.trim())
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    };
    let key = minisign_verify::PublicKey::decode(&decode(key)?).map_err(|e| e.to_string())?;
    let signature =
        minisign_verify::Signature::decode(&decode(signature)?).map_err(|e| e.to_string())?;
    let mut verifier = key.verify_stream(&signature).map_err(|e| e.to_string())?;
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        verifier.update(&buffer[..count]);
    }
    verifier.finalize().map_err(|e| e.to_string())?;
    let signed = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"))
        .ok_or("Signature does not bind an application version")?;
    if semver::Version::parse(signed).map_err(|e| e.to_string())?
        != semver::Version::parse(&update.version).map_err(|e| e.to_string())?
    {
        return Err("Signed update version mismatch".into());
    }
    Ok(())
}
/// Serialize cache downloads and installer launches to prevent concurrent use of the same partial file.
#[derive(Default)]
pub struct UpdateState(tokio::sync::Mutex<()>);
/// Verify cached files again after restarts and immediately before any installer can launch.
fn verify_digest(path: &Path, expected: &str) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 512 * 1024 * 1024 {
        return Err("Update exceeds size limit".into());
    }
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    if format!("{:x}", digest.finalize()) != expected {
        return Err("Update SHA-256 mismatch".into());
    }
    Ok(())
}
/// Stage bytes without UI or process termination; verified caches work offline and avoid duplicate downloads.
async fn prepare_file(app: &tauri::AppHandle, update: &PlatformUpdate) -> Result<PathBuf, String> {
    let extension = validate(update)?;
    if semver::Version::parse(&update.version).map_err(|e| e.to_string())?
        <= app.package_info().version
    {
        return Err("Update is not newer than this platform version".into());
    }
    let root = app
        .state::<crate::paths::StorageLocation>()
        .root
        .join("updates");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let file = root.join(format!("{}.{extension}", update.sha256));
    if file.exists()
        && verify_digest(&file, &update.sha256).is_ok()
        && verify_publisher(app, &file, update).is_ok()
    {
        return Ok(file);
    }
    let pending = file.with_extension("partial");
    let transfer: Result<(), String> = async {
        let response =
            crate::github_release::ReleaseClient::new(app, std::time::Duration::from_secs(900))?
                .download(&update.url)
                .await?;
        if response.content_length().unwrap_or(0) > 512 * 1024 * 1024 {
            return Err("Update exceeds size limit".into());
        }
        let mut output = fs::File::create(&pending).map_err(|e| e.to_string())?;
        let mut size = 0usize;
        let mut stream = response.bytes_stream();
        while let Some(bytes) = stream.next().await {
            let bytes = bytes.map_err(|e| e.without_url().to_string())?;
            size += bytes.len();
            if size > 512 * 1024 * 1024 {
                return Err("Update exceeds size limit".into());
            }
            output.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        verify_digest(&pending, &update.sha256)?;
        verify_publisher(app, &pending, update)?;
        if file.exists() {
            fs::remove_file(&file).map_err(|e| e.to_string())?;
        }
        fs::rename(&pending, &file).map_err(|e| e.to_string())?;
        Ok(())
    }
    .await;
    if transfer.is_err() {
        let _ = fs::remove_file(&pending);
    }
    transfer?;
    Ok(file)
}
/// Background staging never opens an installer; the webview receives no executable path or credential.
#[tauri::command]
pub async fn prepare_platform_update(
    app: tauri::AppHandle,
    update: PlatformUpdate,
) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let _guard = state.0.lock().await;
    prepare_file(&app, &update).await.map(|_| ())
}
/// Launch only verified bytes; automatic Windows exits can install silently without restarting the app.
#[tauri::command]
pub async fn install_platform_update(
    app: tauri::AppHandle,
    update: PlatformUpdate,
    silent: Option<bool>,
    restart: Option<bool>,
) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let _guard = state.0.lock().await;
    let file = prepare_file(&app, &update).await?;
    #[cfg(target_os = "windows")]
    let root = file.parent().ok_or("Missing update directory")?;
    #[cfg(not(target_os = "windows"))]
    let _ = (silent, restart);
    #[cfg(target_os = "windows")]
    if matches!(update.kind, Kind::Portable) {
        let target = std::env::current_exe().map_err(|e| e.to_string())?;
        fs::write(
            root.join("pending.json"),
            serde_json::to_vec(&serde_json::json!({"target":target,"sha256":update.sha256}))
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let mut helper = std::process::Command::new(&file);
        helper.arg("--finish-portable-update").arg(&target);
        if !restart.unwrap_or(true) {
            helper.arg("--no-restart");
        }
        helper.spawn().map_err(|e| e.to_string())?;
        crate::desktop::mark_exiting(&app);
        app.exit(0);
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    if matches!(update.kind, Kind::Setup) {
        let mut installer = std::process::Command::new(&file);
        installer.arg("/UPDATE");
        if silent.unwrap_or(false) {
            installer.arg("/S");
        }
        if restart.unwrap_or(true) {
            installer.arg("/R");
        }
        installer.spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "android")]
    {
        app.state::<crate::android_updates::ApkInstaller>()
            .0
            .run_mobile_plugin::<serde_json::Value>("installApk", serde_json::json!({"path":file}))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    app.opener()
        .open_path(file.to_string_lossy().as_ref(), None::<String>)
        .map_err(|e| e.to_string())?;
    Ok(())
}
/// A verified new portable binary completes replacement only after the old process releases its executable.
#[cfg(target_os = "windows")]
pub fn finish_portable_update() -> Result<bool, String> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|s| s != "--finish-portable-update") {
        return Ok(false);
    }
    let target = std::path::PathBuf::from(args.get(2).ok_or("Missing update target")?);
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let root = current.parent().ok_or("Missing update directory")?;
    let record: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("pending.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if record["target"].as_str() != target.to_str()
        || root.file_name().is_none_or(|s| s != "updates")
    {
        return Err("Invalid portable replacement request".into());
    }
    let bytes = fs::read(&current).map_err(|e| e.to_string())?;
    if Some(format!("{:x}", Sha256::digest(&bytes)).as_str()) != record["sha256"].as_str() {
        return Err("Portable helper hash mismatch".into());
    }
    let staged = target.with_extension("updating");
    fs::write(&staged, bytes).map_err(|e| e.to_string())?;
    for _ in 0..120 {
        if fs::copy(&target, target.with_extension("previous.exe")).is_ok()
            && fs::rename(&staged, &target).is_ok()
        {
            if !args.iter().any(|arg| arg == "--no-restart") {
                std::process::Command::new(&target)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            let _ = fs::remove_file(root.join("pending.json"));
            return Ok(true);
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    Err("Portable executable remained locked; previous executable was retained".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cached_artifacts_require_matching_bytes_not_just_a_filename() {
        let directory =
            std::env::temp_dir().join(format!("zhinexus-update-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("artifact.exe");
        fs::write(&file, b"verified bytes").unwrap();
        let expected = format!("{:x}", Sha256::digest(b"verified bytes"));
        assert!(verify_digest(&file, &expected).is_ok());
        fs::write(&file, b"modified bytes").unwrap();
        assert!(verify_digest(&file, &expected).is_err());
        fs::remove_file(&file).unwrap();
        assert!(verify_digest(&file, &expected).is_err());
        fs::remove_dir(&directory).unwrap();
    }
}
