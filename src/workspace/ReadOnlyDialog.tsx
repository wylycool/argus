import { useRef } from "react";
import { LockSimple } from "@phosphor-icons/react";
import { useViewerKeyboard } from "./useViewerKeyboard";
export default function ReadOnlyDialog({
  name,
  onCancel,
  onCopy,
  unavailable = false,
}: {
  name: string;
  onCancel(): void;
  onCopy(): void;
  unavailable?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useViewerKeyboard(onCancel, cancel);
  return (
    <div
      className="reader-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          const buttons = Array.from(
            dialog.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
          );
          if (e.shiftKey && document.activeElement === buttons[0]) {
            e.preventDefault();
            buttons.at(-1)?.focus();
          } else if (!e.shiftKey && document.activeElement === buttons.at(-1)) {
            e.preventDefault();
            buttons[0]?.focus();
          }
        }
      }}
    >
      <div
        ref={dialog}
        className="readonly-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="readonly-title"
      >
        <LockSimple size={28} weight="light" />
        <h2 id="readonly-title">这份文档目前无法直接编辑</h2>
        <p>
          <strong>{name}</strong>
          {unavailable
            ? "原文件已无法读取，当前内容来自本机恢复草稿。请另存为新的 Markdown 文件。"
            : "为只读文件，或所在位置没有写入权限。"}
        </p>
        <div className="readonly-actions">
          <button ref={cancel} onClick={onCancel}>
            继续阅读
          </button>
          <button className="history-restore" onClick={onCopy}>
            另存副本并编辑
          </button>
        </div>
      </div>
    </div>
  );
}
