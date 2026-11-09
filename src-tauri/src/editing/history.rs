use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_VERSIONS: usize = 20;
const MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
const MAX_TOTAL_VERSIONS: usize = 1000;
const CHECKPOINT_MS: u64 = 5 * 60 * 1000;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub created_at: u64,
    pub bytes: u64,
    pub version: String,
    pub reason: String,
    session: String,
}
#[derive(Default, Serialize, Deserialize)]
struct Index {
    path: String,
    entries: Vec<Entry>,
    #[serde(default)]
    ready: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    content: String,
}
pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, SaveFailure> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| failure("history", e.to_string()))?
        .join("history"))
}
fn directory(root: &Path, path: &Path) -> PathBuf {
    root.join(version(path.to_string_lossy().as_bytes()))
}
fn read_index(dir: &Path) -> Result<Index, SaveFailure> {
    let path = dir.join("index.json");
    match fs::File::open(path) {
        Ok(file) => {
            if file.metadata().map_err(io_error)?.len() > 1024 * 1024 {
                return Err(failure("history", "历史记录索引过大，未执行操作。"));
            }
            serde_json::from_reader(file.take(1024 * 1024))
                .map_err(|_| failure("history", "历史记录索引无法读取，未覆盖原文件。"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Index::default()),
        Err(e) => Err(io_error(e)),
    }
}
fn write_index(dir: &Path, index: &Index) -> Result<(), SaveFailure> {
    let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(io_error)?;
    serde_json::to_writer(temp.as_file_mut(), index)
        .map_err(|e| failure("history", e.to_string()))?;
    temp.as_file_mut().sync_all().map_err(io_error)?;
    temp.persist(dir.join("index.json"))
        .map_err(|e| io_error(e.error))?;
    Ok(())
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-')
}
fn snapshot_path(dir: &Path, id: &str) -> Result<PathBuf, SaveFailure> {
    if !valid_id(id) {
        return Err(failure("history", "历史版本标识无效。"));
    }
    Ok(dir.join(format!("{id}.md")))
}
fn prune(root: &Path, keep_dir: &Path, keep_id: &str) -> Result<(), SaveFailure> {
    let mut all = Vec::new();
    for item in fs::read_dir(root).map_err(io_error)? {
        let item = item.map_err(io_error)?;
        let dir = item.path();
        if !item.file_type().map_err(io_error)?.is_dir() {
            continue;
        }
        let index = read_index(&dir)?;
        // A crash between snapshot creation and index replacement can leave an orphan.
        let ids: HashSet<_> = index.entries.iter().map(|e| e.id.as_str()).collect();
        for file in fs::read_dir(&dir).map_err(io_error)? {
            let file = file.map_err(io_error)?;
            let p = file.path();
            if p.extension().is_some_and(|ext| ext == "md")
                && file.file_type().map_err(io_error)?.is_file()
            {
                if let Some(id) = p.file_stem().and_then(|s| s.to_str()) {
                    if valid_id(id) && !ids.contains(id) {
                        fs::remove_file(p).map_err(io_error)?;
                    }
                }
            }
        }
        for entry in index.entries {
            let bytes = fs::metadata(snapshot_path(&dir, &entry.id)?)
                .map(|m| m.len())
                .unwrap_or(0);
            all.push((entry.created_at, bytes, dir.clone(), entry.id));
        }
    }
    all.sort_by_key(|v| v.0);
    let mut total: u64 = all.iter().map(|v| v.1).sum();
    let mut count = all.len();
    for (_, bytes, dir, id) in all {
        if dir == keep_dir && id == keep_id {
            continue;
        }
        if total <= MAX_TOTAL_BYTES && count <= MAX_TOTAL_VERSIONS {
            break;
        }
        let mut index = read_index(&dir)?;
        index.entries.retain(|e| e.id != id);
        write_index(&dir, &index)?;
        if let Err(e) = fs::remove_file(snapshot_path(&dir, &id)?) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(io_error(e));
            }
        }
        total = total.saturating_sub(bytes);
        count -= 1;
    }
    Ok(())
}
pub(super) fn protect(
    root: &Path,
    path: &Path,
    bytes: &[u8],
    session: &str,
    force: bool,
) -> Result<(), SaveFailure> {
    let dir = directory(root, path);
    fs::create_dir_all(&dir).map_err(|e| {
        failure(
            "history",
            format!("无法保留历史版本：{e}。已暂停保存，编辑内容仍在。"),
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
    }
    let mut index = read_index(&dir)?;
    if !index.path.is_empty() && index.path != path.to_string_lossy() {
        return Err(failure("history", "历史版本不属于当前文档。"));
    }
    index.path = path.to_string_lossy().into();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let hash = version(bytes);
    if !force
        && index.entries.first().is_some_and(|e| {
            e.version == hash
                || (e.session == session && now.saturating_sub(e.created_at) < CHECKPOINT_MS)
        })
    {
        if index.ready {
            return Ok(());
        }
        prune(root, &dir, &index.entries[0].id)?;
        index.ready = true;
        return write_index(&dir, &index);
    }
    let id = format!("{now}-{hash}");
    let mut temp = tempfile::NamedTempFile::new_in(&dir).map_err(io_error)?;
    temp.as_file_mut().write_all(bytes).map_err(io_error)?;
    temp.as_file_mut().sync_all().map_err(io_error)?;
    temp.persist(snapshot_path(&dir, &id)?)
        .map_err(|e| io_error(e.error))?;
    index.entries.retain(|e| e.id != id);
    index.entries.insert(
        0,
        Entry {
            id: id.clone(),
            created_at: now,
            bytes: bytes.len() as u64,
            version: hash,
            reason: if force {
                "恢复前"
            } else if index.entries.first().is_some_and(|e| e.session == session) {
                "编辑中"
            } else {
                "编辑前"
            }
            .into(),
            session: session.into(),
        },
    );
    let removed = index
        .entries
        .split_off(index.entries.len().min(MAX_VERSIONS));
    index.ready = false;
    write_index(&dir, &index)?;
    for e in removed {
        let _ = fs::remove_file(snapshot_path(&dir, &e.id)?);
    }
    prune(root, &dir, &id)?;
    let mut index = read_index(&dir)?;
    index.ready = true;
    write_index(&dir, &index)
}
fn list(root: &Path, path: &Path) -> Result<Vec<Entry>, SaveFailure> {
    let index = read_index(&directory(root, path))?;
    if !index.path.is_empty() && index.path != path.to_string_lossy() {
        return Err(failure("history", "历史版本不属于当前文档。"));
    }
    Ok(index.entries)
}
fn read_snapshot(root: &Path, path: &Path, id: &str) -> Result<Vec<u8>, SaveFailure> {
    let entry = list(root, path)?
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| failure("history", "该历史版本已清理，请刷新列表。"))?;
    let file = fs::File::open(snapshot_path(&directory(root, path), id)?).map_err(io_error)?;
    let mut bytes = Vec::new();
    file.take(super::super::MAX_DOCUMENT_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > super::super::MAX_DOCUMENT_SIZE || version(&bytes) != entry.version {
        return Err(failure("history", "历史版本内容校验失败，未修改原文件。"));
    }
    Ok(bytes)
}
fn restore(root: &Path, path: &Path, id: &str, expected: &str) -> Result<SaveReply, SaveFailure> {
    let bytes = read_snapshot(root, path, id)?;
    String::from_utf8(bytes.clone()).map_err(|_| failure("history", "历史版本编码无效。"))?;
    let current = current_bytes(path)?;
    if version(&current) != expected {
        return Err(failure(
            "conflict",
            "文件已被其他程序修改，请关闭历史窗口并重新读取，再决定恢复。",
        ));
    }
    protect(root, path, &current, "restore", true)?;
    replace_bytes(path, &bytes, expected)
}
#[tauri::command]
pub async fn list_history(app: tauri::AppHandle, path: String) -> Result<Vec<Entry>, SaveFailure> {
    let path = authorize(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        list(&root(&app)?, &path)
    })
    .await
    .map_err(|e| failure("history", e.to_string()))?
}
#[tauri::command]
pub async fn preview_history(
    app: tauri::AppHandle,
    path: String,
    id: String,
) -> Result<Preview, SaveFailure> {
    let path = authorize(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        let bytes = read_snapshot(&root(&app)?, &path, &id)?;
        let content = String::from_utf8(bytes)
            .map_err(|_| failure("history", "历史版本编码无效。"))?
            .trim_start_matches('\u{feff}')
            .to_string();
        Ok(Preview { content })
    })
    .await
    .map_err(|e| failure("history", e.to_string()))?
}
#[tauri::command]
pub async fn restore_history(
    app: tauri::AppHandle,
    path: String,
    id: String,
    expected_version: String,
) -> Result<SaveReply, SaveFailure> {
    let path = authorize(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        restore(&root(&app)?, &path, &id, &expected_version)
    })
    .await
    .map_err(|e| failure("history", e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_edit_is_retained_restore_preserves_current_and_format() {
        let temp = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(temp.path()).unwrap().join("文档.md");
        let root = fs::canonicalize(temp.path()).unwrap().join("history");
        let original = b"\xef\xbb\xbf# original\r\n";
        fs::write(&path, original).unwrap();
        super::super::save_with_history(&root, &path, "# changed\n", &version(original), "one")
            .unwrap();
        let changed = fs::read(&path).unwrap();
        super::super::save_with_history(
            &root,
            &path,
            "# changed twice\n",
            &version(&changed),
            "one",
        )
        .unwrap();
        assert_eq!(list(&root, &path).unwrap().len(), 1);
        let id = list(&root, &path).unwrap()[0].id.clone();
        let before = fs::read(&path).unwrap();
        restore(&root, &path, &id, &version(&before)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), original);
        let entries = list(&root, &path).unwrap();
        assert_eq!(entries[0].reason, "恢复前");
        assert_eq!(read_snapshot(&root, &path, &entries[0].id).unwrap(), before);
    }
    #[test]
    fn external_changes_and_invalid_snapshot_never_overwrite() {
        let t = tempfile::tempdir().unwrap();
        let p = fs::canonicalize(t.path()).unwrap().join("note.md");
        let r = fs::canonicalize(t.path()).unwrap().join("history");
        fs::write(&p, b"original").unwrap();
        protect(&r, &p, b"original", "one", false).unwrap();
        let id = list(&r, &p).unwrap()[0].id.clone();
        fs::write(&p, b"external").unwrap();
        assert!(restore(&r, &p, &id, &version(b"original")).is_err());
        assert_eq!(fs::read(&p).unwrap(), b"external");
        assert!(read_snapshot(&r, &p, "../../x").is_err());
        fs::write(snapshot_path(&directory(&r, &p), &id).unwrap(), b"corrupt").unwrap();
        assert!(restore(&r, &p, &id, &version(b"external")).is_err());
        assert_eq!(fs::read(&p).unwrap(), b"external");
    }
    #[test]
    fn retention_is_bounded_and_failed_backup_stops_writes() {
        let t = tempfile::tempdir().unwrap();
        let p = fs::canonicalize(t.path()).unwrap().join("note.md");
        let r = fs::canonicalize(t.path()).unwrap().join("history");
        for n in 0..30 {
            protect(
                &r,
                &p,
                format!("v{n}").as_bytes(),
                &format!("session{n}"),
                false,
            )
            .unwrap();
        }
        assert_eq!(list(&r, &p).unwrap().len(), MAX_VERSIONS);
        fs::write(&p, b"safe").unwrap();
        let bad = fs::canonicalize(t.path()).unwrap().join("blocked");
        fs::write(&bad, b"file").unwrap();
        assert!(super::super::save_with_history(&bad, &p, "new", &version(b"safe"), "s").is_err());
        assert_eq!(fs::read(&p).unwrap(), b"safe");
    }
    #[test]
    fn global_limit_keeps_new_recovery_even_if_clock_moves_backwards() {
        let t = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(t.path()).unwrap();
        let r = base.join("history");
        let old = base.join("old.md");
        let new = base.join("new.md");
        protect(&r, &old, b"old", "s1", false).unwrap();
        let dir = directory(&r, &old);
        let mut index = read_index(&dir).unwrap();
        index.entries[0].created_at = u64::MAX;
        write_index(&dir, &index).unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(snapshot_path(&dir, &index.entries[0].id).unwrap())
            .unwrap()
            .set_len(MAX_TOTAL_BYTES)
            .unwrap();
        fs::write(dir.join("deadbeef.md"), b"orphan").unwrap();
        protect(&r, &new, b"new recovery", "s2", false).unwrap();
        assert!(list(&r, &old).unwrap().is_empty());
        assert!(!dir.join("deadbeef.md").exists());
        let latest = list(&r, &new).unwrap();
        assert_eq!(
            read_snapshot(&r, &new, &latest[0].id).unwrap(),
            b"new recovery"
        );
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    total_bytes: u64,
    total_versions: usize,
    document_bytes: u64,
    document_versions: usize,
}
fn usage(root: &Path, path: &Path) -> Result<Usage, SaveFailure> {
    let mut result = Usage {
        total_bytes: 0,
        total_versions: 0,
        document_bytes: 0,
        document_versions: 0,
    };
    if !root.exists() {
        return Ok(result);
    }
    let current = directory(root, path);
    for dir in fs::read_dir(root).map_err(io_error)? {
        let dir = dir.map_err(io_error)?;
        if !dir.file_type().map_err(io_error)?.is_dir() {
            continue;
        }
        for file in fs::read_dir(dir.path()).map_err(io_error)? {
            let file = file.map_err(io_error)?;
            if file.path().extension().is_some_and(|e| e == "md")
                && file.file_type().map_err(io_error)?.is_file()
            {
                let size = file.metadata().map_err(io_error)?.len();
                result.total_bytes += size;
                result.total_versions += 1;
                if dir.path() == current {
                    result.document_bytes += size;
                    result.document_versions += 1;
                }
            }
        }
    }
    Ok(result)
}
fn clear(root: &Path, path: &Path, id: Option<&str>) -> Result<(), SaveFailure> {
    let dir = directory(root, path);
    if !dir.exists() {
        return Ok(());
    }
    if let Some(id) = id {
        let mut index = read_index(&dir)?;
        if !index.entries.iter().any(|e| e.id == id) {
            return Err(failure("history", "该历史版本已经移除，请刷新列表。"));
        }
        let snapshot = snapshot_path(&dir, id)?;
        index.entries.retain(|e| e.id != id);
        index.ready = false;
        write_index(&dir, &index)?;
        if snapshot.exists() {
            fs::remove_file(snapshot).map_err(io_error)?;
        }
    } else {
        // Rename only this computed document directory before removing its contents.
        let temp = tempfile::tempdir_in(root).map_err(io_error)?;
        fs::rename(dir, temp.path().join("removed")).map_err(io_error)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn history_usage(app: tauri::AppHandle, path: String) -> Result<Usage, SaveFailure> {
    let path = authorize(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        usage(&root(&app)?, &path)
    })
    .await
    .map_err(|e| failure("history", e.to_string()))?
}
#[tauri::command]
pub async fn clear_history(
    app: tauri::AppHandle,
    path: String,
    id: Option<String>,
) -> Result<(), SaveFailure> {
    let path = authorize(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EditingState>();
        let _lock = state.operations.lock().unwrap();
        clear(&root(&app)?, &path, id.as_deref())
    })
    .await
    .map_err(|e| failure("history", e.to_string()))?
}
#[cfg(test)]
mod management_tests {
    use super::*;
    #[test]
    fn cleanup_only_removes_requested_history_and_future_saves_still_protect() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("history");
        let a = t.path().join("a.md");
        let b = t.path().join("b.md");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        protect(&root, &a, b"a", "one", false).unwrap();
        protect(&root, &b, b"b", "two", false).unwrap();
        assert_eq!(usage(&root, &a).unwrap().total_versions, 2);
        let id = list(&root, &a).unwrap()[0].id.clone();
        clear(&root, &a, Some(&id)).unwrap();
        assert!(list(&root, &a).unwrap().is_empty());
        protect(&root, &a, b"a", "three", false).unwrap();
        clear(&root, &a, None).unwrap();
        assert_eq!(list(&root, &b).unwrap().len(), 1);
        assert_eq!(fs::read_to_string(&a).unwrap(), "a");
        protect(&root, &a, b"a", "four", false).unwrap();
        assert_eq!(list(&root, &a).unwrap().len(), 1);
    }
}
