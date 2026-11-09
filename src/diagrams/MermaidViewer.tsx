import { useEffect, useRef, useState, useMemo } from "react";
import { X, Minus, Plus, ArrowsOutSimple } from "@phosphor-icons/react";
import { diagramError, renderDiagram } from "./engine";
import type { DiagramTheme } from "./engine";
import { useViewerKeyboard } from "../workspace/useViewerKeyboard";
export default function MermaidViewer({
  source,
  theme,
  onClose,
}: {
  source: string;
  theme: DiagramTheme;
  onClose(): void;
}) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 800, height: 600 });
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box)
        setAvailable({
          width: Math.max(1, box.width),
          height: Math.max(1, box.height),
        });
    });
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  const natural = useMemo(() => {
    const element = new DOMParser().parseFromString(
      svg,
      "image/svg+xml",
    ).documentElement;
    const box = element
      .getAttribute("viewBox")
      ?.trim()
      .split(/[ ,]+/)
      .map(Number);
    return box &&
      box.length === 4 &&
      box.every(Number.isFinite) &&
      box[2] > 0 &&
      box[3] > 0
      ? { width: box[2], height: box[3] }
      : { width: 800, height: 600 };
  }, [svg]);
  const scale = fit
    ? Math.min(
        1,
        available.width / natural.width,
        available.height / natural.height,
      )
    : zoom;
  useViewerKeyboard(onClose, close);
  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setError("");
    void renderDiagram(source, theme, () => !cancelled)
      .then((value) => {
        if (value) setSvg(value);
      })
      .catch((e) => {
        if (!cancelled) setError(diagramError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [source, theme]);
  return (
    <div
      className="diagram-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          const buttons = Array.from(
            dialog.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          );
          const first = buttons[0],
            last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div
        className="diagram-viewer"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagram-viewer-title"
      >
        <div className="diagram-viewer-toolbar">
          <span id="diagram-viewer-title">Mermaid 图表</span>
          <div>
            <button
              className="icon-button"
              aria-label="缩小图表"
              title="缩小"
              disabled={!svg || scale <= 0.1}
              onClick={() => {
                setFit(false);
                setZoom(Math.max(0.1, Math.round((scale - 0.25) * 100) / 100));
              }}
            >
              <Minus size={17} />
            </button>
            <span className="diagram-zoom">
              {fit ? "适应窗口" : `${Math.round(zoom * 100)}%`}
            </span>
            <button
              className="icon-button"
              aria-label="放大图表"
              title="放大"
              disabled={!svg || scale >= 3}
              onClick={() => {
                setFit(false);
                setZoom(Math.min(3, Math.round((scale + 0.25) * 100) / 100));
              }}
            >
              <Plus size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="图表适应窗口"
              title="适应窗口"
              disabled={!svg}
              onClick={() => {
                setFit(true);
                setZoom(1);
              }}
            >
              <ArrowsOutSimple size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="关闭图表"
              title="关闭（Esc）"
              ref={close}
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </div>
        <div
          className={`diagram-viewport ${fit ? "diagram-fit" : ""}`}
          aria-busy={!svg && !error}
          ref={viewport}
        >
          {error ? (
            <div className="diagram-viewer-error" role="alert">
              {error}
            </div>
          ) : svg ? (
            <div
              className="diagram-zoom-content"
              style={{
                zoom: scale,
                width: natural.width,
                height: natural.height,
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <span className="diagram-message" role="status">
              正在绘制图表…
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
