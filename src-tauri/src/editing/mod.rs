use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::Manager;
pub mod copy;
pub mod history;

#[derive(Default)]
pub struct EditingState {
    pub opened: Mutex<HashSet<PathBuf>>,
    sessions: Mutex<HashMap<PathBuf, String>>,
    pub(crate) operations: Mutex<()>,
    pub allow_exit: AtomicBool,
}
impl EditingState {
    pub(crate) fn forget(&self, path: &Path) {
        self.sessions.lock().unwrap().remove(path);
        self.opened.lock().unwrap().remove(path);
    }
}
#[derive(Debug, Serialize)]
pub struct SaveFailure {
    pub code: &'static str,
    pub message: String,
}
fn failure(code: &'static str, message: impl Into<String>) -> SaveFailure {
    SaveFailure {
        code,
        message: message.into(),
    }
}
fn io_error(error: std::io::Error) -> SaveFailure {
    failure("io", format!("保存失败：{error}。编辑内容仍然保留。"))
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub path: String,
    pub text: String,
    pub base_version: String,
    pub session_id: String,
    pub revision: u64,
}
#[derive(Serialize)]
pub struct SaveReply {
    pub version: String,
}
pub fn version(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn draft_path(root: &Path, path: &str) -> PathBuf {
    root.join(format!("{}.json", version(path.as_bytes())))
}
pub(crate) fn draft_root(app: &tauri::AppHandle) -> Result<PathBuf, SaveFailure> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| failure("draft", e.to_string()))?
        .join("drafts"))
}
pub(crate) fn authorize(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, SaveFailure> {
    let path = PathBuf::from(path);
    if !app
        .state::<EditingState>()
        .opened
        .lock()
        .unwrap()
        .contains(&path)
    {
        return Err(failure("permission", "请先打开这份文档，再进入编辑。"));
    }
    Ok(path)
}
pub(crate) fn draft_exists(root: &Path, path: &str) -> bool {
    !matches!(fs::symlink_metadata(draft_path(root, path)), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
}
pub(crate) fn recovery_paths(root: &Path) -> Result<Vec<String>, SaveFailure> {
    let files = match fs::read_dir(root) {
        Ok(files) => files,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(io_error(e)),
    };
    let mut paths = Vec::new();
    for item in files.take(10000) {
        let item = item.map_err(io_error)?;
        if !item.file_type().map_err(io_error)?.is_file()
            || item.path().extension().is_none_or(|ext| ext != "json")
        {
            continue;
        }
        let Ok(file) = fs::File::open(item.path()) else {
            continue;
        };
        if file.metadata().map_err(io_error)?.len() > 64 * 1024 * 1024 {
            continue;
        }
        let Ok(draft) = serde_json::from_reader::<_, Draft>(file.take(64 * 1024 * 1024)) else {
            continue;
        };
        if Path::new(&draft.path).is_absolute()
            && crate::is_markdown(Path::new(&draft.path))
            && item.path() == draft_path(root, &draft.path)
        {
            paths.push(draft.path);
        }
    }
    Ok(paths)
}
pub(crate) fn read_draft_checked(root: &Path, path: &str) -> Result<Option<Draft>, SaveFailure> {
    let stored = draft_path(root, path);
    let unreadable = || {
        failure(
            "recovery",
            "本机恢复草稿无法读取，已保留原备份。请另存副本后编辑，避免覆盖恢复内容。",
        )
    };
    let file = match fs::File::open(&stored) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !draft_exists(root, path) => {
            return Ok(None)
        }
        Err(_) => return Err(unreadable()),
    };
    let metadata = file.metadata().map_err(|_| unreadable())?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
        return Err(unreadable());
    }
    let draft: Draft =
        serde_json::from_reader(file.take(64 * 1024 * 1024)).map_err(|_| unreadable())?;
    if draft.path != path {
        return Err(unreadable());
    }
    Ok(Some(draft))
}
#[cfg(test)]
pub fn read_draft(root: &Path, path: &str) -> Option<Draft> {
    read_draft_checked(root, path).ok().flatten()
}
pub(crate) fn ensure_draft_saved(
    root: &Path,
    path: &str,
    content: &str,
) -> Result<(), SaveFailure> {
    match fs::symlink_metadata(draft_path(root, path)) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => {
            return Err(failure(
                "recovery",
                "无法确认本机草稿状态，原未命名文档已保留。",
            ))
        }
    }
    let draft = read_draft_checked(root, path)?
        .ok_or_else(|| failure("recovery", "本机草稿暂时无法读取，原未命名文档已保留。"))?;
    let normalize = |text: &str| text.replace("\r\n", "\n").replace('\r', "\n");
    if normalize(&draft.text) != normalize(content.trim_start_matches('\u{feff}')) {
        return Err(failure(
            "recovery",
            "还有未处理的恢复草稿，原未命名文档已保留。",
        ));
    }
    Ok(())
}
fn current_session(state: &EditingState, draft: &Draft) -> Result<(), SaveFailure> {
    if state.sessions.lock().unwrap().get(Path::new(&draft.path)) != Some(&draft.session_id) {
        return Err(failure("stale", "这次编辑会话已结束，请重新打开编辑。"));
    }
    Ok(())
}
#[tauri::command]
pub async fn begin_edit_session(
    app: tauri::AppHandle,
    path: String,
    session_id: String,
    recovery: Option<Draft>,
) -> Result<(), SaveFailure> {
    let path = authorize(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        begin_session_inner(
            &state,
            &draft_root(&app)?,
            &path,
            session_id,
            recovery.as_ref(),
        )
    })
    .await
    .map_err(|e| failure("io", e.to_string()))?
}
fn begin_session_inner(
    state: &EditingState,
    root: &Path,
    path: &Path,
    session_id: String,
    recovery: Option<&Draft>,
) -> Result<(), SaveFailure> {
    if !crate::reading::is_writable(path) {
        return Err(failure(
            "readonly",
            "文件只读或所在目录不可写，请另存为副本后编辑。",
        ));
    }
    if let Some(previous) = read_draft_checked(root, &path.to_string_lossy())? {
        let disk = String::from_utf8(current_bytes(path)?)
            .map_err(|_| failure("conflict", "磁盘文件编码已变化，请重新读取。"))?;
        let normalize = |text: &str| text.replace("\r\n", "\n").replace('\r', "\n");
        if normalize(&previous.text) != normalize(disk.trim_start_matches('\u{feff}'))
            && recovery != Some(&previous)
        {
            return Err(failure(
                "recovery",
                "发现尚未处理或已经变化的草稿，请重新读取后恢复或明确放弃草稿。",
            ));
        }
    }
    state
        .sessions
        .lock()
        .unwrap()
        .insert(path.to_owned(), session_id);
    Ok(())
}
fn write_draft_inner(root: &Path, draft: &Draft) -> Result<(), SaveFailure> {
    if draft.text.len() > 32 * 1024 * 1024 {
        return Err(failure(
            "size",
            "草稿超过 32 MB，暂时无法备份。请精简内容后重试。",
        ));
    }
    if let Some(previous) = read_draft_checked(root, &draft.path)? {
        if previous.session_id == draft.session_id && previous.revision > draft.revision {
            return Ok(());
        }
    }
    fs::create_dir_all(root).map_err(io_error)?;
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(io_error)?;
    serde_json::to_writer(temporary.as_file_mut(), draft)
        .map_err(|e| failure("draft", e.to_string()))?;
    if temporary.as_file().metadata().map_err(io_error)?.len() > 64 * 1024 * 1024 {
        return Err(failure(
            "size",
            "草稿编码后超过64 MB，未覆盖已有备份。请保持窗口打开并另存副本。",
        ));
    }
    temporary.as_file_mut().sync_all().map_err(io_error)?;
    temporary
        .persist(draft_path(root, &draft.path))
        .map_err(|e| io_error(e.error))?;
    Ok(())
}
fn clear_draft_inner(
    root: &Path,
    path: &str,
    session_id: &str,
    revision: u64,
) -> Result<(), SaveFailure> {
    if let Some(previous) = read_draft_checked(root, path)? {
        // A completed save must never remove a draft containing newer keystrokes.
        if previous.session_id == session_id && previous.revision <= revision {
            fs::remove_file(draft_path(root, path)).map_err(io_error)?;
        }
    }
    Ok(())
}
fn encoded_content(content: &str, previous: &[u8]) -> Vec<u8> {
    let mut content = content.replace("\r\n", "\n").replace('\r', "\n");
    if previous.windows(2).any(|pair| pair == b"\r\n") {
        content = content.replace('\n', "\r\n");
    } else if previous.contains(&b'\r') && !previous.contains(&b'\n') {
        content = content.replace('\n', "\r");
    }
    let mut bytes = Vec::new();
    if previous.starts_with(&[0xef, 0xbb, 0xbf]) {
        bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    bytes.extend_from_slice(content.as_bytes());
    bytes
}
pub(crate) fn current_bytes(path: &Path) -> Result<Vec<u8>, SaveFailure> {
    if fs::canonicalize(path).map_err(|_| {
        failure(
            "conflict",
            "原文件已移动、删除或无法访问。请另存副本以保留修改。",
        )
    })? != path
    {
        return Err(failure(
            "conflict",
            "文件路径已被外部替换。请另存副本以保留修改。",
        ));
    }
    let file = fs::File::open(path).map_err(io_error)?;
    if !file.metadata().map_err(io_error)?.is_file() {
        return Err(failure("conflict", "原路径已不再是文件。请另存副本。"));
    }
    if file.metadata().map_err(io_error)?.len() > super::MAX_DOCUMENT_SIZE {
        return Err(failure(
            "conflict",
            "磁盘文件已发生变化，暂不覆盖。请另存副本。",
        ));
    }
    let mut bytes = Vec::new();
    file.take(super::MAX_DOCUMENT_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > super::MAX_DOCUMENT_SIZE {
        return Err(failure(
            "size",
            "磁盘文件超过16 MB，未覆盖原文件。请另存副本。",
        ));
    }
    Ok(bytes)
}
fn save_inner(
    path: &Path,
    content: &str,
    expected_version: &str,
) -> Result<SaveReply, SaveFailure> {
    let previous = current_bytes(path)?;
    if version(&previous) != expected_version {
        return Err(failure(
            "conflict",
            "文件已被其他程序修改，已暂停自动保存。请另存副本，或重新读取磁盘文件。",
        ));
    }
    let metadata = fs::metadata(path).map_err(io_error)?;
    if metadata.permissions().readonly() {
        return Err(failure(
            "permission",
            "文件为只读，无法保存。编辑内容已保留，可另存副本。",
        ));
    }
    let bytes = encoded_content(content, &previous);
    replace_bytes(path, &bytes, expected_version)
}
fn replace_bytes(
    path: &Path,
    bytes: &[u8],
    expected_version: &str,
) -> Result<SaveReply, SaveFailure> {
    let previous = current_bytes(path)?;
    if version(&previous) != expected_version {
        return Err(failure(
            "conflict",
            "磁盘文件已经变化，未覆盖原文件。请重新读取后再操作。",
        ));
    }
    let metadata = fs::metadata(path).map_err(io_error)?;
    if metadata.permissions().readonly() {
        return Err(failure(
            "permission",
            "文件为只读，无法保存。编辑内容已保留，可另存副本。",
        ));
    }
    if bytes.len() as u64 > super::MAX_DOCUMENT_SIZE {
        return Err(failure(
            "size",
            "文档超过 16 MB，暂时无法保存。请精简内容后重试。",
        ));
    }
    let mut temporary = tempfile::NamedTempFile::new_in(
        path.parent().ok_or_else(|| failure("io", "文件目录无效"))?,
    )
    .map_err(io_error)?;
    temporary.as_file_mut().write_all(bytes).map_err(io_error)?;
    temporary
        .as_file()
        .set_permissions(metadata.permissions())
        .map_err(io_error)?;
    if let Ok(attributes) = xattr::list(path) {
        for attribute in attributes {
            if let Ok(Some(value)) = xattr::get(path, &attribute) {
                let _ = xattr::set(temporary.path(), &attribute, &value);
            }
        }
    }
    temporary.as_file_mut().sync_all().map_err(io_error)?;
    // Re-check immediately before the atomic replacement, including after slow I/O.
    if version(&current_bytes(path)?) != expected_version {
        return Err(failure(
            "conflict",
            "保存期间磁盘文件发生变化，已保留编辑内容。请另存副本。",
        ));
    }
    temporary.persist(path).map_err(|e| io_error(e.error))?;
    Ok(SaveReply {
        version: version(bytes),
    })
}
#[tauri::command]
pub async fn write_draft(app: tauri::AppHandle, draft: Draft) -> Result<(), SaveFailure> {
    authorize(&app, &draft.path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        current_session(&state, &draft)?;
        write_draft_inner(&draft_root(&app)?, &draft)
    })
    .await
    .map_err(|e| failure("draft", e.to_string()))?
}
#[tauri::command]
pub async fn clear_draft(
    app: tauri::AppHandle,
    path: String,
    session_id: String,
    revision: u64,
) -> Result<(), SaveFailure> {
    authorize(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        clear_draft_inner(&draft_root(&app)?, &path, &session_id, revision)
    })
    .await
    .map_err(|e| failure("draft", e.to_string()))?
}
#[tauri::command]
pub async fn save_document(app: tauri::AppHandle, draft: Draft) -> Result<SaveReply, SaveFailure> {
    let path = authorize(&app, &draft.path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        current_session(&state, &draft)?;
        // A target-file permission or conflict error must still leave a recovery copy.
        let draft_result = write_draft_inner(&draft_root(&app)?, &draft);
        let result = if crate::documents::is_untitled(&app, &path) {
            save_inner(&path, &draft.text, &draft.base_version)
        } else {
            save_with_history(
                &history::root(&app)?,
                &path,
                &draft.text,
                &draft.base_version,
                &draft.session_id,
            )
        };
        match result {
            Ok(reply) => Ok(reply),
            Err(mut error) => {
                if draft_result.is_err() {
                    error
                        .message
                        .push_str(" 本机草稿备份也未成功，请保持窗口打开并另存副本。");
                }
                Err(error)
            }
        }
    })
    .await
    .map_err(|e| failure("io", e.to_string()))?
}
fn save_with_history(
    root: &Path,
    path: &Path,
    text: &str,
    expected: &str,
    session: &str,
) -> Result<SaveReply, SaveFailure> {
    let previous = current_bytes(path)?;
    if version(&previous) != expected {
        return Err(failure(
            "conflict",
            "文件已被其他程序修改，已暂停自动保存。请另存副本，或重新读取磁盘文件。",
        ));
    }
    history::protect(root, path, &previous, session, false)?;
    save_inner(path, text, expected)
}
fn save_copy_inner(path: &Path, content: &str) -> Result<SaveReply, SaveFailure> {
    if !path.is_absolute() || !super::is_markdown(path) {
        return Err(failure("path", "请将副本保存为 Markdown 文件。"));
    }
    if content.len() as u64 > super::MAX_DOCUMENT_SIZE {
        return Err(failure("size", "文档超过16 MB，请先精简内容。"));
    }
    let mut temporary = tempfile::NamedTempFile::new_in(
        path.parent()
            .ok_or_else(|| failure("path", "文件目录无效"))?,
    )
    .map_err(io_error)?;
    temporary
        .as_file_mut()
        .write_all(content.as_bytes())
        .map_err(io_error)?;
    temporary.as_file_mut().sync_all().map_err(io_error)?;
    temporary.persist_noclobber(path).map_err(|e| {
        if e.error.kind() == std::io::ErrorKind::AlreadyExists {
            failure("exists", "副本文件名已存在，请换一个文件名。")
        } else {
            io_error(e.error)
        }
    })?;
    Ok(SaveReply {
        version: version(content.as_bytes()),
    })
}
#[tauri::command]
pub async fn save_copy(
    app: tauri::AppHandle,
    path: String,
    content: String,
    source: Option<String>,
    references: Option<Vec<copy::Reference>>,
) -> Result<copy::CopyReply, SaveFailure> {
    let path = PathBuf::from(path);
    let source = source.map(|s| authorize(&app, &s)).transpose()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        let reply = copy::save(
            &path,
            content,
            source.as_deref(),
            references.unwrap_or_default(),
        )?;
        state
            .opened
            .lock()
            .unwrap()
            .insert(fs::canonicalize(&path).map_err(io_error)?);
        Ok(reply)
    })
    .await
    .map_err(|e| failure("io", e.to_string()))?
}
#[tauri::command]
pub fn finish_window_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    if action == "quit" {
        app.state::<EditingState>()
            .allow_exit
            .store(true, Ordering::SeqCst);
        app.exit(0);
    } else if action == "close" {
        if let Some(window) = app.get_webview_window("main") {
            window.hide().map_err(|e| e.to_string())?;
        }
    } else {
        return Err("无效窗口操作".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn save_preserves_cr_only_line_endings_and_bom() {
        let t = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(t.path()).unwrap().join("classic.md");
        let original = b"\xef\xbb\xbf# Old\r\rBody\r";
        fs::write(&path, original).unwrap();
        save_inner(&path, "# New\n\nEdited\n", &version(original)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"\xef\xbb\xbf# New\r\rEdited\r");
    }
    #[test]
    fn valid_recovery_is_discoverable_without_source_or_recent_entries() {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let drafts = base.join("drafts");
        let missing = base.join("missing.md");
        let draft = Draft {
            path: missing.to_string_lossy().into(),
            text: "recovery".into(),
            base_version: "v1".into(),
            session_id: "s1".into(),
            revision: 1,
        };
        write_draft_inner(&drafts, &draft).unwrap();
        fs::write(drafts.join("unrelated.json"), b"{}").unwrap();
        fs::write(drafts.join("broken.json"), b"broken").unwrap();
        assert_eq!(recovery_paths(&drafts).unwrap(), vec![draft.path]);
        assert!(!missing.exists());
        assert_eq!(
            read_draft(&drafts, missing.to_str().unwrap()).unwrap().text,
            "recovery"
        );
    }
    #[test]
    fn unreadable_draft_is_never_treated_as_absent_or_overwritten() {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let path = base.join("note.md");
        let root = base.join("drafts");
        fs::write(&path, b"disk safe").unwrap();
        fs::create_dir(&root).unwrap();
        let stored = draft_path(&root, path.to_str().unwrap());
        let damaged = b"{\"text\":\"important draft\",\"revision\":";
        fs::write(&stored, damaged).unwrap();
        let state = EditingState::default();
        assert!(begin_session_inner(&state, &root, &path, "new".into(), None).is_err());
        assert!(state.sessions.lock().unwrap().is_empty());
        let draft = Draft {
            path: path.to_string_lossy().into(),
            text: "new input".into(),
            base_version: version(b"disk safe"),
            session_id: "new".into(),
            revision: 1,
        };
        assert!(write_draft_inner(&root, &draft).is_err());
        assert!(clear_draft_inner(&root, &draft.path, "new", 1).is_err());
        assert_eq!(fs::read(&stored).unwrap(), damaged);
        assert_eq!(fs::read(&path).unwrap(), b"disk safe");
    }
    #[test]
    fn unhandled_recovery_blocks_new_session_without_overwriting_draft() {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let path = base.join("待恢复 草稿.md");
        let root = base.join("drafts");
        fs::write(&path, "# disk").unwrap();
        let draft = Draft {
            path: path.to_string_lossy().into(),
            text: "# recovery".into(),
            base_version: version(b"# disk"),
            session_id: "old".into(),
            revision: 4,
        };
        write_draft_inner(&root, &draft).unwrap();
        let state = EditingState::default();
        assert_eq!(
            begin_session_inner(&state, &root, &path, "new".into(), None)
                .unwrap_err()
                .code,
            "recovery"
        );
        let mut stale = draft.clone();
        stale.revision -= 1;
        assert_eq!(
            begin_session_inner(&state, &root, &path, "new".into(), Some(&stale))
                .unwrap_err()
                .code,
            "recovery"
        );
        assert!(state.sessions.lock().unwrap().is_empty());
        assert_eq!(read_draft(&root, &draft.path).unwrap(), draft);
        assert_eq!(fs::read_to_string(&path).unwrap(), "# disk");
        begin_session_inner(&state, &root, &path, "new".into(), Some(&draft)).unwrap();
        let mut recovered = draft.clone();
        recovered.session_id = "new".into();
        current_session(&state, &recovered).unwrap();
        write_draft_inner(&root, &recovered).unwrap();
        assert_eq!(read_draft(&root, &draft.path).unwrap().text, "# recovery");
        assert_eq!(current_session(&state, &draft).unwrap_err().code, "stale");
        clear_draft_inner(&root, &draft.path, &draft.session_id, draft.revision).unwrap();
        assert_eq!(read_draft(&root, &draft.path).unwrap(), recovered);
    }
    #[test]
    fn explicit_discard_or_already_saved_draft_allows_normal_editing() {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let path = base.join("note.md");
        let root = base.join("drafts");
        fs::write(&path, "\u{feff}# disk\r\n").unwrap();
        let mut draft = Draft {
            path: path.to_string_lossy().into(),
            text: "# disk\n".into(),
            base_version: "older".into(),
            session_id: "previous".into(),
            revision: 1,
        };
        write_draft_inner(&root, &draft).unwrap();
        let state = EditingState::default();
        begin_session_inner(&state, &root, &path, "saved".into(), None).unwrap();
        draft.text = "# unsaved".into();
        draft.revision += 1;
        write_draft_inner(&root, &draft).unwrap();
        clear_draft_inner(&root, &draft.path, &draft.session_id, draft.revision).unwrap();
        begin_session_inner(&state, &root, &path, "discarded".into(), None).unwrap();
        assert!(read_draft(&root, &draft.path).is_none());
        assert_eq!(fs::read_to_string(&path).unwrap(), "\u{feff}# disk\r\n");
    }
    #[test]
    fn ended_session_cannot_write_over_new_session_drafts() {
        let state = EditingState::default();
        state
            .sessions
            .lock()
            .unwrap()
            .insert(PathBuf::from("/note.md"), "new-session".into());
        let mut draft = Draft {
            path: "/note.md".into(),
            text: "old text".into(),
            base_version: "v1".into(),
            session_id: "old-session".into(),
            revision: 100,
        };
        assert_eq!(current_session(&state, &draft).err().unwrap().code, "stale");
        draft.session_id = "new-session".into();
        assert!(current_session(&state, &draft).is_ok());
    }
    #[test]
    fn saves_utf8_preserves_bom_crlf_and_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(dir.path()).unwrap().join("中文 空格.md");
        let original = b"\xef\xbb\xbf# first\r\nbody\r\n";
        fs::write(&path, original).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        let reply = save_inner(&path, "# 修改\n正文\n", &version(original)).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert_eq!(bytes, "\u{feff}# 修改\r\n正文\r\n".as_bytes());
        assert_eq!(reply.version, version(&bytes));
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o640
        );
    }
    #[test]
    fn conflict_and_readonly_never_overwrite() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(dir.path()).unwrap().join("note.md");
        fs::write(&path, "external").unwrap();
        assert_eq!(
            save_inner(&path, "my draft", &version(b"old"))
                .err()
                .unwrap()
                .code,
            "conflict"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        assert_eq!(
            save_inner(&path, "my draft", &version(b"external"))
                .err()
                .unwrap()
                .code,
            "permission"
        );
    }
    #[test]
    fn old_save_cannot_delete_or_replace_a_newer_draft() {
        let dir = tempfile::tempdir().unwrap();
        let mut draft = Draft {
            path: "/note.md".into(),
            text: "new".into(),
            base_version: "v1".into(),
            session_id: "s1".into(),
            revision: 2,
        };
        write_draft_inner(dir.path(), &draft).unwrap();
        draft.revision = 1;
        draft.text = "old".into();
        write_draft_inner(dir.path(), &draft).unwrap();
        clear_draft_inner(dir.path(), &draft.path, "s1", 1).unwrap();
        assert_eq!(read_draft(dir.path(), &draft.path).unwrap().text, "new");
        clear_draft_inner(dir.path(), &draft.path, "s1", 2).unwrap();
        assert!(read_draft(dir.path(), &draft.path).is_none());
    }
    #[test]
    fn moved_file_and_oversized_document_do_not_destroy_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(dir.path()).unwrap().join("note.md");
        assert_eq!(save_inner(&path, "x", "v1").err().unwrap().code, "conflict");
        fs::write(&path, "original").unwrap();
        assert_eq!(
            save_inner(
                &path,
                &"x".repeat(super::super::MAX_DOCUMENT_SIZE as usize + 1),
                &version(b"original")
            )
            .err()
            .unwrap()
            .code,
            "size"
        );
        assert_eq!(fs::read_to_string(path).unwrap(), "original");
    }
    #[test]
    fn copies_are_writable_and_existing_targets_are_never_overwritten() {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let original = base.join("只读 原文件.md");
        let copy = base.join("可写 副本.md");
        fs::write(&original, b"original").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&original, fs::Permissions::from_mode(0o444)).unwrap();
        }
        save_copy_inner(&copy, "副本正文").unwrap();
        assert_eq!(fs::read_to_string(&copy).unwrap(), "副本正文");
        assert!(crate::reading::is_writable(&copy));
        assert_eq!(
            save_copy_inner(&copy, "overwrite").err().unwrap().code,
            "exists"
        );
        assert_eq!(fs::read_to_string(&copy).unwrap(), "副本正文");
        assert_eq!(fs::read(&original).unwrap(), b"original");
        assert!(save_copy_inner(&base.join("not-markdown.txt"), "text").is_err());
        assert!(!base.join("not-markdown.txt").exists());
    }
}
