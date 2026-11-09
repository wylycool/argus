import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, X, FileText } from "@phosphor-icons/react";
import { useViewerKeyboard } from "../workspace/useViewerKeyboard";
import { basename } from "../storage";
import { locationLabel } from "./untitled";
export default function QuickSwitcher({
  paths,
  current,
  onChoose,
  onClose,
}: {
  paths: string[];
  current?: string;
  onChoose(path: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const commitUntil = useRef(0);
  const matches = useMemo(
    () =>
      [...new Set(paths)]
        .filter((p) =>
          p.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        )
        .slice(0, 60),
    [paths, query],
  );
  const selectedIndex = Math.max(0, matches.indexOf(selection ?? ""));
  useEffect(() => {
    if (selection && !matches.includes(selection))
      setSelection(matches[0] ?? null);
  }, [selection, matches]);
  const closeButton = useRef<HTMLButtonElement>(null);
  useViewerKeyboard(
    onClose,
    closeButton,
    () => !composing.current && Date.now() >= commitUntil.current,
  );
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, matches]);
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
          (e.key === "Enter" && Date.now() < commitUntil.current)
        )
          return;
        if (e.key === "Tab") {
          e.preventDefault();
          if (document.activeElement === input.current)
            closeButton.current?.focus();
          else input.current?.focus();
          return;
        }
        if (e.target !== input.current) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next =
            (selectedIndex +
              (e.key === "ArrowDown" ? 1 : -1) +
              Math.max(1, matches.length)) %
            Math.max(1, matches.length);
          setSelection(matches[next] ?? null);
        }
        if (e.key === "Enter" && matches[selectedIndex]) {
          e.preventDefault();
          onChoose(matches[selectedIndex]);
        }
      }}
    >
      <div
        ref={root}
        className="quick-switcher"
        role="dialog"
        aria-modal="true"
        aria-label="快速切换文档"
      >
        <div className="quick-search">
          <MagnifyingGlass size={20} />
          <input
            ref={input}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
              // WebKit can report the commit Enter after compositionend.
              commitUntil.current = Date.now() + 50;
            }}
            onKeyUp={(event) => {
              if (event.key === "Enter" && !composing.current)
                commitUntil.current = 0;
            }}
            aria-label="搜索文档"
            placeholder="搜索文档或未命名草稿"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelection(null);
            }}
            aria-controls="quick-results"
            aria-activedescendant={
              matches[selectedIndex]
                ? `quick-result-${selectedIndex}`
                : undefined
            }
          />
          <button
            ref={closeButton}
            className="icon-button"
            aria-label="关闭快速切换"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div
          id="quick-results"
          role="listbox"
          aria-label="匹配的文档"
          className="quick-results"
        >
          {matches.length ? (
            matches.map((p, i) => (
              <button
                id={`quick-result-${i}`}
                tabIndex={-1}
                role="option"
                aria-selected={i === selectedIndex}
                key={p}
                onMouseEnter={() => setSelection(p)}
                onClick={() => onChoose(p)}
              >
                <FileText size={19} />
                <span>
                  <strong>{basename(p)}</strong>
                  <small>{locationLabel(p)}</small>
                </span>
                {p === current && <small>当前</small>}
              </button>
            ))
          ) : (
            <p>没有匹配的文档</p>
          )}
        </div>
        <footer>
          ↑ ↓ 选择 <span>↵ 打开 · Esc 关闭</span>
        </footer>
      </div>
    </div>
  );
}
