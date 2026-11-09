use super::*;
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    from: usize,
    to: usize,
    path: PathBuf,
    #[serde(default)]
    suffix: String,
    image: bool,
    attribute: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyReply {
    version: String,
    content: String,
    images: usize,
}
fn relative_uri(parent: &Path, target: &Path, suffix: &str) -> Result<String, SaveFailure> {
    let base =
        url::Url::from_directory_path(parent).map_err(|_| failure("path", "副本目录无效。"))?;
    let target = url::Url::from_file_path(target).map_err(|_| failure("path", "资源路径无效。"))?;
    let uri = base
        .make_relative(&target)
        .ok_or_else(|| failure("path", "无法调整本地引用。"))?;
    let uri = if uri.split('/').next().is_some_and(|p| p.contains(':')) {
        format!("./{uri}")
    } else {
        uri
    };
    Ok(format!("{uri}{suffix}")
        .replace('(', "%28")
        .replace(')', "%29"))
}
fn byte_offsets(
    content: &str,
    references: &[Reference],
) -> Result<BTreeMap<usize, usize>, SaveFailure> {
    let mut offsets: BTreeMap<usize, usize> = references
        .iter()
        .flat_map(|r| [(r.from, 0), (r.to, 0)])
        .collect();
    let mut wanted = offsets
        .keys()
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .peekable();
    let mut utf16 = 0;
    for (byte, c) in content.char_indices() {
        if wanted.peek() == Some(&utf16) {
            offsets.insert(utf16, byte);
            wanted.next();
        }
        if wanted
            .peek()
            .is_some_and(|&position| position < utf16 + c.len_utf16())
        {
            return Err(failure("reference", "本地引用的位置无效，尚未另存。"));
        }
        utf16 += c.len_utf16();
    }
    if wanted.peek() == Some(&utf16) {
        offsets.insert(utf16, content.len());
        wanted.next();
    }
    if wanted.next().is_some() {
        return Err(failure("reference", "本地引用超出文档范围，尚未另存。"));
    }
    Ok(offsets)
}
fn image_bytes(path: &Path) -> Result<Vec<u8>, SaveFailure> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ![
        "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "apng",
    ]
    .contains(&ext.as_str())
    {
        return Err(failure(
            "image",
            format!("本地图片格式暂不支持：{}", path.display()),
        ));
    }
    let file = fs::File::open(path).map_err(|e| {
        failure(
            "image",
            format!("无法复制图片 {}：{e}。原文和输入仍保留。", path.display()),
        )
    })?;
    let metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_file() || metadata.len() > 32 * 1024 * 1024 {
        return Err(failure(
            "image",
            "单张图片超过32 MB或不是普通文件，尚未另存。",
        ));
    }
    let mut bytes = Vec::new();
    file.take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(failure("size", "图片超过32 MB，尚未另存。"));
    }
    Ok(bytes)
}
pub(super) fn save(
    path: &Path,
    content: String,
    source: Option<&Path>,
    mut references: Vec<Reference>,
) -> Result<CopyReply, SaveFailure> {
    if !path.is_absolute()
        || !crate::is_markdown(path)
        || content.len() as u64 > crate::MAX_DOCUMENT_SIZE
    {
        return Err(failure("path", "请选择 Markdown 文件，内容不能超过16 MB。"));
    }
    let parent = fs::canonicalize(
        path.parent()
            .ok_or_else(|| failure("path", "副本目录无效。"))?,
    )
    .map_err(io_error)?;
    let destination = parent.join(
        path.file_name()
            .ok_or_else(|| failure("path", "副本文件名无效。"))?,
    );
    if fs::symlink_metadata(&destination).is_ok() {
        return Err(failure("exists", "副本文件名已存在，请换一个文件名。"));
    }
    if references.len() > 4000 {
        return Err(failure("size", "本地引用过多，尚未另存。"));
    }
    if source.is_none() && !references.is_empty() {
        return Err(failure("path", "原文位置不明确，无法搬运图片。"));
    }
    let same_folder = source.and_then(Path::parent) == Some(parent.as_path());
    if references.is_empty() {
        let reply = save_copy_inner(&destination, &content)?;
        return Ok(CopyReply {
            version: reply.version,
            content,
            images: 0,
        });
    }
    references.sort_by_key(|r| r.from);
    let mut end = 0;
    for r in &references {
        if r.from < end
            || r.from >= r.to
            || !r.path.is_absolute()
            || !matches!(r.attribute.as_deref(), None | Some("src") | Some("href"))
        {
            return Err(failure("reference", "本地引用信息无效，尚未另存。"));
        }
        end = r.to;
    }
    let offsets = byte_offsets(&content, &references)?;
    for reference in &mut references {
        if let Ok(canonical) = fs::canonicalize(&reference.path) {
            reference.path = canonical;
        }
    }
    let mut staging: Option<tempfile::TempDir> = None;
    let mut copied: HashMap<PathBuf, PathBuf> = HashMap::new();
    let mut total = 0usize;
    for r in references.iter().filter(|r| r.image && !same_folder) {
        if copied.contains_key(&r.path) {
            continue;
        }
        if copied.len() >= 1000 {
            return Err(failure("size", "本地图片超过1000张，尚未另存。"));
        }
        let bytes = image_bytes(&r.path)?;
        total += bytes.len();
        if total > 128 * 1024 * 1024 {
            return Err(failure(
                "size",
                "本地图片合计超过128 MB，请拆分文档后另存。",
            ));
        }
        if staging.is_none() {
            let stem: String = destination
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .chars()
                .take(40)
                .collect();
            staging = Some(
                tempfile::Builder::new()
                    .prefix(&format!("{stem}.assets-"))
                    .tempdir_in(&parent)
                    .map_err(io_error)?,
            );
        }
        let extension = r
            .path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        let target = staging
            .as_ref()
            .unwrap()
            .path()
            .join(format!("{}.{extension}", version(&bytes)));
        if !target.exists() {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(io_error)?;
            file.write_all(&bytes).map_err(io_error)?;
            file.sync_all().map_err(io_error)?;
        }
        copied.insert(r.path.clone(), target);
    }
    let mut rewritten = content;
    for r in references.iter().rev() {
        if same_folder && (r.image || source != Some(r.path.as_path())) {
            continue;
        }
        let target = copied.get(&r.path).map(PathBuf::as_path).unwrap_or(
            if source == Some(r.path.as_path()) {
                &destination
            } else {
                &r.path
            },
        );
        let uri = relative_uri(&parent, target, &r.suffix)?;
        let replacement = if let Some(attribute) = &r.attribute {
            format!(
                "{attribute}=\"{}\"",
                uri.replace('&', "&amp;")
                    .replace('"', "&quot;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
            )
        } else {
            uri
        };
        rewritten.replace_range(offsets[&r.from]..offsets[&r.to], &replacement);
    }
    let reply = save_copy_inner(&destination, &rewritten)?;
    if let Some(staging) = staging {
        let _ = staging.keep();
    }
    Ok(CopyReply {
        version: reply.version,
        content: rewritten,
        images: copied.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reference(text: &str, needle: &str, path: PathBuf, image: bool) -> Reference {
        let byte = text.find(needle).unwrap();
        Reference {
            from: text[..byte].encode_utf16().count(),
            to: text[..byte + needle.len()].encode_utf16().count(),
            path,
            suffix: String::new(),
            image,
            attribute: None,
        }
    }
    #[test]
    fn cross_directory_copy_carries_same_named_images_and_rebases_links_without_changing_source() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let old = root.join("原目录");
        let new = root.join("新目录");
        fs::create_dir_all(old.join("a")).unwrap();
        fs::create_dir_all(old.join("b")).unwrap();
        fs::create_dir(&new).unwrap();
        fs::write(old.join("a/x.png"), b"image-one").unwrap();
        fs::write(old.join("b/x.png"), b"image-two").unwrap();
        let source = old.join("note.md");
        let destination = new.join("副本.md");
        let text = "😀\r\n![a](a/x.png) ![b](b/x.png)\r\n[next](next.md)";
        fs::write(&source, text).unwrap();
        let refs = vec![
            reference(text, "a/x.png", old.join("a/x.png"), true),
            reference(text, "b/x.png", old.join("b/x.png"), true),
            reference(text, "next.md", old.join("next.md"), false),
        ];
        let reply = save(&destination, text.into(), Some(&source), refs).unwrap();
        assert_eq!(reply.images, 2);
        assert_eq!(fs::read_to_string(&source).unwrap(), text);
        assert_eq!(fs::read_to_string(&destination).unwrap(), reply.content);
        assert!(reply
            .content
            .contains("../%E5%8E%9F%E7%9B%AE%E5%BD%95/next.md"));
        assert!(reply.content.starts_with("😀\r\n"));
        let folder = fs::read_dir(&new)
            .unwrap()
            .map(Result::unwrap)
            .find(|f| f.file_type().unwrap().is_dir())
            .unwrap()
            .path();
        let mut bytes: Vec<_> = fs::read_dir(folder)
            .unwrap()
            .map(|f| fs::read(f.unwrap().path()).unwrap())
            .collect();
        bytes.sort();
        assert_eq!(bytes, vec![b"image-one".to_vec(), b"image-two".to_vec()]);
    }
    #[test]
    fn failed_copy_cleans_only_its_own_staging_and_never_overwrites_existing_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let new = root.join("new");
        fs::create_dir(&new).unwrap();
        let source = root.join("note.md");
        fs::write(&source, "original").unwrap();
        fs::write(root.join("a.png"), b"image").unwrap();
        let text = "![a](a.png) ![missing](missing.png)";
        let refs = vec![
            reference(text, "a.png", root.join("a.png"), true),
            reference(text, "missing.png", root.join("missing.png"), true),
        ];
        assert!(save(&new.join("copy.md"), text.into(), Some(&source), refs).is_err());
        assert_eq!(fs::read_dir(&new).unwrap().count(), 0);
        fs::write(new.join("copy.md"), "existing").unwrap();
        assert!(save(&new.join("copy.md"), text.into(), Some(&source), Vec::new()).is_err());
        assert_eq!(fs::read_to_string(new.join("copy.md")).unwrap(), "existing");
        assert_eq!(fs::read_to_string(source).unwrap(), "original");
    }
    #[test]
    fn same_directory_reuses_resources_and_invalid_utf16_offsets_do_not_create_output() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let source = root.join("note.md");
        fs::write(&source, "original").unwrap();
        let text = "![a](a.png)";
        let reply = save(
            &root.join("copy.md"),
            text.into(),
            Some(&source),
            vec![reference(text, "a.png", root.join("a.png"), true)],
        )
        .unwrap();
        assert_eq!(reply.content, text);
        assert_eq!(reply.images, 0);
        let new = root.join("new");
        fs::create_dir(&new).unwrap();
        let bad = Reference {
            from: 1,
            to: 2,
            path: root.join("a.png"),
            suffix: String::new(),
            image: true,
            attribute: None,
        };
        assert!(save(&new.join("bad.md"), "😀".into(), Some(&source), vec![bad]).is_err());
        assert_eq!(fs::read_dir(new).unwrap().count(), 0);
    }
}

