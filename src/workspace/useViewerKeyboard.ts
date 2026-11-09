import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/** WebKit can return focus to body after clicking a viewer control. */
export function useViewerKeyboard(
  onClose: () => void,
  closeButton: RefObject<HTMLButtonElement | null>,
  canHandleEscape?: (event: KeyboardEvent) => boolean,
) {
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const latestCanHandle = useRef(canHandleEscape);
  latestCanHandle.current = canHandleEscape;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        latestCanHandle.current?.(event) === false
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      latestClose.current();
    };
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [closeButton]);
}
