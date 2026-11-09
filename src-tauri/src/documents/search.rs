use crate::Document;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::Manager;

#[derive(Default)]
pub struct SearchState(Arc<Mutex<Option<String>>>, Arc<Mutex<()>>);
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Buffer {
    path: String,
    text: String,
    version: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    path: String,
    name: String,
    version: String,
    line: usize,
    column: usize,
    length: usize,
    matched: String,
    before: String,
    after: String,
    buffer: bool,
}
#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    hits: Vec<Hit>,
    failures: Vec<SearchFailure>,
    searched: usize,
    total: usize,
    truncated: bool,
    cancelled: bool,
}
#[derive(Debug, Serialize)]
pub struct SearchFailure {
    path: String,
    message: String,
}
fn scan_with_drafts(
    paths: Vec<String>,
    query: &str,
    buffer: Option<Buffer>,
    drafts: Option<&Path>,
    current: impl Fn() -> bool,
) -> Results {
    let paths: Vec<_> = paths
        .into_iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let mut result = Results {
        total: paths.len(),
        ..Default::default()
    };
    if query.trim().is_empty() {
        return result;
    }
    let Ok(pattern) = regex::RegexBuilder::new(&regex::escape(query.trim()))
        .case_insensitive(true)
        .build()
    else {
        return result;
    };
    let mut paths = paths;
    // Preserve a stable order, with the current document first.
    paths.sort_by(|a, b| {
        (buffer.as_ref().is_none_or(|v| &v.path != a), a)
            .cmp(&(buffer.as_ref().is_none_or(|v| &v.path != b), b))
    });
    let mut bytes = 0usize;
    let mut seen = HashSet::new();
    for (index, path) in paths.iter().enumerate() {
        if !current() {
            result.cancelled = true;
            break;
        }
        if index >= 500 || bytes >= 128 * 1024 * 1024 || result.hits.len() >= 500 {
            result.truncated = true;
            break;
        }
        if !Path::new(path).is_absolute() || !crate::is_markdown(Path::new(path)) {
            result.failures.push(SearchFailure {
                path: path.clone(),
                message: "不是本地 Markdown 文件。".into(),
            });
            continue;
        }
        let active = buffer.as_ref().filter(|b| b.path == *path);
        let doc = if let Some(active) = active {
            if active.text.len() > crate::MAX_DOCUMENT_SIZE as usize {
                result.failures.push(SearchFailure {
                    path: path.clone(),
                    message: "当前内容超过16 MB，未搜索。".into(),
                });
                continue;
            }
            Document {
                path: path.clone(),
                name: Path::new(path)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                content: active.text.clone(),
                version: active.version.clone(),
                draft: None,
                writable: false,
                untitled: false,
                unavailable: false,
                recovery_warning: None,
            }
        } else {
            let loaded = if let Some(drafts) = drafts {
                crate::read_document_with_draft(path.clone(), None, drafts)
            } else {
                crate::read_document_inner(path.clone(), None)
            };
            match loaded {
                Ok(doc) => doc,
                Err(message) => {
                    result.failures.push(SearchFailure {
                        path: path.clone(),
                        message,
                    });
                    continue;
                }
            }
        };
        if !seen.insert(doc.path.clone()) {
            continue;
        }
        if doc.content.len() > crate::MAX_DOCUMENT_SIZE as usize {
            result.failures.push(SearchFailure {
                path: path.clone(),
                message: "内容超过16 MB，未搜索。".into(),
            });
            continue;
        }
        bytes += doc.content.len();
        if bytes > 128 * 1024 * 1024 {
            result.truncated = true;
            break;
        }
        result.searched += 1;
        let normalized = doc.content.replace("\r\n", "\n").replace('\r', "\n");
        let mut count = 0;
        for (line, text) in normalized.split('\n').enumerate() {
            if line % 256 == 0 && !current() {
                result.cancelled = true;
                break;
            }
            for found in pattern.find_iter(text) {
                if count >= 25 || result.hits.len() >= 500 {
                    result.truncated = true;
                    break;
                }
                let start = text[..found.start()]
                    .char_indices()
                    .rev()
                    .nth(55)
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                let end = text[found.end()..]
                    .char_indices()
                    .nth(90)
                    .map(|(i, _)| found.end() + i)
                    .unwrap_or(text.len());
                result.hits.push(Hit {
                    path: doc.path.clone(),
                    name: doc.name.clone(),
                    version: doc.version.clone(),
                    line: line + 1,
                    column: text[..found.start()].encode_utf16().count(),
                    length: found.as_str().encode_utf16().count(),
                    matched: found.as_str().into(),
                    before: format!(
                        "{}{}",
                        if start > 0 { "…" } else { "" },
                        &text[start..found.start()]
                    ),
                    after: format!(
                        "{}{}",
                        &text[found.end()..end],
                        if end < text.len() { "…" } else { "" }
                    ),
                    buffer: active.is_some(),
                });
                count += 1;
            }
            if count >= 25 || result.hits.len() >= 500 {
                result.truncated = true;
                break;
            }
            if result.cancelled {
                break;
            }
        }
    }
    result
}
#[tauri::command]
pub async fn search_documents(
    app: tauri::AppHandle,
    request_id: String,
    paths: Vec<String>,
    query: String,
    buffer: Option<Buffer>,
) -> Result<Results, String> {
    if paths.len() > 5000 || query.chars().count() > 200 {
        return Err("搜索范围或关键词过长。".into());
    }
    let drafts = crate::editing::draft_root(&app).map_err(|e| e.message)?;
    let state = app.state::<SearchState>();
    *state.0.lock().unwrap() = Some(request_id.clone());
    let active = state.0.clone();
    let serial = state.1.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _serial = serial.lock().unwrap();
        Ok(scan_with_drafts(
            paths,
            &query,
            buffer,
            Some(&drafts),
            || active.lock().unwrap().as_ref() == Some(&request_id),
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn cancel_document_search(app: tauri::AppHandle, request_id: String) {
    let state = app.state::<SearchState>();
    let mut active = state.0.lock().unwrap();
    if active.as_ref() == Some(&request_id) {
        *active = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    fn scan(
        paths: Vec<String>,
        query: &str,
        buffer: Option<Buffer>,
        current: impl Fn() -> bool,
    ) -> Results {
        super::scan_with_drafts(paths, query, buffer, None, current)
    }
    #[test]
    fn searches_only_explicit_files_and_current_buffer_without_writing() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let a = root.join("a.md");
        let b = root.join("b.md");
        let closed = root.join("closed.md");
        fs::write(&a, "# Disk unchanged").unwrap();
        fs::write(&b, "# B\r\n😀 İx a+b\r\nNeedle").unwrap();
        fs::write(&closed, "Needle").unwrap();
        let buffer = Buffer {
            path: a.to_string_lossy().into(),
            text: "# Unsaved Needle".into(),
            version: "buffer-version".into(),
        };
        let paths = vec![
            a.to_string_lossy().into(),
            b.to_string_lossy().into(),
            root.join("missing.md").to_string_lossy().into(),
        ];
        let found = scan(paths, "needle", Some(buffer), || true);
        assert_eq!(found.hits.len(), 2);
        assert_eq!(found.hits[0].path, a.to_string_lossy());
        assert!(found.hits[0].buffer);
        assert_eq!(found.failures.len(), 1);
        assert_eq!(found.searched, 2);
        assert!(found
            .hits
            .iter()
            .all(|h| h.path != closed.to_string_lossy()));
        assert_eq!(fs::read_to_string(&a).unwrap(), "# Disk unchanged");
        let literal = scan(vec![b.to_string_lossy().into()], "a+b", None, || true);
        assert_eq!(literal.hits[0].line, 2);
        assert_eq!(literal.hits[0].column, 6);
        assert_eq!(literal.hits[0].matched, "a+b");
    }
    #[test]
    fn caps_results_and_honors_cancellation() {
        let temp = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(temp.path()).unwrap().join("many.md");
        fs::write(&path, "needle\n".repeat(100)).unwrap();
        let found = scan(vec![path.to_string_lossy().into()], "needle", None, || true);
        assert_eq!(found.hits.len(), 25);
        assert!(found.truncated);
        let cancelled = scan(vec![path.to_string_lossy().into()], "needle", None, || {
            false
        });
        assert!(cancelled.cancelled);
        assert_eq!(cancelled.searched, 0);
        assert!(cancelled.hits.is_empty());
    }
    #[test]
    fn long_unicode_context_is_bounded_and_safe() {
        let temp = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(temp.path()).unwrap().join("unicode.md");
        fs::write(
            &path,
            format!("{}Needle{}", "😀中".repeat(500), "文😀".repeat(500)),
        )
        .unwrap();
        let found = scan(vec![path.to_string_lossy().into()], "NEEDLE", None, || true);
        assert_eq!(found.hits[0].column, 1500);
        assert!(found.hits[0].before.chars().count() <= 58);
        assert!(found.hits[0].after.chars().count() <= 92);
    }
}
