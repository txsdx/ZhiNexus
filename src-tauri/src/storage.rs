//! Verified rolling SQLite checkpoints and recovery that preserves damaged databases for diagnosis.
use sha2::{Digest, Sha256};
use sqlx::{Connection, Row, SqliteConnection};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

/// Return only application-owned paths; callers cannot request arbitrary filesystem locations.
fn paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let dir = app.state::<crate::paths::StorageLocation>().root.clone();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let recovery = dir.join("recovery");
    fs::create_dir_all(&recovery).map_err(|e| e.to_string())?;
    Ok((dir.join("zhinexus.db"), recovery))
}
/// Check a standalone SQLite file without creating or repairing it in place.
async fn valid(path: &Path) -> bool {
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .read_only(true);
    let Ok(mut connection) = SqliteConnection::connect_with(&options).await else {
        return false;
    };
    let result = sqlx::query("PRAGMA integrity_check")
        .fetch_all(&mut connection)
        .await;
    let _ = connection.close().await;
    matches!(result,Ok(rows) if rows.len()==1&&rows[0].get::<String,_>(0)=="ok")
}
/// Generate a collision-resistant filename for retained recovery generations.
fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
/// List checkpoint generations newest first; temporary and quarantined files are excluded.
fn generations(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files: Vec<_> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("checkpoint-") && n.ends_with(".sqlite"))
        })
        .collect();
    files.sort();
    files.reverse();
    Ok(files)
}
/// Recover from a SHA-256 verified checkpoint, retaining the original database and any WAL sidecars.
async fn recover(main: &Path, dir: &Path) -> Result<String, String> {
    for candidate in generations(dir)? {
        let Ok(bytes) = fs::read(&candidate) else {
            continue;
        };
        let digest = format!("{:x}", Sha256::digest(&bytes));
        let expected = fs::read_to_string(candidate.with_extension("sha256")).unwrap_or_default();
        if digest != expected.trim() || !valid(&candidate).await {
            continue;
        }
        let quarantine = dir.join(format!("damaged-{}", stamp()));
        fs::create_dir_all(&quarantine).map_err(|e| e.to_string())?;
        for suffix in ["", "-wal", "-shm"] {
            let file = PathBuf::from(format!("{}{}", main.display(), suffix));
            if file.exists() {
                fs::rename(&file, quarantine.join(file.file_name().unwrap()))
                    .map_err(|e| e.to_string())?;
            }
        }
        fs::copy(&candidate, main).map_err(|e| e.to_string())?;
        return Ok(format!(
            "Recovered from {}; original retained in {}",
            candidate.file_name().unwrap().to_string_lossy(),
            quarantine.display()
        ));
    }
    Err("No verified recovery checkpoint exists; original database retained".into())
}
/// Detect physical corruption before the SQL plugin opens the application's database.
#[tauri::command]
pub async fn prepare_storage(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (main, dir) = paths(&app)?;
    if !main.exists() || valid(&main).await {
        return Ok(None);
    }
    recover(&main, &dir).await.map(Some)
}
/// Restore a checkpoint after the frontend has closed its SQL connection following logical validation failure.
#[tauri::command]
pub async fn recover_storage(app: tauri::AppHandle) -> Result<String, String> {
    let (main, dir) = paths(&app)?;
    recover(&main, &dir).await
}
/// Create a consistent standalone SQLite image and retain three verified generations.
#[tauri::command]
pub async fn checkpoint_storage(app: tauri::AppHandle) -> Result<(), String> {
    let (main, dir) = paths(&app)?;
    if !valid(&main).await {
        return Err("Cannot checkpoint a database failing integrity_check".into());
    }
    let target = dir.join(format!("checkpoint-{}.sqlite", stamp()));
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&main)
        .busy_timeout(std::time::Duration::from_secs(10));
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("VACUUM INTO ?")
        .bind(target.to_string_lossy().as_ref())
        .execute(&mut connection)
        .await
        .map_err(|e| e.to_string())?;
    connection.close().await.map_err(|e| e.to_string())?;
    if !valid(&target).await {
        return Err("Checkpoint integrity verification failed".into());
    }
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    fs::write(
        target.with_extension("sha256"),
        format!("{:x}", Sha256::digest(bytes)),
    )
    .map_err(|e| e.to_string())?;
    for old in generations(&dir)?.into_iter().skip(3) {
        let _ = fs::remove_file(old.with_extension("sha256"));
        let _ = fs::remove_file(old);
    }
    Ok(())
}

/// A durable journal record whose filename is always a verified, caller-independent hash identifier.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct StorageRecord {
    pub id: String,
    pub data: String,
}
/// Mirror append-only records outside SQLite before acknowledging a committed mutation.
#[tauri::command]
pub fn journal_storage(
    app: tauri::AppHandle,
    kind: String,
    records: Vec<StorageRecord>,
) -> Result<(), String> {
    if !["events", "blobs", "meta"].contains(&kind.as_str()) {
        return Err("Invalid journal kind".into());
    }
    let (_, root) = paths(&app)?;
    let dir = root.join("journal").join(&kind);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for record in records {
        if record.id.len() != 64
            || !record.id.bytes().all(|c| c.is_ascii_hexdigit())
            || record.data.len() > 32 * 1024 * 1024
        {
            return Err("Invalid journal record".into());
        }
        let path = dir.join(format!("{}.json", record.id));
        if kind != "meta" && path.exists() {
            if fs::read_to_string(&path).map_err(|e| e.to_string())? != record.data {
                return Err("Immutable journal record differs".into());
            }
            continue;
        }
        let temp = dir.join(format!(".pending-{}", stamp()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|e| e.to_string())?;
        use std::io::Write;
        file.write_all(record.data.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
/// Read recovery records without exposing filesystem selectors to the webview.
#[tauri::command]
pub fn read_storage_journal(
    app: tauri::AppHandle,
    kind: String,
) -> Result<Vec<StorageRecord>, String> {
    if !["events", "blobs", "meta"].contains(&kind.as_str()) {
        return Err("Invalid journal kind".into());
    }
    let (_, root) = paths(&app)?;
    let dir = root.join("journal").join(kind);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut result = vec![];
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if id.len() != 64
            || !id.bytes().all(|c| c.is_ascii_hexdigit())
            || path.extension().is_none_or(|s| s != "json")
        {
            continue;
        }
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        result.push(StorageRecord {
            id: id.into(),
            data,
        });
    }
    Ok(result)
}
