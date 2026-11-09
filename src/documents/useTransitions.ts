import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Only the current document request may keep the editor locked. */
export function useDocumentTransitions(request: RefObject<number>) {
  const owners = useRef(
    new Map<number, { request: number; kind: "navigation" | "image" }>(),
  );
  const serial = useRef(0);
  const mounted = useRef(true);
  const [, repaint] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      owners.current.clear();
    };
  }, []);
  const changed = useCallback(() => {
    if (mounted.current) repaint((n) => n + 1);
  }, []);
  const isPending = useCallback(
    (kind?: "navigation" | "image") =>
      [...owners.current.values()].some(
        (owner) =>
          owner.request === request.current && (!kind || owner.kind === kind),
      ),
    [request],
  );
  const nextRequest = useCallback(() => {
    const id = ++request.current;
    owners.current.clear();
    changed();
    return id;
  }, [request, changed]);
  const hold = useCallback(
    (kind: "navigation" | "image" = "navigation") => {
      const id = ++serial.current;
      owners.current.set(id, { request: request.current, kind });
      changed();
      return () => {
        if (owners.current.delete(id)) changed();
      };
    },
    [request, changed],
  );
  return {
    transitioning: isPending(),
    imagePending: isPending("image"),
    hold,
    nextRequest,
    isPending,
  };
}
