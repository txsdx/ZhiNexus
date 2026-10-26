//! Conservative recovery cleanup: remove journal redundancy only when three verified checkpoints retain identical records.
use crate::storage::{generations, paths, valid};
use sha2::{Digest, Sha256};
use sqlx::{Connection, Row, SqliteConnection};
use std::{
    fs,
    path::Path,
    time::{Duration, SystemTime},
};
/// Actual reclaimed file count and bytes; authoritative history and damaged originals are retained.
#[derive(Default, serde::Serialize)]
pub struct CleanupReport {
    pub files: u64,
    pub bytes: u64,
}
/// Remove a regular owned file only; links and directories are never followed.
fn remove_file(path: &Path, report: &mut CleanupReport) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.file_type().is_file() {
        return Ok(());
    }
    fs::remove_file(path).map_err(|e| e.to_string())?;
    report.files += 1;
    report.bytes += metadata.len();
    Ok(())
}
/// Read a full checkpoint only after both its sidecar digest and SQLite integrity have passed.
async fn checkpoint(path: &Path) -> Result<Option<SqliteConnection>, String> {
    if fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let digest = format!("{:x}", Sha256::digest(bytes));
    if fs::read_to_string(path.with_extension("sha256"))
        .unwrap_or_default()
        .trim()
        != digest
        || !valid(path).await
    {
        return Ok(None);
    }
    SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new()
            .filename(path)
            .read_only(true),
    )
    .await
    .map(Some)
    .map_err(|e| e.to_string())
}
/// The oldest retained generation must cover a record too, so damage to the newest cannot lose pruned journal data.
async fn cleanup(dir: &Path) -> Result<CleanupReport, String> {
    for folder in [dir.to_path_buf(), dir.join("journal")] {
        if folder.exists()
            && fs::symlink_metadata(&folder)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
        {
            return Err("Recovery folder is a symlink; cleanup skipped".into());
        }
    }
    let mut report = CleanupReport::default();
    let mut copies = Vec::new();
    for path in generations(dir)?.into_iter().take(3) {
        if let Some(db) = checkpoint(&path).await? {
            copies.push(db);
        }
    }
    for kind in ["events", "blobs", "meta"] {
        let folder = dir.join("journal").join(kind);
        if !folder.exists() {
            continue;
        }
        if fs::symlink_metadata(&folder)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Journal folder is a symlink; cleanup skipped".into());
        }
        for entry in fs::read_dir(&folder).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if !metadata.file_type().is_file() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if name.starts_with(".pending-")
                && metadata
                    .modified()
                    .ok()
                    .and_then(|t| SystemTime::now().duration_since(t).ok())
                    .is_some_and(|age| age > Duration::from_secs(86400))
            {
                remove_file(&path, &mut report)?;
                continue;
            }
            let Some(id) = name.strip_suffix(".json") else {
                continue;
            };
            if copies.len() != 3
                || kind == "meta"
                || id.len() != 64
                || !id.bytes().all(|b| b.is_ascii_hexdigit())
            {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(record) = serde_json::from_str::<serde_json::Value>(&raw) else {
                continue;
            };
            let mut covered = true;
            for copy in &mut copies {
                let same = if kind == "events" {
                    let row = sqlx::query("SELECT json FROM events WHERE hash=?")
                        .bind(id)
                        .fetch_optional(&mut *copy)
                        .await
                        .map_err(|e| e.to_string())?;
                    row.and_then(|r| {
                        serde_json::from_str::<serde_json::Value>(&r.get::<String, _>(0)).ok()
                    })
                    .is_some_and(|v| v == record)
                } else {
                    let row = sqlx::query("SELECT mime,data FROM blobs WHERE hash=?")
                        .bind(id)
                        .fetch_optional(&mut *copy)
                        .await
                        .map_err(|e| e.to_string())?;
                    row.is_some_and(|r|record==serde_json::json!({"mime":r.get::<String,_>(0),"data":r.get::<String,_>(1)}))
                };
                if !same {
                    covered = false;
                    break;
                }
            }
            // Re-check bytes immediately before removal in case a concurrent writer replaced the file.
            if covered && fs::read_to_string(&path).ok().as_deref() == Some(&raw) {
                remove_file(&path, &mut report)?;
            }
        }
    }
    for copy in copies {
        copy.close().await.map_err(|e| e.to_string())?;
    }
    Ok(report)
}
/// Called only after the frontend has verified matching cloud/local roots and forced a fresh checkpoint.
#[tauri::command]
pub async fn cleanup_storage(app: tauri::AppHandle) -> Result<CleanupReport, String> {
    let (_, dir) = paths(&app)?;
    cleanup(&dir).await
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Never walk a redirected journal tree while removing expired temporary files.
    #[cfg(unix)]
    #[tokio::test]
    async fn cleanup_refuses_redirected_journal() {
        let root =
            std::env::temp_dir().join(format!("zhinexus-cleanup-link-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("outside/events")).unwrap();
        std::os::unix::fs::symlink(root.join("outside"), root.join("journal")).unwrap();
        let retained = root.join("outside/events/.pending-example");
        fs::write(&retained, "retain").unwrap();
        assert!(cleanup(&root).await.is_err());
        assert!(retained.exists());
        fs::remove_dir_all(root).unwrap();
    }
    /// A newer checkpoint alone cannot justify deleting the only copy of a journal record.
    #[tokio::test]
    async fn cleanup_requires_coverage_in_all_three_checkpoints() {
        let root = std::env::temp_dir().join(format!("zhinexus-cleanup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("journal/events")).unwrap();
        let id = "a".repeat(64);
        let record = serde_json::json!({"hash":id,"op":{"seq":1}}).to_string();
        let journal = root.join(format!("journal/events/{id}.json"));
        fs::write(&journal, &record).unwrap();
        for n in 0..3 {
            let path = root.join(format!("checkpoint-{n}.sqlite"));
            let mut db = SqliteConnection::connect_with(
                &sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
            sqlx::query("CREATE TABLE events(hash TEXT PRIMARY KEY,json TEXT)")
                .execute(&mut db)
                .await
                .unwrap();
            sqlx::query("CREATE TABLE blobs(hash TEXT PRIMARY KEY,mime TEXT,data TEXT)")
                .execute(&mut db)
                .await
                .unwrap();
            if n > 0 {
                sqlx::query("INSERT INTO events VALUES (?,?)")
                    .bind(&id)
                    .bind(&record)
                    .execute(&mut db)
                    .await
                    .unwrap();
            }
            db.close().await.unwrap();
            fs::write(
                path.with_extension("sha256"),
                format!("{:x}", Sha256::digest(fs::read(&path).unwrap())),
            )
            .unwrap();
        }
        assert_eq!(cleanup(&root).await.unwrap().files, 0);
        assert!(journal.exists());
        let first = root.join("checkpoint-0.sqlite");
        let mut db = SqliteConnection::connect_with(
            &sqlx::sqlite::SqliteConnectOptions::new().filename(&first),
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO events VALUES (?,?)")
            .bind(&id)
            .bind(&record)
            .execute(&mut db)
            .await
            .unwrap();
        db.close().await.unwrap();
        fs::write(
            first.with_extension("sha256"),
            format!("{:x}", Sha256::digest(fs::read(&first).unwrap())),
        )
        .unwrap();
        assert_eq!(cleanup(&root).await.unwrap().files, 1);
        assert!(!journal.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
