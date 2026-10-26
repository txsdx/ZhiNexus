//! Verified post-exit storage relocation, preserving source data and previous target directories through atomic commits.
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::Manager;
/// Stable identity for standalone helpers and per-user OS integration.
pub const APP_ID: &str = "io.github.txsdx.zhinexus";
/// A process-owned lock prevents another instance or a relocation helper from copying a live database.
pub struct StorageLease {
    pub _file: fs::File,
}
/// A reviewed relocation plan is constrained to this executable's two supported storage roots.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPlan {
    pub id: String,
    pub source: PathBuf,
    pub target: PathBuf,
    pub executable: PathBuf,
    pub portable: bool,
    pub bytes: u64,
    pub files: u64,
    pub target_exists: bool,
}
/// Select the normal root without requiring a running Tauri instance in the post-exit helper.
fn system_root() -> Result<PathBuf, String> {
    Ok(dirs::data_dir()
        .ok_or("No system data directory")?
        .join(APP_ID))
}
/// Share a user-specific temporary coordination lock between normal and portable launches.
pub fn transition_lock() -> Result<fs::File, String> {
    let user = format!(
        "{:x}",
        Sha256::digest(
            dirs::home_dir()
                .ok_or("No user directory")?
                .to_string_lossy()
                .as_bytes()
        )
    );
    let path = std::env::temp_dir().join(format!("{APP_ID}-{}.transition", &user[..16]));
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    fs2::FileExt::lock_exclusive(&file).map_err(|e| e.to_string())?;
    Ok(file)
}
/// Hold this file for the whole native application lifetime; the helper waits for an actual release.
pub fn lease(root: &Path, wait: bool) -> Result<StorageLease, String> {
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(".instance.lock"))
        .map_err(|e| e.to_string())?;
    if wait {
        fs2::FileExt::lock_exclusive(&file)
    } else {
        fs2::FileExt::try_lock_exclusive(&file)
    }
    .map_err(|_| "该数据目录正在被其他进程使用 / Data directory is in use")?;
    Ok(StorageLease { _file: file })
}
/// Count regular files while rejecting traversal through symlinks; transient locks and pending helper records are excluded.
fn inventory(root: &Path) -> Result<(u64, u64), String> {
    let mut bytes = 0;
    let mut count = 0;
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name == ".instance.lock"
            || name == "migration-plans"
            || name.to_string_lossy().starts_with(".pending-")
        {
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            return Err("迁移目录包含符号链接，请先移除链接 / Symlinks are not migrated".into());
        }
        if kind.is_dir() {
            let (b, n) = inventory(&entry.path())?;
            bytes += b;
            count += n;
        } else if kind.is_file() {
            bytes += entry.metadata().map_err(|e| e.to_string())?.len();
            count += 1;
        }
    }
    Ok((bytes, count))
}
/// Validate target hierarchy and available space before any database is closed or any marker changes.
fn preflight(source: &Path, target: &Path, bytes: u64) -> Result<(), String> {
    if target.is_symlink() {
        return Err("Target directory must not be a symlink".into());
    }
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    let parent = target
        .parent()
        .ok_or("Missing target parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = parent.join(target.file_name().ok_or("Invalid target")?);
    if source == target || target.starts_with(&source) || source.starts_with(&target) {
        return Err("数据目录不可相互嵌套 / Storage roots must not overlap".into());
    }
    if fs2::available_space(&parent).map_err(|e| e.to_string())? < bytes.saturating_add(1024 * 1024)
    {
        return Err("目标磁盘空间不足 / Insufficient target disk space".into());
    }
    let probe = parent.join(format!(".zhinexus-write-{}", uuid::Uuid::new_v4()));
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|_| {
            "运行目录不可写，请将程序放到可写目录后迁移 / Executable directory is not writable"
        })?
        .sync_all()
        .map_err(|e| e.to_string())?;
    fs::remove_file(probe).map_err(|e| e.to_string())?;
    Ok(())
}
/// Preview only the current executable's other mode; no arbitrary destination path is accepted.
#[tauri::command]
pub fn storage_migration_plan(
    app: tauri::AppHandle,
    portable: bool,
) -> Result<MigrationPlan, String> {
    let current = app.state::<crate::paths::StorageLocation>();
    if current.portable == portable {
        return Err("已经使用该模式 / Already using this storage mode".into());
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let target = if portable {
        executable
            .parent()
            .ok_or("No executable directory")?
            .join("_data")
    } else {
        app.path().app_data_dir().map_err(|e| e.to_string())?
    };
    let (bytes, files) = inventory(&current.root)?;
    preflight(&current.root, &target, bytes)?;
    let plan = MigrationPlan {
        id: uuid::Uuid::new_v4().to_string(),
        source: current.root.clone(),
        target_exists: target.exists(),
        target,
        executable,
        portable,
        bytes,
        files,
    };
    let dir = current.root.join("recovery/migration-plans");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(
        dir.join(format!("{}.json", plan.id)),
        serde_json::to_vec(&plan).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(plan)
}
/// Spawn the verified standalone helper, then release SQL/WebView resources by exiting this process.
#[tauri::command]
pub fn launch_storage_migration(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&id)
        .map_err(|_| "Invalid migration token")?
        .to_string();
    let path = app
        .state::<crate::paths::StorageLocation>()
        .root
        .join("recovery/migration-plans")
        .join(format!("{id}.json"));
    let plan: MigrationPlan = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
        .map_err(|_| "Invalid migration plan")?;
    if plan.source != app.state::<crate::paths::StorageLocation>().root
        || plan.executable != std::env::current_exe().map_err(|e| e.to_string())?
    {
        return Err("Migration identity mismatch".into());
    }
    let (bytes, _) = inventory(&plan.source)?;
    preflight(&plan.source, &plan.target, bytes)?;
    std::process::Command::new(&plan.executable)
        .arg("--finish-storage-migration")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    crate::desktop::mark_exiting(&app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(200)).await;
        handle.exit(0);
    });
    Ok(())
}
/// Stream a regular file, then verify the bytes read back from the destination before committing any directory rename.
fn copy_verified(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name == ".instance.lock"
            || name == "migration-plans"
            || name.to_string_lossy().starts_with(".pending-")
        {
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let destination = target.join(name);
        if kind.is_symlink() {
            return Err("Symbolic links are not migrated".into());
        }
        if kind.is_dir() {
            copy_verified(&entry.path(), &destination)?;
        } else if kind.is_file() {
            let mut input = fs::File::open(entry.path()).map_err(|e| e.to_string())?;
            let mut output = fs::File::create(&destination).map_err(|e| e.to_string())?;
            let mut digest = Sha256::new();
            let mut buffer = [0u8; 65536];
            loop {
                let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                digest.update(&buffer[..n]);
                output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            }
            output.sync_all().map_err(|e| e.to_string())?;
            drop(output);
            let expected = digest.finalize();
            let mut actual = Sha256::new();
            let mut file = fs::File::open(&destination).map_err(|e| e.to_string())?;
            loop {
                let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                actual.update(&buffer[..n]);
            }
            if expected[..] != actual.finalize()[..] {
                return Err("Migration SHA-256 mismatch; original retained".into());
            }
        }
    }
    Ok(())
}
/// Complete a plan after the original process exits; failures retain source data and all previous targets.
fn complete(plan: &MigrationPlan) -> Result<serde_json::Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let normal = system_root()?;
    complete_at(plan, &exe, &normal)
}
/// Execute the same constrained transaction for production roots or isolated native filesystem tests.
fn complete_at(
    plan: &MigrationPlan,
    exe: &Path,
    normal: &Path,
) -> Result<serde_json::Value, String> {
    let portable = exe
        .parent()
        .ok_or("Missing executable directory")?
        .join("_data");
    let (source, target): (&Path, &Path) = if plan.portable {
        (normal, &portable)
    } else {
        (&portable, normal)
    };
    if plan.executable != exe || plan.source != source || plan.target != target {
        return Err("Invalid migration roots".into());
    }
    let _transition = transition_lock()?;
    let end = Instant::now() + Duration::from_secs(120);
    let source_lease = loop {
        match lease(source, false) {
            Ok(lock) => break lock,
            Err(error) => {
                if Instant::now() > end {
                    return Err(error);
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    };
    let marker = exe.parent().unwrap().join("portable");
    if marker.is_file() == plan.portable {
        return Err("Portable marker changed while migration was pending".into());
    }
    preflight(source, target, inventory(source)?.0)?;
    let staging = target.with_file_name(format!(
        "{}.migration-{}",
        target.file_name().unwrap().to_string_lossy(),
        plan.id
    ));
    if staging.exists() {
        return Err("保留了上次迁移暂存目录，请重新生成迁移计划 / Previous staging retained; create a new plan".into());
    }
    copy_verified(source, &staging)?;
    if !tauri::async_runtime::block_on(crate::storage::valid(&staging.join("zhinexus.db"))) {
        return Err(
            "Copied SQLite database failed integrity verification; original retained".into(),
        );
    }
    let mut backup = None;
    let target_lease = if target.exists() {
        Some(lease(target, false)?)
    } else {
        None
    };
    if target.exists() {
        let path = target.with_file_name(format!(
            "{}.before-{}",
            target.file_name().unwrap().to_string_lossy(),
            plan.id
        ));
        fs::rename(target, &path).map_err(|e| e.to_string())?;
        backup = Some(path);
    }
    if let Err(error) = fs::rename(&staging, target) {
        if let Some(path) = &backup {
            let _ = fs::rename(path, target);
        }
        return Err(error.to_string());
    }
    let switch = if plan.portable {
        fs::File::create(&marker).and_then(|file| file.sync_all())
    } else {
        fs::rename(
            &marker,
            source
                .join("recovery")
                .join(format!("portable-marker-{}", plan.id)),
        )
    };
    if let Err(error) = switch {
        return Err(format!(
            "Data copied; original mode retained because marker update failed: {error}"
        ));
    }
    let report = serde_json::json!({"success":true,"source":source,"target":target,"retainedTarget":backup,"id":plan.id});
    fs::write(
        target.join("recovery/migration-result.json"),
        serde_json::to_vec(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    drop(target_lease);
    drop(source_lease);
    drop(_transition);
    Ok(report)
}
/// Handle only an app-owned reviewed plan before normal Tauri/single-instance initialization.
pub fn finish_storage_migration() -> Result<bool, String> {
    let args: Vec<_> = std::env::args_os().collect();
    if args
        .get(1)
        .is_none_or(|v| v != "--finish-storage-migration")
    {
        return Ok(false);
    }
    let path = PathBuf::from(args.get(2).ok_or("Missing migration plan")?);
    let plan: MigrationPlan = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
        .map_err(|_| "Invalid migration plan")?;
    if uuid::Uuid::parse_str(&plan.id).is_err()
        || path
            != plan
                .source
                .join("recovery/migration-plans")
                .join(format!("{}.json", plan.id))
    {
        return Err("Invalid migration plan identity".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let normal = system_root()?;
    let portable = exe
        .parent()
        .ok_or("Missing executable directory")?
        .join("_data");
    let (source, target) = if plan.portable {
        (&normal, &portable)
    } else {
        (&portable, &normal)
    };
    if plan.executable != exe || &plan.source != source || &plan.target != target {
        return Err("Invalid migration roots".into());
    }
    let result = complete(&plan);
    if let Err(error) = &result {
        let _ = fs::write(
            plan.source.join("recovery/migration-result.json"),
            serde_json::to_vec(&serde_json::json!({"success":false,"message":error,"id":plan.id}))
                .unwrap_or_default(),
        );
    }
    std::process::Command::new(std::env::current_exe().map_err(|e| e.to_string())?)
        .spawn()
        .map_err(|e| e.to_string())?;
    result.map(|_| true)
}
#[cfg(test)]
mod tests {
    use super::*;
    /// Nested roots are rejected and verified copies preserve every regular file without modifying their sources.
    #[test]
    fn verified_copy_and_overlap_rejection() {
        let root =
            std::env::temp_dir().join(format!("zhinexus-migration-test-{}", uuid::Uuid::new_v4()));
        let source = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("nested/note"), b"preserve my knowledge").unwrap();
        assert!(preflight(&source, &source.join("child"), 0).is_err());
        copy_verified(&source, &target).unwrap();
        assert_eq!(
            fs::read(target.join("nested/note")).unwrap(),
            fs::read(source.join("nested/note")).unwrap()
        );
        fs::remove_dir_all(root).unwrap();
    }
    /// Both directions preserve the complete source and rename the previous target before changing the marker.
    #[test]
    fn round_trip_preserves_sources_and_previous_target() {
        use sqlx::Connection;
        let root =
            std::env::temp_dir().join(format!("zhinexus-roundtrip-{}", uuid::Uuid::new_v4()));
        let normal = root.join("user-data");
        let bin = root.join("bin");
        let portable = bin.join("_data");
        let exe = bin.join("ZhiNexus.exe");
        fs::create_dir_all(normal.join("recovery")).unwrap();
        fs::create_dir_all(&portable).unwrap();
        fs::write(portable.join("previous-target"), b"must retain").unwrap();
        tauri::async_runtime::block_on(async {
            let mut connection = sqlx::SqliteConnection::connect_with(
                &sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(normal.join("zhinexus.db"))
                    .create_if_missing(true),
            )
            .await
            .unwrap();
            sqlx::query("CREATE TABLE notes(value TEXT)")
                .execute(&mut connection)
                .await
                .unwrap();
            sqlx::query("INSERT INTO notes VALUES ('preserved')")
                .execute(&mut connection)
                .await
                .unwrap();
            connection.close().await.unwrap();
        });
        let make = |portable_mode: bool| MigrationPlan {
            id: uuid::Uuid::new_v4().to_string(),
            source: if portable_mode {
                normal.clone()
            } else {
                portable.clone()
            },
            target: if portable_mode {
                portable.clone()
            } else {
                normal.clone()
            },
            executable: exe.clone(),
            portable: portable_mode,
            bytes: 0,
            files: 0,
            target_exists: true,
        };
        let report = complete_at(&make(true), &exe, &normal).unwrap();
        assert!(bin.join("portable").is_file());
        assert!(normal.join("zhinexus.db").is_file());
        assert_eq!(
            fs::read(
                PathBuf::from(report["retainedTarget"].as_str().unwrap()).join("previous-target")
            )
            .unwrap(),
            b"must retain"
        );
        fs::write(portable.join("added-after-migration"), b"new data").unwrap();
        complete_at(&make(false), &exe, &normal).unwrap();
        assert!(!bin.join("portable").exists());
        assert_eq!(
            fs::read(normal.join("added-after-migration")).unwrap(),
            b"new data"
        );
        assert!(portable.join("added-after-migration").exists());
        fs::remove_dir_all(root).unwrap();
    }
    /// A failed SQLite check cannot replace an existing target or enable portable mode.
    #[test]
    fn corrupt_copy_does_not_switch_or_overwrite() {
        let root = std::env::temp_dir().join(format!(
            "zhinexus-rejected-migration-{}",
            uuid::Uuid::new_v4()
        ));
        let normal = root.join("user");
        let bin = root.join("bin");
        let target = bin.join("_data");
        fs::create_dir_all(normal.join("recovery")).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(normal.join("zhinexus.db"), b"damaged SQLite").unwrap();
        fs::write(target.join("retained"), b"previous data").unwrap();
        let exe = bin.join("ZhiNexus.exe");
        let plan = MigrationPlan {
            id: uuid::Uuid::new_v4().to_string(),
            source: normal.clone(),
            target: target.clone(),
            executable: exe.clone(),
            portable: true,
            bytes: 0,
            files: 0,
            target_exists: true,
        };
        assert!(complete_at(&plan, &exe, &normal).is_err());
        assert_eq!(fs::read(target.join("retained")).unwrap(), b"previous data");
        assert_eq!(
            fs::read(normal.join("zhinexus.db")).unwrap(),
            b"damaged SQLite"
        );
        assert!(!bin.join("portable").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
