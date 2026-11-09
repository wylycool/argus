use crate::editing::{self, EditingState, SaveFailure};
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri::Manager;
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub status: &'static str,
    pub version: Option<String>,
    pub writable: bool,
}
pub(crate) fn is_writable(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() || meta.permissions().readonly() {
        return false;
    }
    if path
        .parent()
        .and_then(|p| fs::metadata(p).ok())
        .is_none_or(|m| m.permissions().readonly())
    {
        return false;
    }
    fs::OpenOptions::new().write(true).open(path).is_ok()
}
fn probe(path: &Path, expected: &str) -> Result<Probe, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Probe {
                status: "missing",
                version: None,
                writable: false,
            })
        }
        Err(e) => return Err(format!("无法检查磁盘文件：{e}")),
    };
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file()
        || meta.len() > crate::MAX_DOCUMENT_SIZE
        || fs::canonicalize(path).map_err(|e| e.to_string())? != path
    {
        return Ok(Probe {
            status: "changed",
            version: None,
            writable: false,
        });
    }
    let mut bytes = Vec::new();
    file.take(crate::MAX_DOCUMENT_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > crate::MAX_DOCUMENT_SIZE {
        return Ok(Probe {
            status: "changed",
            version: None,
            writable: false,
        });
    }
    let hash = editing::version(&bytes);
    Ok(Probe {
        status: if hash == expected {
            "unchanged"
        } else {
            "changed"
        },
        version: Some(hash),
        writable: is_writable(path),
    })
}
#[tauri::command]
pub async fn reveal_document(path: String) -> Result<(), SaveFailure> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = reveal_target(&path)?;
        let status = std::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg("--")
            .arg(path)
            .status()
            .map_err(|e| SaveFailure {
                code: "io",
                message: format!("无法打开Finder：{e}"),
            })?;
        if status.success() {
            Ok(())
        } else {
            Err(SaveFailure {
                code: "io",
                message: "Finder未能定位文件，请检查文件是否仍然存在。".into(),
            })
        }
    })
    .await
    .map_err(|e| SaveFailure {
        code: "io",
        message: e.to_string(),
    })?
}
// Revealing a restored list item does not grant document read/write authorization.
fn reveal_target(path: &str) -> Result<PathBuf, SaveFailure> {
    let path = Path::new(path);
    if !path.is_absolute() || !crate::is_markdown(path) {
        return Err(SaveFailure {
            code: "path",
            message: "请选择绝对路径的 Markdown 文件。".into(),
        });
    }
    let canonical = fs::canonicalize(path).map_err(|_| SaveFailure {
        code: "missing",
        message: "文件已移动、删除或无法访问，无法在Finder中定位。".into(),
    })?;
    if !canonical.is_file() || !crate::is_markdown(&canonical) {
        return Err(SaveFailure {
            code: "path",
            message: "定位目标不是 Markdown 文件。".into(),
        });
    }
    Ok(canonical)
}
#[tauri::command]
pub async fn probe_document(
    app: tauri::AppHandle,
    path: String,
    version: String,
) -> Result<Probe, SaveFailure> {
    let path = editing::authorize(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        probe(&path, &version).map_err(|message| SaveFailure {
            code: "io",
            message,
        })
    })
    .await
    .map_err(|e| SaveFailure {
        code: "io",
        message: e.to_string(),
    })?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restored_item_can_be_revealed_without_granting_edit_authorization() {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let path = base.join("恢复列表 中文 空格.md");
        fs::write(&path, "# unchanged").unwrap();
        let state = EditingState::default();
        assert!(state.opened.lock().unwrap().is_empty());
        assert_eq!(reveal_target(path.to_str().unwrap()).unwrap(), path);
        assert!(state.opened.lock().unwrap().is_empty());
        assert_eq!(fs::read_to_string(&path).unwrap(), "# unchanged");
        assert_eq!(reveal_target("relative.md").unwrap_err().code, "path");
        assert_eq!(
            reveal_target(base.join("missing.md").to_str().unwrap())
                .unwrap_err()
                .code,
            "missing"
        );
        let non_md = base.join("other.txt");
        fs::write(&non_md, "unchanged").unwrap();
        assert_eq!(
            reveal_target(non_md.to_str().unwrap()).unwrap_err().code,
            "path"
        );
        let dir = base.join("directory.md");
        fs::create_dir(&dir).unwrap();
        assert_eq!(
            reveal_target(dir.to_str().unwrap()).unwrap_err().code,
            "path"
        );
    }
    #[test]
    fn changes_and_missing_are_reported_without_modifying_content() {
        let temp = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(temp.path()).unwrap().join("test.md");
        fs::write(&path, b"first").unwrap();
        let hash = editing::version(b"first");
        assert_eq!(probe(&path, &hash).unwrap().status, "unchanged");
        fs::write(&path, b"external").unwrap();
        assert_eq!(probe(&path, &hash).unwrap().status, "changed");
        assert_eq!(fs::read(&path).unwrap(), b"external");
        fs::remove_file(&path).unwrap();
        assert_eq!(probe(&path, &hash).unwrap().status, "missing");
    }
    #[test]
    #[cfg(unix)]
    fn readonly_file_and_directory_are_detected_without_changing_content() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let file = base.join("权限 检查.md");
        fs::write(&file, b"unchanged").unwrap();
        assert!(is_writable(&file));
        fs::set_permissions(&file, fs::Permissions::from_mode(0o444)).unwrap();
        assert!(!is_writable(&file));
        assert!(
            !probe(&file, &editing::version(b"unchanged"))
                .unwrap()
                .writable
        );
        assert_eq!(fs::read(&file).unwrap(), b"unchanged");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        fs::set_permissions(&base, fs::Permissions::from_mode(0o500)).unwrap();
        assert!(!is_writable(&file));
        fs::set_permissions(&base, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(is_writable(&file));
    }
}
