import { useMemo } from "react";
import { diffLines } from "diff";
export default function HistoryDiff({
  previous,
  current,
}: {
  previous: string;
  current: string;
}) {
  const diff = useMemo(
    () =>
      previous.length + current.length > 1_000_000
        ? undefined
        : diffLines(previous, current, { timeout: 400, maxEditLength: 2500 }),
    [previous, current],
  );
  if (!diff) return <p>内容较长或差异过多，请切换源码查看完整历史内容。</p>;
  const added = diff
      .filter((c) => c.added)
      .reduce((n, c) => n + (c.count ?? 0), 0),
    removed = diff
      .filter((c) => c.removed)
      .reduce((n, c) => n + (c.count ?? 0), 0);
  return (
    <div
      className="history-diff"
      tabIndex={0}
      aria-label="历史与当前文档的差异"
    >
      <div className="diff-summary">
        历史版本 → 当前文档{" "}
        <span>
          新增 {added} 行 · 删除 {removed} 行
        </span>
      </div>
      {!added && !removed ? (
        <p>与当前文档内容一致</p>
      ) : (
        diff.map((c, i) => (
          <div
            key={i}
            className={`diff-chunk ${c.added ? "added" : c.removed ? "removed" : "unchanged"}`}
          >
            <span aria-hidden="true">
              {c.added ? "+" : c.removed ? "−" : " "}
            </span>
            <pre>{c.value}</pre>
          </div>
        ))
      )}
    </div>
  );
}
