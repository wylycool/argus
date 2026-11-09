use crate::{
    editing::{self, EditingState, SaveFailure},
    Document,
};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime},
};
use tauri::{Emitter, Manager};
mod printing;
pub mod search;
type WatchedDocument = Option<(String, PathBuf, Option<Stamp>)>;
#[derive(Default)]
pub struct WatchState(Arc<Mutex<WatchedDocument>>, AtomicBool);
fn error(code: &'static str, message: impl Into<String>) -> SaveFailure {
    SaveFailure {
        code,
        message: message.into(),
    }
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, SaveFailure> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("untitled"))
        .map_err(|e| error("io", e.to_string()))
}
pub fn is_untitled(app: &tauri::AppHandle, path: &Path) -> bool {
    root(app)
        .ok()
        .is_some_and(|r| path.parent() == Some(r.as_path()))
}
fn create(root: &Path, drafts: Option<&Path>) -> Result<PathBuf, SaveFailure> {
    fs::create_dir_all(root).map_err(|e| error("io", e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))
            .map_err(|e| error("io", e.to_string()))?;
    }
    for i in 1..=10000 {
        let path = root.join(format!("未命名 {i}.md"));
        // A missing temporary source can still own a recovery draft.
        if drafts.is_some_and(|d| editing::draft_exists(d, &path.to_string_lossy())) {
            continue;
        }
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => {
                file.sync_all().map_err(|e| error("io", e.to_string()))?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(error("io", format!("无法创建新文档：{e}"))),
        }
    }
    Err(error("size", "未命名草稿过多，请先保存或整理已有草稿。"))
}
#[tauri::command]
pub async fn new_document(app: tauri::AppHandle) -> Result<Document, SaveFailure> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        let path = create(&root(&app)?, Some(&editing::draft_root(&app)?))?;
        let mut doc = crate::read_document_inner(path.to_string_lossy().into(), None)
            .map_err(|e| error("io", e))?;
        state.opened.lock().unwrap().insert(path);
        doc.untitled = true;
        Ok(doc)
    })
    .await
    .map_err(|e| error("io", e.to_string()))?
}
#[tauri::command]
pub async fn remove_untitled(
    app: tauri::AppHandle,
    path: String,
    expected_version: String,
) -> Result<(), SaveFailure> {
    let path = editing::authorize(&app, &path)?;
    if !is_untitled(&app, &path) {
        return Err(error("path", "只能整理应用创建的未命名草稿。"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        remove_untitled_inner(
            &state,
            &editing::draft_root(&app)?,
            &path,
            &expected_version,
        )
    })
    .await
    .map_err(|e| error("io", e.to_string()))?
}
fn remove_untitled_inner(
    state: &EditingState,
    drafts: &Path,
    path: &Path,
    expected: &str,
) -> Result<(), SaveFailure> {
    let bytes = editing::current_bytes(path)?;
    if editing::version(&bytes) != expected {
        return Err(error("conflict", "原未命名文档已变化，已保留原文件。"));
    }
    let content =
        std::str::from_utf8(&bytes).map_err(|_| error("recovery", "原草稿编码已变化，未清理。"))?;
    editing::ensure_draft_saved(drafts, &path.to_string_lossy(), content)?;
    fs::remove_file(path).map_err(|e| error("io", e.to_string()))?;
    state.forget(path);
    Ok(())
}
fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("webp")
    } else if bytes.starts_with(b"BM") {
        Some("bmp")
    } else {
        None
    }
}
fn store_image(document: &Path, bytes: &[u8]) -> Result<String, SaveFailure> {
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(error("size", "图片超过32 MB，请压缩后再插入。"));
    }
    let ext = image_type(bytes)
        .ok_or_else(|| error("format", "请使用PNG、JPEG、GIF、WebP或BMP图片。"))?;
    let dir = document
        .parent()
        .ok_or_else(|| error("path", "文档目录无效"))?
        .join("assets");
    fs::create_dir_all(&dir).map_err(|e| error("io", format!("无法创建图片目录：{e}")))?;
    let name = format!("{}.{ext}", editing::version(bytes));
    let target = dir.join(&name);
    if !target.exists() {
        let mut temp =
            tempfile::NamedTempFile::new_in(&dir).map_err(|e| error("io", e.to_string()))?;
        temp.write_all(bytes)
            .map_err(|e| error("io", e.to_string()))?;
        temp.as_file_mut()
            .sync_all()
            .map_err(|e| error("io", e.to_string()))?;
        match temp.persist_noclobber(&target) {
            Ok(_) => {}
            Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(error("io", e.error.to_string())),
        }
    }
    let mut existing = Vec::new();
    fs::File::open(&target)
        .map_err(|e| error("io", e.to_string()))?
        .take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut existing)
        .map_err(|e| error("io", e.to_string()))?;
    if existing != bytes {
        return Err(error("conflict", "同名图片内容发生变化，未插入。"));
    }
    Ok(format!("assets/{name}"))
}
#[tauri::command]
pub async fn insert_image(
    app: tauri::AppHandle,
    path: String,
    source: Option<String>,
    bytes: Option<Vec<u8>>,
) -> Result<String, SaveFailure> {
    let path = editing::authorize(&app, &path)?;
    if is_untitled(&app, &path) {
        return Err(error("untitled", "请先保存文档，再插入图片。"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        let data = if let Some(source) = source {
            let file = fs::File::open(source).map_err(|e| error("io", e.to_string()))?;
            let mut data = Vec::new();
            file.take(32 * 1024 * 1024 + 1)
                .read_to_end(&mut data)
                .map_err(|e| error("io", e.to_string()))?;
            data
        } else {
            bytes.ok_or_else(|| error("format", "没有可插入的图片。"))?
        };
        let relative = store_image(&path, &data)?;
        let asset = path.parent().unwrap().join(&relative);
        app.asset_protocol_scope()
            .allow_file(asset)
            .map_err(|e| error("io", format!("图片已保存，但读取授权失败：{e}")))?;
        Ok(relative)
    })
    .await
    .map_err(|e| error("io", e.to_string()))?
}
#[derive(Clone, PartialEq, Eq)]
struct Stamp {
    modified: Option<SystemTime>,
    len: u64,
    readonly: bool,
    inode: u64,
}
fn stamp(path: &Path) -> Option<Stamp> {
    fs::metadata(path).ok().map(|m| Stamp {
        modified: m.modified().ok(),
        len: m.len(),
        readonly: m.permissions().readonly(),
        inode: {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                m.ino()
            }
            #[cfg(not(unix))]
            {
                0
            }
        },
    })
}
#[tauri::command]
pub fn watch_document(
    app: tauri::AppHandle,
    path: Option<String>,
    watch_id: String,
) -> Result<(), SaveFailure> {
    let path = path.map(|p| editing::authorize(&app, &p)).transpose()?;
    let state = app.state::<WatchState>();
    let mut watched = state.0.lock().unwrap();
    match path {
        Some(path) => *watched = Some((watch_id, path.clone(), stamp(&path))),
        None if watched
            .as_ref()
            .is_some_and(|(owner, _, _)| owner == &watch_id) =>
        {
            *watched = None
        }
        None => return Ok(()),
    }
    drop(watched);
    if state.1.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let shared = state.0.clone();
    let emitter = app.clone();
    std::thread::spawn(move || {
        let mut previous: Option<(String, Option<Stamp>)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(750));
            let target = shared.lock().unwrap().clone();
            if let Some((owner, path, baseline)) = target {
                let next = stamp(&path);
                let old = previous
                    .as_ref()
                    .filter(|(id, _)| id == &owner)
                    .map(|(_, s)| s)
                    .unwrap_or(&baseline);
                if old != &next {
                    let _ = emitter.emit_to(
                        "main",
                        "document-changed",
                        path.to_string_lossy().as_ref(),
                    );
                }
                previous = Some((owner, next));
            } else {
                previous = None;
            }
        }
    });
    Ok(())
}
#[tauri::command]
pub async fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    printing::print(window).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_document_never_reuses_a_missing_source_with_recovery() {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let root = base.join("untitled");
        let drafts = base.join("drafts");
        fs::create_dir(&drafts).unwrap();
        let reserved = root.join("未命名 1.md");
        let stored = drafts.join(format!(
            "{}.json",
            editing::version(reserved.to_string_lossy().as_bytes())
        ));
        fs::write(&stored, b"damaged but important recovery").unwrap();
        let new = create(&root, Some(&drafts)).unwrap();
        assert_eq!(new.file_name().unwrap(), "未命名 2.md");
        assert!(!reserved.exists());
        assert_eq!(fs::read(stored).unwrap(), b"damaged but important recovery");
    }
    #[test]
    fn cleanup_keeps_pending_or_unreadable_recovery_and_changed_source() {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let drafts = base.join("drafts");
        fs::create_dir(&drafts).unwrap();
        let path = create(&base.join("untitled"), None).unwrap();
        fs::write(&path, b"old").unwrap();
        let state = EditingState::default();
        state.opened.lock().unwrap().insert(path.clone());
        let mut draft = editing::Draft {
            path: path.to_string_lossy().into(),
            text: "important recovery".into(),
            base_version: editing::version(b"old"),
            session_id: "previous".into(),
            revision: 5,
        };
        let stored = drafts.join(format!("{}.json", editing::version(draft.path.as_bytes())));
        let encoded = serde_json::to_vec(&draft).unwrap();
        fs::write(&stored, &encoded).unwrap();
        assert_eq!(
            remove_untitled_inner(&state, &drafts, &path, &editing::version(b"old"))
                .unwrap_err()
                .code,
            "recovery"
        );
        assert_eq!(fs::read(&stored).unwrap(), encoded);
        assert_eq!(fs::read(&path).unwrap(), b"old");
        assert!(state.opened.lock().unwrap().contains(&path));
        fs::write(&stored, b"invalid json").unwrap();
        assert_eq!(
            remove_untitled_inner(&state, &drafts, &path, &editing::version(b"old"))
                .unwrap_err()
                .code,
            "recovery"
        );
        draft.text = "old".into();
        fs::write(&stored, serde_json::to_vec(&draft).unwrap()).unwrap();
        fs::write(&path, b"external").unwrap();
        assert_eq!(
            remove_untitled_inner(&state, &drafts, &path, &editing::version(b"old"))
                .unwrap_err()
                .code,
            "conflict"
        );
        assert_eq!(fs::read(&path).unwrap(), b"external");
        fs::write(&path, b"old").unwrap();
        remove_untitled_inner(&state, &drafts, &path, &editing::version(b"old")).unwrap();
        assert!(!path.exists());
        assert!(!state.opened.lock().unwrap().contains(&path));
    }
    #[test]
    fn new_documents_are_distinct_and_retained_on_disk() {
        let t = tempfile::tempdir().unwrap();
        let a = create(t.path(), None).unwrap();
        let b = create(t.path(), None).unwrap();
        assert_ne!(a, b);
        fs::write(&a, "草稿").unwrap();
        assert_eq!(fs::read_to_string(a).unwrap(), "草稿");
        assert!(b.exists());
    }
    #[test]
    fn images_are_deduplicated_and_invalid_data_never_creates_assets() {
        let t = tempfile::tempdir().unwrap();
        let doc = t.path().join("中文.md");
        fs::write(&doc, "original").unwrap();
        assert!(store_image(&doc, b"not an image").is_err());
        assert!(!t.path().join("assets").exists());
        let data = b"\x89PNG\r\n\x1a\nimage";
        let p = store_image(&doc, data).unwrap();
        assert_eq!(store_image(&doc, data).unwrap(), p);
        assert_eq!(fs::read(t.path().join(p)).unwrap(), data);
        assert_eq!(fs::read_to_string(doc).unwrap(), "original");
    }
    #[test]
    fn stamp_detects_modification_and_removal() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("a.md");
        fs::write(&p, "a").unwrap();
        let first = stamp(&p);
        fs::write(&p, "longer").unwrap();
        assert!(stamp(&p) != first);
        fs::remove_file(&p).unwrap();
        assert!(stamp(&p).is_none());
    }
}

#[tauri::command]
pub async fn list_untitled(app: tauri::AppHandle) -> Result<Vec<String>, SaveFailure> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        // Keep recovery-only documents discoverable even if their source is gone
        // and they have aged out of the recent/opened lists.
        let mut paths = editing::recovery_paths(&editing::draft_root(&app)?)?;
        let entries = if root.exists() {
            Some(fs::read_dir(root).map_err(|e| error("io", e.to_string()))?)
        } else {
            None
        };
        for entry in entries.into_iter().flatten().take(10000) {
            let entry = entry.map_err(|e| error("io", e.to_string()))?;
            if entry
                .file_type()
                .map_err(|e| error("io", e.to_string()))?
                .is_file()
                && crate::is_markdown(&entry.path())
            {
                paths.push(entry.path().to_string_lossy().into());
            }
        }
        paths.sort();
        paths.dedup();
        Ok(paths)
    })
    .await
    .map_err(|e| error("io", e.to_string()))?
}
