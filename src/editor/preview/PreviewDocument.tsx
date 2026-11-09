import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, RefObject } from "react";
import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { renderMarkdown } from "../../markdown";
import type { DiagramSource } from "../../markdown";
import { useMermaid } from "../../diagrams/useMermaid";
import { localImagePath } from "../../documents/resources";
import { createAnchorResolver } from "../../documents/anchors";
import type { ThemeName } from "../../theme/themes";
const noDiagrams: DiagramSource[] = [];
const pendingImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='60'%3E%3Crect width='160' height='60' fill='%23888' opacity='.06'/%3E%3C/svg%3E";
export default function PreviewDocument({
  text,
  path,
  theme,
  active,
  articleRef,
  onLayout,
  onExpand,
  onArticleClick,
}: {
  text: string;
  path: string;
  theme: ThemeName;
  active: boolean;
  articleRef: RefObject<HTMLElement | null>;
  onLayout(): void;
  onExpand(source: string): void;
  onArticleClick(event: MouseEvent<HTMLElement>): void;
}) {
  const [source, setSource] = useState(text);
  const lastCommit = useRef(Date.now());
  const native = isTauri();
  const [authorized, setAuthorized] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!active || text === source) return;
    const large = text.length > 1_000_000;
    const wait = Math.min(
      large ? 500 : 180,
      Math.max(0, (large ? 2000 : 700) - (Date.now() - lastCommit.current)),
    );
    const timer = setTimeout(() => {
      lastCommit.current = Date.now();
      setSource(text);
    }, wait);
    return () => clearTimeout(timer);
  }, [text, active, source]);
  const rendered = useMemo(() => {
    const paths = new Set<string>();
    try {
      const doc = renderMarkdown(source, (src) => {
        if (!native || /^(?:https?:|data:|blob:|asset:)/i.test(src)) return src;
        const local = localImagePath(src, path);
        if (!local) return "";
        paths.add(local);
        return authorized.has(local) ? convertFileSrc(local) : pendingImage;
      });
      return { doc, paths: [...paths].slice(0, 1000) };
    } catch {
      return null;
    }
  }, [source, path, native, authorized]);
  const [ready, setReady] = useState<DiagramSource[] | null>(null);
  useEffect(() => {
    if (!rendered?.doc.diagrams.length || !active) return;
    const timer = setTimeout(() => setReady(rendered.doc.diagrams), 450);
    return () => clearTimeout(timer);
  }, [rendered, active]);
  useMermaid(
    articleRef,
    rendered?.doc.diagrams ?? noDiagrams,
    theme,
    Boolean(
      active && rendered && ready === rendered.doc.diagrams && text === source,
    ),
    onExpand,
    onLayout,
  );
  const imageKey = rendered?.paths.join("\0") ?? "";
  const [imageWarning, setImageWarning] = useState("");
  useEffect(() => {
    setImageWarning("");
    if (!native || !imageKey || !active) return;
    let disposed = false;
    void invoke("authorize_images", { paths: imageKey.split("\0") })
      .then(() => {
        if (disposed) return;
        // Authorize before exposing asset URLs, including references typed before saving.
        const paths = imageKey.split("\0");
        setAuthorized((previous) =>
          paths.every((path) => previous.has(path))
            ? previous
            : new Set([...previous, ...paths]),
        );
        onLayout();
      })
      .catch(() => {
        if (!disposed)
          setImageWarning("部分本地图片无法加载，请检查路径或访问权限。");
      });
    return () => {
      disposed = true;
    };
  }, [imageKey, native, active, articleRef, onLayout]);
  useEffect(() => {
    const article = articleRef.current;
    if (!article || !active) return;
    onLayout();
    const observer = new ResizeObserver(onLayout);
    observer.observe(article);
    return () => observer.disconnect();
  }, [rendered, active, articleRef, onLayout]);
  const click = (event: MouseEvent<HTMLElement>) => {
    if (
      (event.target as Element).closest("img")?.getAttribute("src") ===
      pendingImage
    ) {
      event.preventDefault();
      return;
    }
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    const href = link?.getAttribute("href");
    if (href?.startsWith("#")) {
      event.preventDefault();
      const target = createAnchorResolver(articleRef.current!)(href.slice(1));
      if (target) {
        for (
          let details = target.closest("details");
          details;
          details = details.parentElement?.closest("details") ?? null
        )
          details.open = true;
        const viewport = articleRef.current?.parentElement;
        if (viewport)
          viewport.scrollTop +=
            target.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top -
            20;
      }
      return;
    }
    onArticleClick(event);
  };
  return (
    <>
      {imageWarning && (
        <div className="preview-warning" role="status">
          {imageWarning}
        </div>
      )}
      {active && !rendered && (
        <div className="preview-warning" role="status">
          暂时无法生成预览，编辑内容仍保留。
        </div>
      )}
      <article
        ref={articleRef}
        className="markdown-body live-preview-body"
        aria-busy={active && text !== source}
        onClick={click}
        onKeyDown={(event) => {
          if (
            (event.key === "Enter" || event.key === " ") &&
            event.target instanceof HTMLImageElement &&
            event.target.classList.contains("reader-image")
          ) {
            event.preventDefault();
            event.target.click();
          }
        }}
        onLoadCapture={onLayout}
        onErrorCapture={(event) => {
          if (event.target instanceof HTMLImageElement) {
            event.target.classList.add("image-failed");
            event.target.title = "图片无法加载，请检查图片路径或网络连接";
          }
        }}
        dangerouslySetInnerHTML={{ __html: rendered?.doc.html ?? "" }}
      />
    </>
  );
}
