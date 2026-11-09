export default function DocumentModes({
  view,
  disabled,
  onView,
}: {
  view: "render" | "source";
  disabled: boolean;
  onView(view: "render" | "source"): void;
}) {
  return (
    <div className="document-modes" role="group" aria-label="查看方式">
      <button
        className="toolbar-control mode-control"
        title="阅读视图"
        aria-label="阅读视图"
        aria-pressed={view === "render"}
        disabled={disabled}
        onClick={() => onView("render")}
      >
        阅读
      </button>
      <button
        className="toolbar-control mode-control"
        title="只读源码"
        aria-label="只读源码"
        aria-pressed={view === "source"}
        disabled={disabled}
        onClick={() => onView("source")}
      >
        源码
      </button>
    </div>
  );
}
