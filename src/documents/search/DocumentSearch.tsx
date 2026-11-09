import { Fragment, useEffect, useRef, useState } from "react";
import {
  MagnifyingGlass,
  X,
  FileText,
  ArrowRight,
} from "@phosphor-icons/react";
import { useViewerKeyboard } from "../../workspace/useViewerKeyboard";
import { locationLabel } from "../untitled";
import { useDocumentSearch } from "./useDocumentSearch";
import type { SearchBuffer, SearchHit } from "./useDocumentSearch";
import "./search.css";
const identity = (hit: SearchHit) => `${hit.path}\0${hit.line}\0${hit.column}`;
export default function DocumentSearch({
  paths,
  buffer,
  onClose,
  onChoose,
}: {
  paths: string[];
  buffer?: SearchBuffer;
  onClose(): void;
  onChoose(hit: SearchHit): void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const { result, loading, error } = useDocumentSearch(paths, buffer, query);
  const input = useRef<HTMLInputElement>(null),
    close = useRef<HTMLButtonElement>(null),
    root = useRef<HTMLDivElement>(null);
  const composing = useRef(false),
    commitUntil = useRef(0);
  const index = Math.max(
    0,
    result.hits.findIndex((h) => identity(h) === selected),
  );
  useViewerKeyboard(
    onClose,
    close,
    () => !composing.current && Date.now() >= commitUntil.current,
  );
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index, result]);
  return (
    <div
      className="reader-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (
          composing.current ||
          e.nativeEvent.isComposing ||
          e.nativeEvent.keyCode === 229 ||
          Date.now() < commitUntil.current
        )
          return;
        if (e.key === "Tab") {
          const nodes = Array.from(
            root.current?.querySelectorAll<HTMLElement>(
              'input,button:not([tabindex="-1"]),summary',
            ) ?? [],
          );
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
        if (e.target !== input.current) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const count = result.hits.length;
          if (count)
            setSelected(
              identity(
                result.hits[
                  (index + (e.key === "ArrowDown" ? 1 : -1) + count) % count
                ],
              ),
            );
        }
        if (e.key === "Enter" && result.hits[index]) {
          e.preventDefault();
          onChoose(result.hits[index]);
        }
      }}
    >
      <div
        ref={root}
        className="document-search"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-search-title"
      >
        <header>
          <div>
            <h2 id="document-search-title">搜索已打开文档</h2>
            <p>只在当前文件列表中查找 · 包含正在编辑的内容</p>
          </div>
          <button
            ref={close}
            className="icon-button"
            aria-label="关闭文档搜索"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="document-search-input">
          <MagnifyingGlass size={20} />
          <input
            ref={input}
            value={query}
            maxLength={200}
            placeholder="输入关键词，查找正文与代码"
            aria-label="搜索已打开文档的内容"
            aria-controls="document-search-results"
            aria-activedescendant={
              result.hits[index] ? `document-hit-${index}` : undefined
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
              commitUntil.current = Date.now() + 50;
            }}
            onKeyUp={(e) => {
              if (e.key === "Enter" && !composing.current)
                commitUntil.current = 0;
            }}
          />
          <span>{paths.length} 篇</span>
        </div>
        {error && (
          <p className="document-search-error" role="alert">
            {error}
          </p>
        )}
        <div
          id="document-search-results"
          className="document-search-results"
          role="listbox"
          aria-label="文档内容搜索结果"
          aria-busy={loading}
        >
          {result.hits.map((hit, i) => (
            <Fragment key={identity(hit)}>
              {(i === 0 || result.hits[i - 1].path !== hit.path) && (
                <div className="document-search-file" aria-hidden="true">
                  <FileText size={15} />
                  <strong>{hit.name}</strong>
                  {hit.buffer && <em>当前内容</em>}
                  <small title={hit.path}>
                    {locationLabel(hit.path).split("/").slice(-2).join("/")}
                  </small>
                </div>
              )}
              <button
                id={`document-hit-${i}`}
                className="document-search-option"
                role="option"
                tabIndex={-1}
                aria-selected={i === index}
                aria-label={`${hit.name}，${locationLabel(hit.path)}，第${hit.line}行：${hit.before}${hit.matched}${hit.after}`}
                onMouseEnter={() => setSelected(identity(hit))}
                onClick={() => onChoose(hit)}
              >
                <span className="document-search-line">{hit.line}</span>
                <span className="document-search-context">
                  {hit.before}
                  <mark>{hit.matched}</mark>
                  {hit.after}
                </span>
                <ArrowRight size={15} />
              </button>
            </Fragment>
          ))}
          {!result.hits.length && (
            <div className="document-search-empty">
              <MagnifyingGlass size={30} weight="light" />
              <strong>
                {error
                  ? "搜索未完成"
                  : loading
                    ? "正在搜索…"
                    : query.trim()
                      ? "没有找到匹配内容"
                      : "查找已打开文档的内容"}
              </strong>
              <p>
                {error
                  ? "可关闭搜索处理提示，当前文档和输入仍保留。"
                  : loading
                    ? "读取已打开文档，不会扫描整个目录。"
                    : query.trim()
                      ? "试试其他关键词，或先打开需要搜索的文档。"
                      : "输入关键词，按 ↑ ↓ 选择，Enter 定位。"}
              </p>
            </div>
          )}
        </div>
        <footer>
          <span role="status">
            {loading
              ? "正在搜索…"
              : query.trim()
                ? `已搜索 ${result.searched}/${result.total} 篇 · ${result.hits.length} 处匹配`
                : "内容搜索 · Esc 关闭"}
            {result.truncated ? " · 结果达到显示或读取上限" : ""}
          </span>
          <small>每篇最多25处 · 共500处</small>
        </footer>
        {result.failures.length > 0 && (
          <details className="document-search-failures">
            <summary>{result.failures.length} 个文件未能搜索</summary>
            {result.failures.map((f) => (
              <p key={f.path}>
                <strong>{f.path.split("/").at(-1)}</strong>：{f.message}
              </p>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
