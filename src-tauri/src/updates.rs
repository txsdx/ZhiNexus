//! HTTPS, SHA-256 and optional Minisign verification before platform installers or portable replacement are launched.
use base64::Engine;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
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
/// Stream a bounded artifact into the selected data root; installers are never launched until verification passes.
#[tauri::command]
pub async fn install_platform_update(
    app: tauri::AppHandle,
    update: PlatformUpdate,
) -> Result<(), String> {
    let extension = validate(&update)?;
    let current = &app.package_info().version;
    if semver::Version::parse(&update.version).map_err(|e| e.to_string())? <= *current {
        return Err("Update is not newer than this platform version".into());
    }
    let root = app
        .state::<crate::paths::StorageLocation>()
        .root
        .join("updates");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let file = root.join(format!("{}.{extension}", update.sha256));
    let pending = file.with_extension("partial");
    let redirect = reqwest::redirect::Policy::custom(|attempt| {
        let url = attempt.url();
        let host = url.host_str().unwrap_or_default();
        if attempt.previous().len() > 8
            || url.scheme() != "https"
            || !(host == "github.com"
                || host == "release-assets.githubusercontent.com"
                || host == "objects.githubusercontent.com")
        {
            attempt.error("Untrusted update redirect")
        } else {
            attempt.follow()
        }
    });
    let client = crate::network::client(&app, std::time::Duration::from_secs(900))?
        .https_only(true)
        .redirect(redirect)
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&update.url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    if response.content_length().unwrap_or(0) > 512 * 1024 * 1024 {
        return Err("Update exceeds size limit".into());
    }
    let mut output = fs::File::create(&pending).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut size = 0usize;
    let mut stream = response.bytes_stream();
    while let Some(bytes) = stream.next().await {
        let bytes = bytes.map_err(|e| e.to_string())?;
        size += bytes.len();
        if size > 512 * 1024 * 1024 {
            return Err("Update exceeds size limit".into());
        }
        digest.update(&bytes);
        output.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    output.sync_all().map_err(|e| e.to_string())?;
    drop(output);
    if format!("{:x}", digest.finalize()) != update.sha256 {
        let _ = fs::remove_file(&pending);
        return Err("Update SHA-256 mismatch".into());
    }
    verify_publisher(&app, &pending, &update)?;
    fs::rename(&pending, &file).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    if matches!(update.kind, Kind::Portable) {
        let target = std::env::current_exe().map_err(|e| e.to_string())?;
        fs::write(
            root.join("pending.json"),
            serde_json::to_vec(&serde_json::json!({"target":target,"sha256":update.sha256}))
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::process::Command::new(&file)
            .arg("--finish-portable-update")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
        app.exit(0);
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
            std::process::Command::new(&target)
                .spawn()
                .map_err(|e| e.to_string())?;
            let _ = fs::remove_file(root.join("pending.json"));
            return Ok(true);
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    Err("Portable executable remained locked; previous executable was retained".into())
}
