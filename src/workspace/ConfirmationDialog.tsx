import { useRef } from "react";
import { useViewerKeyboard } from "./useViewerKeyboard";

export default function ConfirmationDialog({
  title,
  description,
  label,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  label: string;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useViewerKeyboard(onCancel, cancel, () => !busy);
  return (
    <div className="confirm-overlay">
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
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
        }}
      >
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <div className="confirm-actions">
          <button ref={cancel} disabled={busy} onClick={onCancel}>
            继续保留
          </button>
          <button
            className="confirm-primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}