#[cfg(test)]
mod more_tests {
    use super::*;
    fn reference(text: &str, needle: &str, path: PathBuf, image: bool) -> Reference {
        let at = text.find(needle).unwrap();
        Reference {
            from: text[..at].encode_utf16().count(),
            to: text[..at + needle.len()].encode_utf16().count(),
            path,
            suffix: String::new(),
            image,
            attribute: None,
        }
    }
    #[test]
    fn html_entities_queries_and_self_links_survive_unicode_paths() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let new = root.join("100%25 中文");
        fs::create_dir(&new).unwrap();
        let source = root.join("note.md");
        fs::write(&source, "original").unwrap();
        let image = root.join("image x.svg");
        fs::write(&image, b"<svg/>").unwrap();
        let text = "😀 <img ALT=\"title\" SRC='image%20x.svg?x=1&amp;y=2'> [self](note.md#section)";
        let mut pic = reference(text, "SRC='image%20x.svg?x=1&amp;y=2'", image, true);
        pic.attribute = Some("src".into());
        pic.suffix = "?x=1&y=2".into();
        let mut link = reference(text, "note.md#section", source.clone(), false);
        link.suffix = "#section".into();
        let reply = save(
            &new.join("copy.md"),
            text.into(),
            Some(&source),
            vec![pic, link],
        )
        .unwrap();
        assert!(reply.content.starts_with("😀 <img ALT=\"title\" src=\""));
        assert!(reply.content.contains("?x=1&amp;y=2\""));
        assert!(reply.content.ends_with("[self](copy.md#section)"));
    }
    #[test]
    fn exceeding_document_limit_after_rewrite_rolls_back_assets() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let new = root.join("new");
        fs::create_dir(&new).unwrap();
        let source = root.join("a.md");
        fs::write(&source, "safe").unwrap();
        let image = root.join("x.png");
        fs::write(&image, "image").unwrap();
        let mut text = "![x](x.png)".to_owned();
        text.push_str(&"x".repeat(crate::MAX_DOCUMENT_SIZE as usize - text.len()));
        let r = reference(&text, "x.png", image, true);
        assert!(save(&new.join("copy.md"), text, Some(&source), vec![r]).is_err());
        assert_eq!(fs::read_dir(new).unwrap().count(), 0);
        assert_eq!(fs::read_to_string(source).unwrap(), "safe");
    }
    #[cfg(unix)]
    #[test]
    fn destination_symlink_uses_real_parent_for_relative_paths() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let real = root.join("real");
        fs::create_dir(&real).unwrap();
        let alias = root.join("alias");
        std::os::unix::fs::symlink(&real, &alias).unwrap();
        let source = root.join("a.md");
        fs::write(&source, "safe").unwrap();
        let text = "[next](next.md)";
        let r = reference(text, "next.md", root.join("next.md"), false);
        let reply = save(&alias.join("copy.md"), text.into(), Some(&source), vec![r]).unwrap();
        assert_eq!(reply.content, "[next](../next.md)");
        assert_eq!(
            fs::read_to_string(real.join("copy.md")).unwrap(),
            reply.content
        );
    }
}

#[cfg(test)]
mod same_folder_self_link {
    use super::*;
    #[test]
    fn same_folder_keeps_image_urls_but_retargets_self_links() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let source = root.join("note.md");
        let text = "![keep](missing.png) [self](note.md#part)";
        fs::write(&source, text).unwrap();
        let reference = |needle: &str, path: PathBuf, image| {
            let start = text.find(needle).unwrap();
            Reference {
                from: start,
                to: start + needle.len(),
                path,
                suffix: if image { String::new() } else { "#part".into() },
                image,
                attribute: None,
            }
        };
        let refs = vec![
            reference("missing.png", root.join("missing.png"), true),
            reference("note.md#part", source.clone(), false),
        ];
        let reply = save(&root.join("copy.md"), text.into(), Some(&source), refs).unwrap();
        assert_eq!(reply.content, "![keep](missing.png) [self](copy.md#part)");
        assert_eq!(reply.images, 0);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        assert_eq!(fs::read_to_string(source).unwrap(), text);
    }
}
