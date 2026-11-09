import { useEffect, useMemo, useRef, useState } from "react";
import { CaretRight, CaretDown } from "@phosphor-icons/react";
import type { Heading } from "../markdown";
import {
  outlineStructure,
  visibleOutline,
  minimumHeadingLevel,
} from "./outline";
export default function OutlineNavigation({
  headings,
  name,
  active,
  onJump,
}: {
  headings: Heading[];
  name: string;
  active: string;
  onJump(id: string, line: number): void;
}) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const nav = useRef<HTMLElement>(null);
  const hovered = useRef(false);
  const until = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const structure = useMemo(() => outlineStructure(headings), [headings]);
  const visible = useMemo(
    () => visibleOutline(headings, collapsed, structure.parents),
    [headings, collapsed, structure],
  );
  let visibleActive = active;
  while (visibleActive && !visible.some((h) => h.id === visibleActive))
    visibleActive = structure.parents.get(visibleActive) ?? "";
  const activeRef = useRef(visibleActive);
  activeRef.current = visibleActive;
  const min = useMemo(() => minimumHeadingLevel(headings), [headings]);
  const reveal = () => {
    if (
      hovered.current ||
      nav.current?.contains(document.activeElement) ||
      Date.now() < until.current
    )
      return;
    const item = Array.from(
      nav.current?.querySelectorAll<HTMLElement>("[data-heading]") ?? [],
    ).find((e) => e.dataset.heading === activeRef.current);
    const panel = nav.current?.closest<HTMLElement>(".navigation-panel");
    if (!item || !panel) return;
    const box = item.getBoundingClientRect(),
      bounds = panel.getBoundingClientRect();
    if (box.top < bounds.top + 8) panel.scrollTop -= bounds.top + 8 - box.top;
    else if (box.bottom > bounds.bottom - 8)
      panel.scrollTop += box.bottom - (bounds.bottom - 8);
  };
  const schedule = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(
      reveal,
      Math.max(0, until.current - Date.now()) + 20,
    );
  };
  useEffect(() => {
    reveal();
    schedule();
    return () => clearTimeout(timer.current);
  }, [visibleActive, visible]);
  const interact = () => {
    until.current = Date.now() + 1500;
    schedule();
  };
  return (
    <nav
      ref={nav}
      className="outline"
      aria-label={`${name} 的大纲`}
      onPointerEnter={() => {
        hovered.current = true;
      }}
      onPointerLeave={() => {
        hovered.current = false;
        schedule();
      }}
      onPointerDown={interact}
      onWheel={interact}
      onKeyDown={interact}
      onFocusCapture={interact}
      onBlur={schedule}
    >
      {visible.map((h) => (
        <div
          className={`outline-row ${visibleActive === h.id ? "current" : ""}`}
          key={h.id}
          data-heading={h.id}
          style={{ paddingLeft: 8 + Math.min(h.level - min, 4) * 12 }}
        >
          {structure.branches.has(h.id) ? (
            <button
              className="outline-fold"
              aria-label={`${collapsed.has(h.id) ? "展开" : "折叠"}${h.text}`}
              aria-expanded={!collapsed.has(h.id)}
              onClick={() => {
                interact();
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (next.has(h.id)) next.delete(h.id);
                  else next.add(h.id);
                  return next;
                });
              }}
            >
              {collapsed.has(h.id) ? (
                <CaretRight size={13} />
              ) : (
                <CaretDown size={13} />
              )}
            </button>
          ) : (
            <span className="outline-fold-spacer" />
          )}
          <button
            className={`outline-item ${visibleActive === h.id ? "active" : ""}`}
            title={h.text}
            aria-current={visibleActive === h.id ? "location" : undefined}
            onClick={() => onJump(h.id, h.line)}
          >
            <span>{h.text}</span>
          </button>
        </div>
      ))}
    </nav>
  );
}
