//! Application data-root selection: an executable-adjacent marker enables self-contained portable storage.
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

/// One immutable root is selected for the process so removing a marker while running cannot split writes.
pub struct StorageLocation {
    pub root: PathBuf,
    pub portable: bool,
}
/// Select a portable folder only when a regular marker file exists beside a desktop executable.
pub fn select_root(executable: &Path, system_root: &Path, desktop: bool) -> StorageLocation {
    let parent = executable.parent().unwrap_or(system_root);
    let portable = desktop && parent.join("portable").is_file();
    StorageLocation {
        root: if portable {
            parent.join("_data")
        } else {
            system_root.to_path_buf()
        },
        portable,
    }
}
/// Initialize the root before creating the webview or opening any application database.
pub fn initialize(app: &tauri::AppHandle) -> Result<StorageLocation, Box<dyn std::error::Error>> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let _transition = crate::migration::transition_lock()?;
    let executable = std::env::current_exe()?;
    let system = app.path().app_data_dir()?;
    let location = select_root(
        &executable,
        &system,
        cfg!(not(any(target_os = "android", target_os = "ios"))),
    );
    fs::create_dir_all(&location.root)?;
    if !location.portable {
        let previous = app.path().app_config_dir()?;
        if previous != location.root
            && previous.join("zhinexus.db").is_file()
            && !location.root.join("zhinexus.db").exists()
        {
            copy_tree(&previous, &location.root)?;
        }
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    app.manage(crate::migration::lease(&location.root, false)?);
    Ok(location)
}
/// Preserve existing app-owned configuration when moving the default root from config to app-data storage.
fn copy_tree(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        if entry.file_type()?.is_symlink() {
            continue;
        }
        let destination = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &destination)?;
        } else if !destination.exists() {
            fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}
/// Return the selected storage mode to the frontend; no caller-supplied file paths are accepted.
#[tauri::command]
pub fn storage_configuration(app: tauri::AppHandle) -> serde_json::Value {
    let location = app.state::<StorageLocation>();
    let notice = fs::read(location.root.join("recovery/migration-result.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
    serde_json::json!({"canMigrate":cfg!(not(any(target_os="android",target_os="ios"))),"migrationNotice":notice,"root":location.root,"portable":location.portable,"connection":format!("sqlite:{}",location.root.join("zhinexus.db").display())})
}
#[cfg(test)]
mod tests {
    use super::*;
    /// A marker enables desktop portability, and removing it selects the normal system root again.
    #[test]
    fn portable_marker_controls_root() {
        let root =
            std::env::temp_dir().join(format!("zhinexus-portable-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        // Distribution names ending in protable must still default to the system data folder.
        let exe = root.join("ZhiNexus_protable.exe");
        let system = root.join("user-data");
        assert!(!select_root(&exe, &system, true).portable);
        fs::write(root.join("portable"), b"").unwrap();
        assert_eq!(select_root(&exe, &system, true).root, root.join("_data"));
        assert!(!select_root(&exe, &system, false).portable);
        fs::remove_dir_all(root).unwrap();
    }
}
