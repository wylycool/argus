import { useEffect, useRef, useState } from "react";
import { useViewerKeyboard } from "./useViewerKeyboard";
import {
  X,
  Minus,
  Plus,
  ArrowsOutSimple,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
export interface ViewedImage {
  src: string;
  alt: string;
}
export default function ImageViewer({
  image,
  onClose,
}: {
  image: ViewedImage;
  onClose(): void;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null);
  const [available, setAvailable] = useState({ width: 800, height: 600 });
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState(false);
  const [fit, setFit] = useState(true),
    [zoom, setZoom] = useState(1),
    [attempt, setAttempt] = useState(0);
  useViewerKeyboard(onClose, close);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver((entries) => {
      const b = entries[0]?.contentRect;
      if (b)
        setAvailable({
          width: Math.max(1, b.width),
          height: Math.max(1, b.height),
        });
    });
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  const scale =
    fit && natural
      ? Math.min(
          1,
          available.width / natural.width,
          available.height / natural.height,
        )
      : zoom;
  const adjust = (delta: number) => {
    setZoom(
      Math.max(0.1, Math.min(4, Math.round((scale + delta) * 100) / 100)),
    );
    setFit(false);
  };
  return (
    <div
      className="diagram-overlay image-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          const buttons = Array.from(
            dialog.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
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
        className="diagram-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-viewer-title"
      >
        <div className="diagram-viewer-toolbar">
          <span
            className="image-viewer-title"
            id="image-viewer-title"
            title={image.alt}
          >
            {image.alt || "图片查看"}
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="缩小图片"
              title="缩小图片"
              disabled={!natural || scale <= 0.1}
              onClick={() => adjust(-0.25)}
            >
              <Minus size={17} />
            </button>
            <span className="diagram-zoom">
              {natural ? `${Math.round(scale * 100)}%` : "—"}
            </span>
            <button
              className="icon-button"
              aria-label="放大图片"
              title="放大图片"
              disabled={!natural || scale >= 4}
              onClick={() => adjust(0.25)}
            >
              <Plus size={17} />
            </button>
            <button
              className="image-actual-size"
              disabled={!natural}
              aria-label="图片原始尺寸"
              title="原始尺寸100%"
              onClick={() => {
                setFit(false);
                setZoom(1);
              }}
            >
              1:1
            </button>
            <button
              className="icon-button"
              aria-label="图片适应窗口"
              title="适应窗口"
              disabled={!natural}
              onClick={() => setFit(true)}
            >
              <ArrowsOutSimple size={17} />
            </button>
            <button
              ref={close}
              className="icon-button"
              aria-label="关闭图片"
              title="关闭（Esc）"
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </div>
        <div ref={viewport} className="image-viewport">
          {error ? (
            <div className="image-viewer-error" role="alert">
              <p>图片无法加载，请检查图片路径或网络连接。</p>
              <button
                onClick={() => {
                  setError(false);
                  setNatural(null);
                  setAttempt((n) => n + 1);
                }}
              >
                <ArrowCounterClockwise size={15} />
                重试加载
              </button>
            </div>
          ) : (
            <>
              {!natural && (
                <p className="image-loading" role="status">
                  正在加载图片…
                </p>
              )}
              <div
                className="image-zoom-content"
                style={
                  natural
                    ? {
                        width: natural.width * scale,
                        height: natural.height * scale,
                      }
                    : undefined
                }
              >
                <img
                  key={`${image.src}-${attempt}`}
                  src={image.src}
                  alt={image.alt || "文档图片"}
                  draggable={false}
                  style={
                    natural
                      ? { width: "100%", height: "100%" }
                      : {
                          visibility: "hidden",
                          position: "absolute",
                          width: 1,
                          height: 1,
                        }
                  }
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setNatural({
                      width: img.naturalWidth,
                      height: img.naturalHeight,
                    });
                  }}
                  onError={() => {
                    setError(true);
                    setNatural(null);
                  }}
                  onDoubleClick={() => {
                    setFit((v) => !v);
                    setZoom(1);
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
