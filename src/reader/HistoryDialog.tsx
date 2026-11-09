import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  ClockCounterClockwise,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { useViewerKeyboard } from "../workspace/useViewerKeyboard";
import HistoryDiff from "../documents/HistoryDiff";
import { saveError } from "../editor/autoSave";
interface Entry {
  id: string;
  createdAt: number;
  bytes: number;
  version: string;
  reason: string;
}
export default function HistoryDialog({
  path,
  name,
  version,
  currentContent,
  onClose,
  onRestored,
  onBusyChange,
}: {
  path: string;
  name: string;
  version: string;
  currentContent: string;
  onClose(): void;
  onRestored(): Promise<void>;
  onBusyChange(busy: boolean): void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [selected, setSelected] = useState<Entry | null>(null),
    [content, setContent] = useState<string | null>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [restoring, setRestoring] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [mode, setMode] = useState<"source" | "diff">("diff");
  const [management, setManagement] = useState(false);
  const [clearTarget, setClearTarget] = useState<string | null>(null);
  const [usage, setUsage] = useState<{
    totalBytes: number;
    totalVersions: number;
    documentBytes: number;
    documentVersions: number;
  } | null>(null);
  const loadUsage = () =>
    invoke<typeof usage>("history_usage", { path })
      .then((result) => {
        if (mounted.current && result && Number.isFinite(result.totalBytes))
          setUsage(result);
      })
      .catch(() => {});
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const mounted = useRef(true);
  useViewerKeyboard(() => {
    if (restoring) return;
    if (clearTarget) setClearTarget(null);
    else if (management) setManagement(false);
    else if (confirm) setConfirm(false);
    else onClose();
  }, close);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    void loadUsage();
    void invoke<Entry[]>("list_history", { path })
      .then((list) => {
        if (!disposed) {
          setEntries(list);
          setSelected(list[0] ?? null);
        }
      })
      .catch((e) => {
        if (!disposed) setError(saveError(e).message);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [path]);
  useEffect(() => {
    const id = ++request.current;
    setContent(null);
    setConfirm(false);
    setClearTarget(null);
    if (!selected) return;
    void invoke<{ content: string }>("preview_history", {
      path,
      id: selected.id,
    })
      .then((result) => {
        if (id === request.current) setContent(result.content);
      })
      .catch((e) => {
        if (id === request.current) setError(saveError(e).message);
      });
    return () => {
      request.current++;
    };
  }, [path, selected]);
  const restore = async () => {
    if (!selected || content === null) return;
    setRestoring(true);
    onBusyChange(true);
    setError("");
    try {
      await invoke("restore_history", {
        path,
        id: selected.id,
        expectedVersion: version,
      });
      await onRestored();
    } catch (e) {
      if (mounted.current) {
        setError(saveError(e).message);
        setConfirm(false);
      }
    } finally {
      onBusyChange(false);
      if (mounted.current) setRestoring(false);
    }
  };
  const clear = async () => {
    if (!clearTarget) return;
    setRestoring(true);
    onBusyChange(true);
    setError("");
    try {
      await invoke("clear_history", {
        path,
        id: clearTarget === "all" ? null : clearTarget,
      });
      const list = await invoke<Entry[]>("list_history", { path });
      if (mounted.current) {
        setEntries(list);
        setSelected(list[0] ?? null);
        setClearTarget(null);
        await loadUsage();
      }
    } catch (e) {
      if (mounted.current) setError(saveError(e).message);
    } finally {
      onBusyChange(false);
      if (mounted.current) setRestoring(false);
    }
  };
  return (
    <div
      className="reader-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !restoring) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          const nodes = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),[tabindex="0"]',
            ) ?? [],
          ).filter((e) => e.getClientRects().length);
          const first = nodes[0],
            last = nodes.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div
        className="reader-history-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <header className="history-toolbar">
          <div>
            <ClockCounterClockwise size={20} />
            <div>
              <h2 id="history-title">历史版本</h2>
              <p title={path}>{name}</p>
            </div>
          </div>
          <button
            ref={close}
            className="icon-button"
            aria-label="关闭历史版本"
            disabled={restoring}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {error && (
          <div className="history-error" role="alert">
            {error}
          </div>
        )}
        <div className="history-content">
          <nav className="history-entries" aria-label="保存的历史版本">
            {loading ? (
              <p>正在读取…</p>
            ) : entries.length ? (
              entries.map((entry) => (
                <button
                  key={entry.id}
                  disabled={restoring}
                  aria-pressed={selected?.id === entry.id}
                  onClick={() => {
                    setError("");
                    setSelected({ ...entry });
                  }}
                >
                  <strong>
                    {new Date(entry.createdAt).toLocaleString("zh-CN", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </strong>
                  <span>
                    {entry.reason} ·{" "}
                    {Math.max(1, Math.ceil(entry.bytes / 1024))} KB
                  </span>
                </button>
              ))
            ) : (
              <div className="history-empty">
                <p>还没有历史版本</p>
                <small>第一次修改并自动保存前，会保留原内容。</small>
              </div>
            )}
          </nav>
          <section className="history-preview" aria-label="历史内容预览">
            {selected ? (
              <>
                <div
                  className="history-preview-label history-preview-tabs"
                  role="tablist"
                  aria-label="历史预览方式"
                >
                  <button
                    role="tab"
                    aria-selected={mode === "diff"}
                    onClick={() => setMode("diff")}
                  >
                    与当前对比
                  </button>
                  <button
                    role="tab"
                    aria-selected={mode === "source"}
                    onClick={() => setMode("source")}
                  >
                    只读源码
                  </button>
                </div>
                {content === null ? (
                  <p>
                    {error
                      ? "读取未完成，可重新选择版本重试。"
                      : "正在读取内容…"}
                  </p>
                ) : mode === "diff" ? (
                  <HistoryDiff previous={content} current={currentContent} />
                ) : (
                  <pre tabIndex={0}>{content || "（空文档）"}</pre>
                )}
              </>
            ) : (
              <div className="history-preview-empty">
                保存的版本会显示在这里，原文件保持完整。
              </div>
            )}
          </section>
        </div>
        {management && (
          <div className="history-management">
            {clearTarget ? (
              <>
                <p>
                  确定
                  {clearTarget === "all"
                    ? "清理这篇文档的全部本机历史"
                    : "删除所选历史版本"}
                  ？当前Markdown文件不会更改，清理后无法恢复这些历史。
                </p>
                <button
                  disabled={restoring}
                  onClick={() => setClearTarget(null)}
                >
                  取消清理
                </button>
                <button disabled={restoring} onClick={() => void clear()}>
                  确认清理
                </button>
              </>
            ) : (
              <>
                <p>
                  {usage
                    ? `本文 ${usage.documentVersions} 个版本 · ${Math.ceil(usage.documentBytes / 1024)} KB；全部历史 ${(usage.totalBytes / 1024 / 1024).toFixed(1)} MB / 128 MB`
                    : "仅管理本机历史，不修改当前文档。"}
                </p>
                <button
                  disabled={!selected || restoring}
                  onClick={() => setClearTarget(selected?.id ?? null)}
                >
                  删除所选版本
                </button>
                <button
                  disabled={restoring}
                  onClick={() => setClearTarget("all")}
                >
                  清理本文历史
                </button>
              </>
            )}
          </div>
        )}
        <footer className="history-actions">
          {confirm ? (
            <>
              <p>恢复前会保留当前版本，之后仍可找回。确定恢复所选内容？</p>
              <button disabled={restoring} onClick={() => setConfirm(false)}>
                取消
              </button>
              <button
                className="history-restore"
                disabled={restoring}
                onClick={() => void restore()}
              >
                {restoring ? "正在恢复…" : "确认恢复"}
              </button>
            </>
          ) : (
            <>
              <p>每篇最多保留20个版本</p>
              <button
                disabled={restoring}
                onClick={() => {
                  setManagement((v) => !v);
                  setClearTarget(null);
                }}
              >
                管理历史
              </button>
              <button
                className="history-restore"
                disabled={
                  !selected ||
                  content === null ||
                  loading ||
                  restoring ||
                  Boolean(clearTarget)
                }
                onClick={() => setConfirm(true)}
              >
                <ArrowCounterClockwise size={16} />
                恢复此版本
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
