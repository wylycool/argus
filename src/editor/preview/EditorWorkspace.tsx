import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { LinkSimple, LinkBreak } from "@phosphor-icons/react";
import MarkdownEditor from "../MarkdownEditor";
import type {
  MarkdownEditorHandle,
  MarkdownEditorProps,
} from "../MarkdownEditor";
import type { ThemeName } from "../../theme/themes";
import type { PreviewSettings } from "./settings";
import { constrainRatio } from "./settings";
import { usePreviewScroll } from "./usePreviewScroll";
import PreviewDocument from "./PreviewDocument";
import "./preview.css";
export default function EditorWorkspace({
  path,
  theme,
  preview,
  onPreviewChange,
  onExpand,
  onArticleClick,
  ...editorProps
}: MarkdownEditorProps & {
  path: string;
  theme: ThemeName;
  preview: PreviewSettings;
  onPreviewChange(value: PreviewSettings): void;
  onExpand(source: string): void;
  onArticleClick(event: MouseEvent<HTMLElement>): void;
}) {
  const root = useRef<HTMLDivElement>(null),
    editor = useRef<MarkdownEditorHandle | null>(null);
  const viewport = useRef<HTMLDivElement>(null),
    article = useRef<HTMLElement>(null);
  const [availableWidth, setAvailableWidth] = useState(1000),
    [tab, setTab] = useState<"editor" | "preview">("editor");
  const [draftRatio, setDraftRatio] = useState<number | null>(null);
  const drag = useRef<{ id: number; ratio: number } | null>(null);
  const previousEnabled = useRef(preview.enabled);
  const compact = availableWidth < 780;
  const layout = useRef({ compact, enabled: preview.enabled, tab });
  layout.current = { compact, enabled: preview.enabled, tab };
  const pendingActions = useRef<(() => void)[]>([]);
  const tabTransition = useRef<{ tab: "editor" | "preview" } | null>(null);
  const previousVisibility = useRef({ hidden: false, sync: preview.sync });
  const revealEditor = useCallback((action: () => void) => {
    const current = layout.current;
    if (current.compact && current.enabled && current.tab === "preview") {
      tabTransition.current = null;
      pendingActions.current.push(action);
      setTab("editor");
    } else action();
  }, []);
  const visible = preview.enabled && (!compact || tab === "preview");
  const scroll = usePreviewScroll(
    editor,
    viewport,
    article,
    editorProps.content.split("\n").length,
    preview.enabled && preview.sync && visible,
    !compact || !preview.enabled || tab === "editor",
  );
  useLayoutEffect(() => {
    const node = root.current!;
    const apply = () => setAvailableWidth(node.getBoundingClientRect().width);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (preview.enabled && !previousEnabled.current && compact) {
      scroll.captureEditor();
      setTab("preview");
    }
    previousEnabled.current = preview.enabled;
    if (!preview.enabled || compact) {
      drag.current = null;
      setDraftRatio(null);
    }
    editor.current?.refresh?.();
    if (!preview.enabled) editor.current?.focus();
    scroll.refresh();
  }, [preview.enabled, compact, scroll.refresh]);
  useEffect(() => {
    editor.current?.refresh?.();
    scroll.refresh();
  }, [tab, draftRatio, preview.ratio, preview.sync, scroll.refresh]);
  const ratio = draftRatio ?? constrainRatio(preview.ratio, availableWidth);
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    setDraftRatio(null);
    if (!cancel) onPreviewChange({ ...preview, ratio: current.ratio });
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  useLayoutEffect(() => {
    const hidden = compact && preview.enabled && tab === "preview";
    const previous = previousVisibility.current;
    previousVisibility.current = { hidden, sync: preview.sync };
    const actions = hidden ? [] : pendingActions.current.splice(0);
    if (actions.length) {
      scroll.takePreviewPosition();
      for (const action of actions) action();
    }
    const transition = tabTransition.current;
    if (transition?.tab === tab) {
      tabTransition.current = null;
      if (tab === "editor") {
        editor.current?.refresh?.();
        editor.current?.focus();
      } else {
        scroll.alignPreview();
        viewport.current?.focus({ preventScroll: true });
      }
    }
    // Also restore when disabling preview or widening the window reveals the editor.
    if (previous.hidden && !hidden && !actions.length) {
      const position = scroll.takePreviewPosition();
      if (previous.sync && position) editor.current?.scrollToSource?.(position);
    }
  }, [tab, compact, preview.enabled, preview.sync]);
  const selectTab = (next: "editor" | "preview") => {
    if (next === tab) {
      if (next === "editor") editor.current?.focus();
      else viewport.current?.focus({ preventScroll: true });
      return;
    }
    if (next === "preview") {
      scroll.captureEditor();
      scroll.claimEditor();
      tabTransition.current = { tab: next };
    } else {
      if (preview.sync) scroll.capturePreview();
      tabTransition.current = { tab: next };
    }
    setTab(next);
  };
  return (
    <div
      ref={root}
      className={`editor-workspace ${preview.enabled ? "with-preview" : ""} ${compact ? "compact-preview" : ""}`}
      style={
        {
          "--editor-fr": `${ratio}fr`,
          "--preview-fr": `${1 - ratio}fr`,
        } as CSSProperties
      }
    >
      {preview.enabled && compact && (
        <div
          className="compact-preview-tabs"
          role="tablist"
          aria-label="编辑与预览"
        >
          <button
            role="tab"
            aria-selected={tab === "editor"}
            aria-controls="live-editor-pane"
            onClick={() => selectTab("editor")}
          >
            编辑
          </button>
          <button
            role="tab"
            aria-selected={tab === "preview"}
            aria-controls="live-preview-pane"
            onClick={() => selectTab("preview")}
          >
            预览
          </button>
        </div>
      )}
      <section
        id="live-editor-pane"
        className="live-editor-pane"
        hidden={preview.enabled && compact && tab === "preview"}
        onFocusCapture={scroll.claimEditor}
        onPointerDownCapture={scroll.claimEditor}
        onWheelCapture={scroll.claimEditor}
        onTouchStartCapture={scroll.claimEditor}
        onKeyDownCapture={scroll.claimEditor}
      >
        {preview.enabled && !compact && (
          <div className="editor-pane-heading">
            <span>Markdown</span>
            <small>编辑</small>
          </div>
        )}
        <div className="live-editor-content">
          <MarkdownEditor
            {...editorProps}
            onScroll={scroll.editorScroll}
            onReady={(handle) => {
              editor.current = handle;
              editorProps.onReady?.(
                handle
                  ? {
                      ...handle,
                      focus: () => revealEditor(() => handle.focus()),
                      find: () => revealEditor(() => handle.find()),
                      jumpToLine: (line) =>
                        revealEditor(() => handle.jumpToLine(line)),
                      insert: (text) => revealEditor(() => handle.insert(text)),
                      revealMatch: handle.revealMatch
                        ? (line, column, length) =>
                            revealEditor(() =>
                              handle.revealMatch!(line, column, length),
                            )
                        : undefined,
                    }
                  : null,
              );
              if (handle) scroll.refresh();
            }}
          />
        </div>
      </section>
      {preview.enabled && !compact && (
        <div
          className="preview-divider"
          role="separator"
          tabIndex={0}
          aria-label="调整编辑和预览宽度"
          aria-orientation="vertical"
          aria-valuemin={30}
          aria-valuemax={70}
          aria-valuenow={Math.round(ratio * 100)}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            drag.current = { id: event.pointerId, ratio };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current?.id !== event.pointerId) return;
            const rect = root.current!.getBoundingClientRect();
            const next = constrainRatio(
              (event.clientX - rect.left - 4.5) / Math.max(1, rect.width - 9),
              rect.width,
            );
            drag.current.ratio = next;
            setDraftRatio(next);
          }}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={(event) => finish(event)}
          onDoubleClick={() => onPreviewChange({ ...preview, ratio: 0.5 })}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            )
              return;
            event.preventDefault();
            const step = event.shiftKey ? 0.1 : 0.02;
            const next =
              event.key === "Home"
                ? 0.3
                : event.key === "End"
                  ? 0.7
                  : ratio + (event.key === "ArrowLeft" ? -step : step);
            onPreviewChange({
              ...preview,
              ratio: constrainRatio(next, availableWidth),
            });
          }}
        >
          <span />
        </div>
      )}
      {preview.enabled && (
        <section
          id="live-preview-pane"
          className="live-preview-pane"
          hidden={compact && tab === "editor"}
        >
          <div className="editor-pane-heading">
            <span>实时预览</span>
            <button
              aria-label="联动滚动"
              aria-pressed={preview.sync}
              title="开启后按对应段落联动；关闭后可分别滚动"
              onClick={() =>
                onPreviewChange({ ...preview, sync: !preview.sync })
              }
            >
              {preview.sync ? (
                <LinkSimple size={14} />
              ) : (
                <LinkBreak size={14} />
              )}
              <small>联动滚动</small>
            </button>
          </div>
          <div
            ref={viewport}
            className="live-preview-viewport"
            role="region"
            aria-label="实时 Markdown 预览"
            tabIndex={0}
            onPointerDownCapture={scroll.claimPreview}
            onWheelCapture={scroll.claimPreview}
            onTouchStartCapture={scroll.claimPreview}
            onKeyDownCapture={scroll.claimPreview}
            onScroll={scroll.previewScroll}
          >
            <PreviewDocument
              text={editorProps.content}
              path={path}
              theme={theme}
              active={visible}
              articleRef={article}
              onExpand={onExpand}
              onLayout={scroll.refresh}
              onArticleClick={onArticleClick}
            />
          </div>
        </section>
      )}
    </div>
  );
}
