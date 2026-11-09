import { useEffect, useRef, useState } from "react";
import { Check, SlidersHorizontal } from "@phosphor-icons/react";
import ReadingSettings from "../reader/ReadingSettings";
import type { ReadingSettings as Settings } from "../reader/settings";
import { themeOptions } from "./themes";
import type { ThemeName } from "./themes";
import "./appearance.css";
export default function AppearanceMenu({
  theme,
  onChange,
  reading,
  onReadingChange,
}: {
  theme: ThemeName;
  onChange(theme: ThemeName): void;
  reading: Settings;
  onReadingChange(value: Settings): void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"themes" | "reading">("themes");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div
      className="appearance-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <button
        className="toolbar-control theme-button"
        ref={trigger}
        aria-label="外观设置"
        title="外观：主题与排版"
        aria-expanded={open}
        aria-controls="appearance-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={18} weight="regular" />
        <span className="toolbar-label">外观</span>
      </button>
      {open && (
        <div
          className="appearance-panel"
          id="appearance-panel"
          role="region"
          aria-label="阅读配色"
        >
          <div className="appearance-heading">外观设置</div>
          <div
            className="appearance-tabs"
            role="tablist"
            aria-label="阅读设置分类"
          >
            <button
              role="tab"
              aria-selected={tab === "themes"}
              onClick={() => setTab("themes")}
            >
              主题
            </button>
            <button
              role="tab"
              aria-selected={tab === "reading"}
              onClick={() => setTab("reading")}
            >
              排版
            </button>
          </div>
          {tab === "reading" ? (
            <ReadingSettings value={reading} onChange={onReadingChange} />
          ) : (
            <>
              <div className="theme-options" role="group" aria-label="预置主题">
                {themeOptions.map((option) => (
                  <button
                    key={option.id}
                    className="theme-option"
                    aria-label={option.name}
                    aria-pressed={theme === option.id}
                    onClick={() => {
                      onChange(option.id);
                      setOpen(false);
                    }}
                  >
                    <span
                      className={`theme-preview preview-${option.id}`}
                      style={{
                        backgroundColor: option.palette.paper,
                        borderColor: option.palette.softBorder,
                      }}
                      aria-hidden="true"
                    >
                      <i
                        style={{
                          backgroundColor: option.palette.sidebar,
                        }}
                      />
                      <span style={{ color: option.palette.text }}>
                        <b style={{ background: option.palette.accent }} />
                        <em />
                        <em />
                        <em />
                      </span>
                    </span>
                    <span className="theme-option-label">
                      <strong>{option.name}</strong>
                      {theme === option.id && <Check size={14} />}
                    </span>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
