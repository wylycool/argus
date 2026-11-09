import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CaretDown,
  CaretRight,
  ClockCounterClockwise,
  Copy,
  FilePlus,
  FileText,
  Files,
  FolderOpen,
  MagnifyingGlass,
  Printer,
} from "@phosphor-icons/react";
import { useToolbarMenu } from "./useToolbarMenu";

export function FileMenu({
  inactive = false,
  hasCurrentDocument,
  hasCopy,
  hasPath,
  canPrint,
  canHistory,
  canSearchAll,
  recent,
  onOpen,
  onNew,
  onQuick,
  onSearchAll,
  onRecent,
  onCopy,
  onPrint,
  onReveal,
  onHistory,
}: {
  inactive?: boolean;
  hasCurrentDocument: boolean;
  hasCopy: boolean;
  hasPath: boolean;
  canPrint: boolean;
  canHistory: boolean;
  canSearchAll: boolean;
  recent: { path: string; name: string; location: string }[];
  onOpen(): void;
  onNew(): void;
  onQuick(): void;
  onSearchAll(): void;
  onRecent(path: string): void;
  onCopy(): void;
  onPrint(): void;
  onReveal(): void;
  onHistory(): void;
}) {
  const m = useToolbarMenu(inactive);
  const [showRecent, setShowRecent] = useState(false);
  const recentTrigger = useRef<HTMLButtonElement>(null);
  const recentBack = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!m.open) setShowRecent(false);
  }, [m.open]);
  const previousRecent = useRef(false);
  useLayoutEffect(() => {
    // Focus the new page before the next key event, even if animation frames pause.
    if (showRecent) recentBack.current?.focus({ preventScroll: true });
    else if (previousRecent.current)
      recentTrigger.current?.focus({ preventScroll: true });
    previousRecent.current = showRecent;
  }, [showRecent]);
  const recentPage = (value: boolean) => setShowRecent(value);
  return (
    <div
      className="toolbar-menu toolbar-file"
      ref={m.root}
      onKeyDown={(event) => {
        if (
          showRecent &&
          event.key === "ArrowLeft" &&
          !event.nativeEvent.isComposing &&
          event.nativeEvent.keyCode !== 229
        ) {
          event.preventDefault();
          recentPage(false);
          return;
        }
        m.keyDown(event);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          m.setOpen(false);
      }}
    >
      <button
        ref={m.trigger}
        className="toolbar-control file-menu-trigger"
        aria-label="文件"
        title="文件：打开、新建与文档操作"
        aria-haspopup="menu"
        aria-expanded={m.open}
        onClick={() => m.setOpen(!m.open)}
      >
        <span>文件</span>
        <CaretDown size={11} />
      </button>
      {m.open && (
        <div className="toolbar-popover" role="menu" aria-label="文件菜单">
          {showRecent ? (
            <>
              <button
                ref={recentBack}
                className="recent-back"
                role="menuitem"
                onClick={() => recentPage(false)}
              >
                <ArrowLeft size={17} />
                <span>返回文件菜单</span>
              </button>
              <div className="toolbar-menu-rule" role="separator" />
              <div role="region" aria-label="最近阅读记录">
                <div className="toolbar-menu-heading">最近阅读</div>
                {recent.length ? (
                  recent.map((file) => (
                    <button
                      role="menuitem"
                      key={file.path}
                      title={file.path}
                      onClick={() => m.run(() => onRecent(file.path))}
                    >
                      <FileText size={17} />
                      <span className="recent-file-label">
                        <strong>{file.name}</strong>
                        <small>{file.location}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="recent-empty">还没有阅读记录</p>
                )}
              </div>
            </>
          ) : (
            <>
              <button role="menuitem" onClick={() => m.run(onNew)}>
                <FilePlus size={17} />
                <span>新建文档</span>
                <kbd>⌘ N</kbd>
              </button>
              <button
                role="menuitem"
                title="打开文档（⌘ O）"
                onClick={() => m.run(onOpen)}
              >
                <FolderOpen size={17} />
                <span>打开文档…</span>
                <kbd>⌘ O</kbd>
              </button>
              <button
                ref={recentTrigger}
                role="menuitem"
                aria-label="最近阅读"
                onClick={() => recentPage(true)}
              >
                <ClockCounterClockwise size={17} />
                <span>最近阅读</span>
                <CaretRight size={12} />
              </button>
              <div className="toolbar-menu-rule" role="separator" />
              <button role="menuitem" onClick={() => m.run(onQuick)}>
                <Files size={17} />
                <span>快速切换文档</span>
                <kbd>⌘ P</kbd>
              </button>
              <button
                role="menuitem"
                disabled={!canSearchAll}
                onClick={() => m.run(onSearchAll)}
              >
                <MagnifyingGlass size={17} />
                <span>搜索文档内容…</span>
                <kbd>⌘ ⇧ F</kbd>
              </button>
              {hasCurrentDocument && (
                <>
                  <div className="toolbar-menu-rule" role="separator" />
                  <div className="toolbar-menu-heading">当前文档</div>
                  <button
                    role="menuitem"
                    disabled={!canHistory}
                    onClick={() => m.run(onHistory)}
                  >
                    <ClockCounterClockwise size={17} />
                    <span>历史版本</span>
                    <kbd>⌘ ⇧ H</kbd>
                  </button>
                  <button
                    role="menuitem"
                    disabled={!hasCopy}
                    onClick={() => m.run(onCopy)}
                  >
                    <Copy size={17} />
                    <span>另存副本</span>
                    <kbd>⌘ ⇧ S</kbd>
                  </button>
                  <button
                    role="menuitem"
                    disabled={!canPrint}
                    onClick={() => m.run(onPrint)}
                  >
                    <Printer size={17} />
                    <span>打印 / 导出 PDF</span>
                    <kbd>⌘ ⇧ P</kbd>
                  </button>
                  <button
                    role="menuitem"
                    disabled={!hasPath}
                    onClick={() => m.run(onReveal)}
                  >
                    <FolderOpen size={17} />
                    <span>在 Finder 中显示</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
