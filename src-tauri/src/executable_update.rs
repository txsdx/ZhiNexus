//! Stage and atomically replace an executable without touching its data directory or running an installer.
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

/// Same-directory staging enables atomic replacement; a verified backup stays in the update cache.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Replacement {
    pub target: PathBuf,
    pub staged: PathBuf,
    pub backup: PathBuf,
    pub old_sha256: String,
    pub new_sha256: String,
}
/// Invalid bytes/state must stop immediately; an OS rename failure may be retried while the old process exits.
#[derive(Debug)]
pub enum CommitError {
    Invalid(String),
    Locked(std::io::Error),
}
impl std::fmt::Display for CommitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "{message}"),
            Self::Locked(error) => write!(f, "{error}"),
        }
    }
}

/// Hash regular, bounded files only; links must never redirect replacement or backup operations.
pub fn digest(file: &Path) -> Result<String, String> {
    let meta = fs::symlink_metadata(file).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 512 * 1024 * 1024 {
        return Err("Update file is not a bounded regular file".into());
    }
    let mut input = fs::File::open(file).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

/// Copy to a newly allocated file and flush it before it can replace an executable.
fn copy_new(source: &Path, destination: &Path, expected: &str) -> Result<(), String> {
    let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|e| e.to_string())?;
    let copied = std::io::copy(&mut input, &mut output).map_err(|e| e.to_string());
    let result = copied
        .and_then(|_| output.flush().map_err(|e| e.to_string()))
        .and_then(|_| output.sync_all().map_err(|e| e.to_string()));
    drop(output);
    if let Err(error) = result {
        let _ = fs::remove_file(destination);
        return Err(error);
    }
    if digest(destination)? != expected {
        let _ = fs::remove_file(destination);
        return Err("Executable copy SHA-256 mismatch".into());
    }
    Ok(())
}

/// Probe target-directory access and preserve old bytes before the running app exits.
pub fn prepare(
    source: &Path,
    target: &Path,
    cache: &Path,
    expected: &str,
) -> Result<Replacement, String> {
    if source == target || digest(source)? != expected {
        return Err("Invalid replacement source".into());
    }
    let old_sha256 = digest(target)?;
    let nonce = uuid::Uuid::new_v4();
    let parent = target.parent().ok_or("Missing executable directory")?;
    let staged = parent.join(format!(".zhinexus-update-{nonce}.tmp"));
    let backup = cache.join(format!("previous-{nonce}.bin"));
    copy_new(source, &staged, expected)?;
    if let Err(error) = copy_new(target, &backup, &old_sha256) {
        let _ = fs::remove_file(&staged);
        return Err(error);
    }
    Ok(Replacement {
        target: target.into(),
        staged,
        backup,
        old_sha256,
        new_sha256: expected.into(),
    })
}

/// Validate a persisted handoff before the helper accepts any path from it.
pub fn validate(
    plan: &Replacement,
    target: &Path,
    cache: &Path,
    expected: &str,
) -> Result<(), String> {
    let target_parent = target
        .parent()
        .ok_or("Missing executable directory")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let cache = cache.canonicalize().map_err(|e| e.to_string())?;
    if plan.target != target
        || plan.new_sha256 != expected
        || plan.staged.parent().and_then(|p| p.canonicalize().ok()) != Some(target_parent)
        || plan.backup.parent().and_then(|p| p.canonicalize().ok()) != Some(cache)
        || !plan.staged.file_name().is_some_and(|n| {
            n.to_string_lossy().starts_with(".zhinexus-update-")
                && n.to_string_lossy().ends_with(".tmp")
        })
        || !plan.backup.file_name().is_some_and(|n| {
            n.to_string_lossy().starts_with("previous-") && n.to_string_lossy().ends_with(".bin")
        })
    {
        return Err("Invalid executable replacement handoff".into());
    }
    Ok(())
}

/// Reject stale targets and corrupt staging/backups; a failed rename leaves the old executable intact.
pub fn commit(plan: &Replacement) -> Result<(), CommitError> {
    if digest(&plan.target).map_err(CommitError::Invalid)? != plan.old_sha256 {
        return Err(CommitError::Invalid(
            "Executable changed while the update was pending".into(),
        ));
    }
    if digest(&plan.staged).map_err(CommitError::Invalid)? != plan.new_sha256
        || digest(&plan.backup).map_err(CommitError::Invalid)? != plan.old_sha256
    {
        return Err(CommitError::Invalid(
            "Executable staging or backup SHA-256 mismatch".into(),
        ));
    }
    fs::rename(&plan.staged, &plan.target).map_err(CommitError::Locked)
}

