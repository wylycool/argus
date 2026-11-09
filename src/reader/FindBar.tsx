import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { CaretUp, CaretDown, X, MagnifyingGlass } from "@phosphor-icons/react";
import { highlightMatches, clearMatches, revealSearchMatch } from "./search";
export default function FindBar({
  rootRef,
  contentKey,
  onClose,
}: {
  rootRef: RefObject<HTMLElement | null>;
  contentKey: unknown;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const commitUntil = useRef(0);
  const groups = useRef<HTMLElement[][]>([]);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      const root = rootRef.current;
      if (!root) return;
      const result = highlightMatches(root, query);
      groups.current = result.groups;
      setCount(result.count);
      setTruncated(result.truncated);
      setIndex(0);
      for (const mark of result.groups[0] ?? []) mark.dataset.active = "true";
      revealSearchMatch(result.groups[0]?.[0]);
    }, 120);
    return () => {
      clearTimeout(timer);
      const root = rootRef.current;
      if (root) clearMatches(root);
      groups.current = [];
    };
  }, [query, contentKey, rootRef]);
  const move = (delta: number) => {
    if (!count) return;
    const next = (index + delta + count) % count;
    for (const mark of groups.current[index] ?? []) delete mark.dataset.active;
    for (const mark of groups.current[next] ?? []) mark.dataset.active = "true";
    setIndex(next);
    revealSearchMatch(groups.current[next]?.[0]);
  };
  return (
    <div
      className="reader-find"
      role="search"
      aria-label="文内查找"
      onKeyDown={(e) => {
        if (
          composing.current ||
          e.nativeEvent.isComposing ||
          e.nativeEvent.keyCode === 229 ||
          Date.now() < commitUntil.current
        )
          return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          move(e.shiftKey ? -1 : 1);
        }
      }}
    >
      <MagnifyingGlass size={17} />
      <input
        ref={input}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          commitUntil.current = Date.now() + 50;
        }}
        onKeyUp={(event) => {
          if (event.key === "Enter" && !composing.current)
            commitUntil.current = 0;
        }}
        aria-label="查找内容"
        placeholder="查找当前文档"
        value={query}
        maxLength={200}
        onChange={(e) => setQuery(e.target.value)}
      />
      <span className="find-count" role="status">
        {query
          ? count
            ? `${index + 1} / ${count}${truncated ? "+" : ""}`
            : "未找到"
          : ""}
      </span>
      <button
        className="icon-button"
        title="上一个（⇧ Enter）"
        aria-label="上一个匹配"
        disabled={!count}
        onClick={() => move(-1)}
      >
        <CaretUp size={17} />
      </button>
      <button
        className="icon-button"
        title="下一个（Enter）"
        aria-label="下一个匹配"
        disabled={!count}
        onClick={() => move(1)}
      >
        <CaretDown size={17} />
      </button>
      <button
        className="icon-button"
        title="关闭查找（Esc）"
        aria-label="关闭查找"
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  );
}
