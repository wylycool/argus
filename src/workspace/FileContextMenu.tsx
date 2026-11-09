import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FolderOpen, Copy, StackMinus } from "@phosphor-icons/react";
import { isUntitledPath } from "../documents/untitled";
export interface ContextTarget {
  path: string;
  name: string;
  x: number;
  y: number;
}
export default function FileContextMenu({
  target,
  onClose,
  onReveal,
  onCopy,
  onCloseOthers,
  canCloseOthers,
}: {
  target: ContextTarget;
  onClose(): void;
  onReveal(): void;
  onCopy(): void;
  onCloseOthers(): void;
  canCloseOthers: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState({ x: target.x, y: target.y });
  const local = target.path.startsWith("/") && !isUntitledPath(target.path);
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (box)
      setPoint({
        x: Math.max(8, Math.min(target.x, innerWidth - box.width - 8)),
        y: Math.max(8, Math.min(target.y, innerHeight - box.height - 8)),
      });
  }, [target]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = menu.current?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    if (first) first.focus();
    else menu.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose]);
  const run = (action: () => void) => {
    onClose();
    action();
  };
  return (
    <div
      ref={menu}
      className="file-context-menu"
      tabIndex={-1}
      role="menu"
      aria-label={`${target.name} 的文件操作`}
      style={{ left: point.x, top: point.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const buttons = Array.from(
            menu.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
          ]?.focus();
        }
        if (e.key === "Tab") onClose();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onClose();
      }}
    >
      <div className="file-context-name" title={target.path}>
        {target.name}
      </div>
      <button role="menuitem" disabled={!local} onClick={() => run(onReveal)}>
        <FolderOpen size={16} />在 Finder 中显示
      </button>
      <button role="menuitem" disabled={!local} onClick={() => run(onCopy)}>
        <Copy size={16} />
        复制绝对路径
      </button>
      <div className="file-context-separator" />
      <button
        role="menuitem"
        disabled={!canCloseOthers}
        onClick={() => run(onCloseOthers)}
      >
        <StackMinus size={16} />
        关闭其他文档
      </button>
    </div>
  );
}