/// Restore the verified old file if the new process cannot be launched.
pub fn rollback(plan: &Replacement) -> Result<(), String> {
    if digest(&plan.backup)? != plan.old_sha256 {
        return Err("Executable backup SHA-256 mismatch".into());
    }
    copy_new(&plan.backup, &plan.staged, &plan.old_sha256)?;
    fs::rename(&plan.staged, &plan.target).map_err(|e| e.to_string())
}

/// Remove only the helper's staging files when preparation or launch fails; user data is never included.
pub fn discard(plan: &Replacement) {
    let _ = fs::remove_file(&plan.staged);
    let _ = fs::remove_file(&plan.backup);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, PathBuf, PathBuf, PathBuf, String) {
        let root = std::env::temp_dir().join(format!("zhinexus-replace-{}", uuid::Uuid::new_v4()));
        let directory = root.join("程序 空格");
        let cache = root.join("system-data/updates");
        fs::create_dir_all(&directory).unwrap();
        fs::create_dir_all(&cache).unwrap();
        let target = directory.join("ZhiNexus.exe");
        let source = cache.join("new.exe");
        fs::write(&target, b"old executable").unwrap();
        fs::write(&source, b"new executable").unwrap();
        fs::write(root.join("system-data/knowledge.db"), b"keep data").unwrap();
        let hash = digest(&source).unwrap();
        (root, target, source, cache, hash)
    }
    #[test]
    fn replacement_preserves_data_and_backup_and_can_rollback() {
        let (root, target, source, cache, hash) = fixture();
        let p = prepare(&source, &target, &cache, &hash).unwrap();
        validate(&p, &target, &cache, &hash).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"old executable");
        commit(&p).unwrap();
        assert_eq!(digest(&target).unwrap(), hash);
        assert_eq!(
            fs::read(root.join("system-data/knowledge.db")).unwrap(),
            b"keep data"
        );
        rollback(&p).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"old executable");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn stale_target_or_corrupt_payload_cannot_overwrite_existing_bytes() {
        for corrupt in [false, true] {
            let (root, target, source, cache, hash) = fixture();
            let p = prepare(&source, &target, &cache, &hash).unwrap();
            if corrupt {
                fs::write(&p.staged, b"tampered").unwrap();
            } else {
                fs::write(&target, b"newer user executable").unwrap();
            }
            let before = fs::read(&target).unwrap();
            assert!(commit(&p).is_err());
            assert_eq!(fs::read(&target).unwrap(), before);
            fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn corrupt_download_and_redirected_paths_fail_without_changing_target() {
        let (root, target, source, cache, hash) = fixture();
        assert!(prepare(&source, &target, &cache, &"0".repeat(64)).is_err());
        let mut p = prepare(&source, &target, &cache, &hash).unwrap();
        p.staged = root.join("knowledge.db");
        assert!(validate(&p, &target, &cache, &hash).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old executable");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn inaccessible_backup_location_aborts_preparation_without_leaving_staging_or_changing_target()
    {
        let (root, target, source, _cache, hash) = fixture();
        let invalid = root.join("not-a-directory");
        fs::write(&invalid, b"keep").unwrap();
        assert!(prepare(&source, &target, &invalid, &hash).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old executable");
        assert!(!fs::read_dir(target.parent().unwrap())
            .unwrap()
            .flatten()
            .any(|f| f
                .file_name()
                .to_string_lossy()
                .starts_with(".zhinexus-update-")));
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn locked_windows_target_is_preserved_then_replaced_after_release() {
        use std::os::windows::fs::OpenOptionsExt;
        let (root, target, source, cache, hash) = fixture();
        let p = prepare(&source, &target, &cache, &hash).unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&target)
            .unwrap();
        assert!(commit(&p).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old executable");
        drop(lock);
        commit(&p).unwrap();
        assert_eq!(digest(&target).unwrap(), hash);
        fs::remove_dir_all(root).unwrap();
    }
}
