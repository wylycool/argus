import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { MarkdownEditorHandle, SourceScroll } from "../MarkdownEditor";
import { interpolate, previewPoints } from "./scroll";
import type { ScrollPoint } from "./scroll";
export function usePreviewScroll(
  editor: RefObject<MarkdownEditorHandle | null>,
  viewport: RefObject<HTMLDivElement | null>,
  article: RefObject<HTMLElement | null>,
  lines: number,
  enabled: boolean,
  editorVisible = true,
) {
  const driver = useRef<"editor" | "preview">("editor");
  const latest = useRef({ lines, enabled, editorVisible });
  latest.current = { lines, enabled, editorVisible };
  const lastSource = useRef<SourceScroll>({ line: 0, fraction: 0 });
  const lastPreview = useRef<SourceScroll | null>(null);
  const frame = useRef<number | null>(null);
  const mapping = useRef<{
    article: HTMLElement;
    lines: number;
    height: number;
    viewportHeight: number;
    points: ScrollPoint[];
  } | null>(null);
  const apply = useCallback(
    (position?: SourceScroll) => {
      const v = viewport.current,
        a = article.current,
        e = editor.current;
      if (!latest.current.enabled || !v || !a || !e || v.clientHeight === 0)
        return;
      const cached = mapping.current;
      const points =
        cached &&
        cached.article === a &&
        cached.lines === latest.current.lines &&
        cached.height === v.scrollHeight &&
        cached.viewportHeight === v.clientHeight
          ? cached.points
          : previewPoints(a, v, latest.current.lines);
      mapping.current = {
        article: a,
        lines: latest.current.lines,
        height: v.scrollHeight,
        viewportHeight: v.clientHeight,
        points,
      };
      if (driver.current === "editor") {
        lastPreview.current = null;
        const p =
          position ??
          (latest.current.editorVisible
            ? e.getScrollPosition?.()
            : lastSource.current);
        if (p) lastSource.current = p;
        if (p) v.scrollTop = interpolate(points, p.line + p.fraction, "line");
      } else {
        const line = interpolate(points, v.scrollTop, "top");
        const position = { line: Math.floor(line), fraction: line % 1 };
        lastPreview.current = position;
        if (latest.current.editorVisible) e.scrollToSource?.(position);
      }
    },
    [editor, viewport, article],
  );
  const refresh = useCallback(() => {
    mapping.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      apply();
    });
  }, [apply]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return {
    captureEditor: () => {
      lastPreview.current = null;
      if (latest.current.editorVisible) {
        const position = editor.current?.getScrollPosition?.();
        if (position) lastSource.current = position;
      }
    },
    capturePreview: (): SourceScroll | null => {
      const v = viewport.current,
        a = article.current;
      if (!latest.current.enabled || !v || !a || v.clientHeight === 0)
        return null;
      const line = interpolate(
        previewPoints(a, v, latest.current.lines),
        v.scrollTop,
        "top",
      );
      lastPreview.current = { line: Math.floor(line), fraction: line % 1 };
      return lastPreview.current;
    },
    takePreviewPosition: () => {
      const position = lastPreview.current;
      lastPreview.current = null;
      return position;
    },
    alignPreview: () => {
      driver.current = "editor";
      apply();
    },
    editorScroll: (p: SourceScroll) => {
      if (!latest.current.editorVisible) return;
      lastSource.current = p;
      if (driver.current === "editor") {
        // A newer editor position supersedes any stored preview arrival.
        lastPreview.current = null;
        apply(p);
      }
    },
    previewScroll: () => {
      if (driver.current === "preview") apply();
    },
    claimEditor: () => {
      driver.current = "editor";
    },
    claimPreview: () => {
      driver.current = "preview";
    },
    refresh,
  };
}
