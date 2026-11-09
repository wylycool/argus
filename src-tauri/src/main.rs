#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager,
};
mod documents;
mod editing;
mod reading;
use editing::EditingState;

const MAX_DOCUMENT_SIZE: u64 = 16 * 1024 * 1024;
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    path: String,
    name: String,
    content: String,
    version: String,
    draft: Option<editing::Draft>,
    writable: bool,
    untitled: bool,
    unavailable: bool,
    recovery_warning: Option<String>,
}
fn is_markdown(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| {
        ["md", "markdown", "mdown", "mkd"].contains(&s.to_ascii_lowercase().as_str())
    })
}
fn resolve_path(path: &str, base: Option<&str>) -> Result<PathBuf, String> {
    let p = if path.starts_with("file:") {
        url::Url::parse(path)
            .map_err(|_| "文件地址无效")?
            .to_file_path()
            .map_err(|_| "文件地址无效")?
    } else {
        PathBuf::from(path)
    };
    let p = if p.is_absolute() {
        p
    } else if let Some(base) = base {
        Path::new(base).parent().ok_or("文件目录无效")?.join(p)
    } else {
        p
    };
    if !is_markdown(&p) {
        return Err("请选择 .md、.markdown、.mdown 或 .mkd 文件".into());
    }
    fs::canonicalize(p).map_err(|e| format!("无法打开文件：{e}"))
}
#[tauri::command]
async fn read_document(
    app: tauri::AppHandle,
    path: String,
    base: Option<String>,
) -> Result<Document, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut document = read_document_with_draft(
            path,
            base,
            &editing::draft_root(&app).map_err(|e| e.message)?,
        )?;
        document.untitled = documents::is_untitled(&app, Path::new(&document.path));
        app.state::<EditingState>()
            .opened
            .lock()
            .unwrap()
            .insert(PathBuf::from(&document.path));
        Ok(document)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn read_document_with_draft(
    path: String,
    base: Option<String>,
    drafts: &Path,
) -> Result<Document, String> {
    match read_document_inner(path.clone(), base.clone()) {
        Ok(mut document) => {
            match editing::read_draft_checked(drafts, &document.path) {
                Ok(draft) => document.draft = draft,
                Err(error) => document.recovery_warning = Some(error.message),
            }
            Ok(document)
        }
        Err(original) => {
            let mut requested = if path.starts_with("file:") {
                url::Url::parse(&path)
                    .ok()
                    .and_then(|url| url.to_file_path().ok())
                    .ok_or_else(|| original.clone())?
            } else {
                PathBuf::from(&path)
            };
            if !requested.is_absolute() {
                if let Some(parent) = base.as_deref().and_then(|p| Path::new(p).parent()) {
                    requested = parent.join(requested);
                }
            }
            if let (Some(parent), Some(name)) = (requested.parent(), requested.file_name()) {
                if let Ok(parent) = fs::canonicalize(parent) {
                    requested = parent.join(name);
                }
            }
            if !requested.is_absolute() || !is_markdown(&requested) {
                return Err(original);
            }
            let path = requested.to_string_lossy().into_owned();
            let draft = editing::read_draft_checked(drafts, &path)
                .map_err(|e| format!("{original}。{}", e.message))?
                .ok_or(original)?;
            Ok(Document {
                name: requested
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                path,
                content: draft.text.clone(),
                version: draft.base_version.clone(),
                draft: Some(draft),
                writable: false,
                untitled: false,
                unavailable: true,
                recovery_warning: Some(
                    "原文件无法读取，当前展示本机恢复草稿。请另存副本以保留内容。".into(),
                ),
            })
        }
    }
}
fn read_document_inner(path: String, base: Option<String>) -> Result<Document, String> {
    let path = resolve_path(&path, base.as_deref())?;
    let file = fs::File::open(&path).map_err(|e| format!("无法读取文件：{e}"))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("请选择 Markdown 文件，而不是文件夹".into());
    }
    let mut bytes = Vec::with_capacity(
        file.metadata()
            .map_err(|e| e.to_string())?
            .len()
            .min(MAX_DOCUMENT_SIZE + 1) as usize,
    );
    file.take(MAX_DOCUMENT_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取失败：{e}"))?;
    if bytes.len() as u64 > MAX_DOCUMENT_SIZE {
        return Err("文档超过 16 MB，暂不支持打开这么大的文件".into());
    }
    let version = editing::version(&bytes);
    let content = String::from_utf8(bytes)
        .map_err(|_| "文档不是 UTF-8 编码，请先转换为 UTF-8")?
        .trim_start_matches('\u{feff}')
        .to_string();
    Ok(Document {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        path: path.to_string_lossy().into(),
        content,
        version,
        draft: None,
        writable: reading::is_writable(&path),
        untitled: false,
        unavailable: false,
        recovery_warning: None,
    })
}
#[tauri::command]
fn take_pending_files(state: tauri::State<PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}
#[tauri::command]
async fn authorize_images(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        for path in paths.into_iter().take(1000) {
            let path = PathBuf::from(path);
            let extension = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ![
                "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "apng",
            ]
            .contains(&extension.as_str())
            {
                continue;
            }
            if let Ok(metadata) = fs::metadata(&path) {
                if metadata.is_file() && metadata.len() <= 32 * 1024 * 1024 {
                    let _ = app.asset_protocol_scope().allow_file(path);
                }
            }
        }
    })
    .await
    .map_err(|e| format!("图片授权未完成：{e}"))?;
    Ok(())
}
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "链接地址无效")?;
    if !["http", "https", "mailto"].contains(&parsed.scheme()) {
        return Err("仅支持网页和邮件链接".into());
    }
    std::process::Command::new("/usr/bin/open")
        .arg("--")
        .arg(parsed.as_str())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn main() {
    let app = tauri::Builder::default()
        .manage(PendingFiles::default())
        .manage(EditingState::default())
        .manage(documents::WatchState::default())
        .manage(documents::search::SearchState::default())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("app-action", "close");
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_document,
            documents::new_document,
            documents::list_untitled,
            documents::remove_untitled,
            documents::insert_image,
            documents::watch_document,
            documents::print_document,
            documents::search::search_documents,
            documents::search::cancel_document_search,
            take_pending_files,
            authorize_images,
            open_external,
            editing::write_draft,
            editing::begin_edit_session,
            editing::clear_draft,
            editing::save_document,
            editing::save_copy,
            editing::history::list_history,
            editing::history::preview_history,
            editing::history::restore_history,
            editing::history::history_usage,
            editing::history::clear_history,
            reading::probe_document,
            reading::reveal_document,
            editing::finish_window_action
        ])
        .setup(|app| {
            let about = PredefinedMenuItem::about(
                app,
                Some("关于 Argus"),
                Some(tauri::menu::AboutMetadata {
                    copyright: Some("by wy".into()),
                    ..Default::default()
                }),
            )?;
            let app_menu = Submenu::with_items(
                app,
                "Argus",
                true,
                &[
                    &about,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, Some("服务"))?,
                    &PredefinedMenuItem::hide(app, Some("隐藏 Argus"))?,
                    &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
                    &PredefinedMenuItem::show_all(app, Some("显示全部"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "quit", "退出 Argus", true, Some("CmdOrCtrl+Q"))?,
                ],
            )?;
            let open = MenuItem::with_id(app, "open", "打开文档…", true, Some("CmdOrCtrl+O"))?;
            let reload =
                MenuItem::with_id(app, "reload", "重新读取文件", true, Some("CmdOrCtrl+R"))?;
            let save = MenuItem::with_id(app, "save", "立即保存", true, Some("CmdOrCtrl+S"))?;
            let edit_document = MenuItem::with_id(
                app,
                "edit",
                "编辑 / 保存并返回阅读",
                true,
                Some("CmdOrCtrl+E"),
            )?;
            let file = Submenu::with_items(
                app,
                "文件",
                true,
                &[
                    &MenuItem::with_id(app, "new", "新建文档", true, Some("CmdOrCtrl+N"))?,
                    &open,
                    &reload,
                    &save,
                    &MenuItem::with_id(
                        app,
                        "save-copy",
                        "另存为副本…",
                        true,
                        Some("CmdOrCtrl+Shift+S"),
                    )?,
                    &edit_document,
                    &MenuItem::with_id(app, "insert-image", "插入图片…", true, None::<&str>)?,
                    &MenuItem::with_id(
                        app,
                        "print-document",
                        "打印 / 另存为PDF…",
                        true,
                        Some("CmdOrCtrl+Shift+P"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        "quick-switch",
                        "快速切换文档…",
                        true,
                        Some("CmdOrCtrl+P"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        "history",
                        "历史版本…",
                        true,
                        Some("CmdOrCtrl+Shift+H"),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
                ],
            )?;
            let edit = Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some("撤销"))?,
                    &PredefinedMenuItem::redo(app, Some("重做"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some("剪切"))?,
                    &PredefinedMenuItem::copy(app, Some("复制"))?,
                    &PredefinedMenuItem::paste(app, Some("粘贴"))?,
                    &PredefinedMenuItem::select_all(app, Some("全选"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "find", "查找内容…", true, Some("CmdOrCtrl+F"))?,
                    &MenuItem::with_id(
                        app,
                        "search-opened",
                        "搜索已打开文档…",
                        true,
                        Some("CmdOrCtrl+Shift+F"),
                    )?,
                ],
            )?;
            let source = MenuItem::with_id(
                app,
                "view",
                "切换源码 / 阅读",
                true,
                Some("CmdOrCtrl+Shift+M"),
            )?;
            let theme = MenuItem::with_id(
                app,
                "theme",
                "切换浅色 / 深色",
                true,
                Some("CmdOrCtrl+Shift+L"),
            )?;
            let sidebar = MenuItem::with_id(
                app,
                "sidebar",
                "显示 / 隐藏导航",
                true,
                Some("CmdOrCtrl+\\"),
            )?;
            let view = Submenu::with_items(
                app,
                "显示",
                true,
                &[
                    &source,
                    &theme,
                    &sidebar,
                    &MenuItem::with_id(
                        app,
                        "navigate-back",
                        "返回上一处",
                        true,
                        Some("CmdOrCtrl+Alt+ArrowLeft"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        "font-increase",
                        "增大字号",
                        true,
                        Some("CmdOrCtrl+="),
                    )?,
                    &MenuItem::with_id(
                        app,
                        "font-decrease",
                        "减小字号",
                        true,
                        Some("CmdOrCtrl+-"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        "reading-reset",
                        "恢复默认排版",
                        true,
                        Some("CmdOrCtrl+0"),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::fullscreen(app, Some("进入全屏"))?,
                ],
            )?;
            app.set_menu(Menu::with_items(app, &[&app_menu, &file, &edit, &view])?)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit("menu-action", event.id().as_ref());
            });
            for arg in std::env::args().skip(1).filter(|a| !a.starts_with('-')) {
                if is_markdown(Path::new(&arg)) {
                    app.state::<PendingFiles>().0.lock().unwrap().push(arg);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Argus 启动失败");
    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
            if !handle
                .state::<EditingState>()
                .allow_exit
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                api.prevent_exit();
                let _ = handle.emit("app-action", "quit");
            }
        }
        if let tauri::RunEvent::Opened { ref urls } = event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into())
                .collect();
            handle
                .state::<PendingFiles>()
                .0
                .lock()
                .unwrap()
                .extend(paths);
            let _ = handle.emit("files-opened", ());
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        if let tauri::RunEvent::Reopen { .. } = event {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_source_still_exposes_its_saved_recovery_without_clearing_it() {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let path = base.join("deleted.md");
        let drafts = base.join("drafts");
        fs::create_dir(&drafts).unwrap();
        let draft = editing::Draft {
            path: path.to_string_lossy().into(),
            text: "# protected recovery".into(),
            base_version: "old-version".into(),
            session_id: "previous".into(),
            revision: 3,
        };
        let stored = drafts.join(format!("{}.json", editing::version(draft.path.as_bytes())));
        let encoded = serde_json::to_vec(&draft).unwrap();
        fs::write(&stored, &encoded).unwrap();
        let document = read_document_with_draft(draft.path.clone(), None, &drafts).unwrap();
        assert!(document.unavailable);
        assert!(!document.writable);
        assert_eq!(document.content, draft.text);
        assert_eq!(document.draft, Some(draft));
        assert!(!path.exists());
        assert_eq!(fs::read(&stored).unwrap(), encoded);
    }
    #[test]
    fn extensions_are_case_insensitive() {
        assert!(is_markdown(Path::new("笔记.MD")));
        assert!(!is_markdown(Path::new("bad.html")));
    }
    #[test]
    fn reject_non_markdown() {
        assert!(resolve_path("/tmp/test.txt", None)
            .unwrap_err()
            .contains("请选择"));
    }
    #[test]
    fn decode_file_url_and_relative_path() {
        let dir = std::env::temp_dir().join(format!("argus-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("中文 空格.md");
        fs::write(&path, "# test").unwrap();
        let url = url::Url::from_file_path(&path).unwrap();
        assert_eq!(
            resolve_path(url.as_str(), None).unwrap(),
            fs::canonicalize(&path).unwrap()
        );
        assert_eq!(
            resolve_path("中文 空格.md", Some(dir.join("base.md").to_str().unwrap())).unwrap(),
            fs::canonicalize(&path).unwrap()
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn read_document_preserves_file_and_rejects_invalid_inputs() {
        let dir = std::env::temp_dir().join(format!("argus-read-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("中文.md");
        let original = "\u{feff}# 标题\n\n正文";
        fs::write(&path, original).unwrap();
        let document = read_document_inner(path.to_string_lossy().into(), None).unwrap();
        assert_eq!(document.content, "# 标题\n\n正文");
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        let invalid = dir.join("invalid.md");
        fs::write(&invalid, [0xff, 0xfe]).unwrap();
        assert!(read_document_inner(invalid.to_string_lossy().into(), None)
            .err()
            .unwrap()
            .contains("UTF-8"));
        let huge = dir.join("huge.md");
        fs::File::create(&huge)
            .unwrap()
            .set_len(MAX_DOCUMENT_SIZE + 1)
            .unwrap();
        assert!(read_document_inner(huge.to_string_lossy().into(), None)
            .err()
            .unwrap()
            .contains("16 MB"));
        fs::remove_dir_all(dir).unwrap();
    }
}
