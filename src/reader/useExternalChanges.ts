import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createSessionId } from "../editor/autoSave";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AutoSaveSession } from "../editor/autoSave";
export interface Probe {
  status: "unchanged" | "changed" | "missing";
  version: string | null;
  writable: boolean;
}
export function useExternalChanges({
  enabled,
  path,
  version,
  getSession,
}: {
  enabled: boolean;
  path?: string;
  version?: string;
  getSession(): AutoSaveSession | null;
}) {
  const [notice, setNotice] = useState<Probe | null>(null);
  const current = useRef({ path, version, getSession });
  current.current = { path, version, getSession };
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const checking = useRef(false);
  const check = useCallback(async () => {
    const state = current.current;
    if (!enabled || !state.path?.startsWith("/") || !state.version) return;
    if (checking.current) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void check(), 350);
      return;
    }
    const session = state.getSession();
    if (session?.snapshot.status === "saving") {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void check(), 350);
      return;
    }
    const id = generation.current;
    const expected = session?.snapshot.version ?? state.version;
    checking.current = true;
    try {
      const result = await invoke<Probe>("probe_document", {
        path: state.path,
        version: expected,
      });
      if (
        id !== generation.current ||
        state.path !== current.current.path ||
        !result ||
        !["unchanged", "changed", "missing"].includes(result.status)
      )
        return;
      const active = current.current.getSession();
      if (active?.snapshot.status === "saving") {
        timer.current = setTimeout(() => void check(), 350);
        return;
      }
      if (
        result.version &&
        result.version === (active?.snapshot.version ?? current.current.version)
      ) {
        setNotice(null);
        return;
      }
      if (result.status !== "unchanged") {
        if (active)
          active.pauseForExternalChange(
            result.status === "missing"
              ? "原文件已移动或删除，已暂停自动保存。请另存副本以保留修改。"
              : "文件已在其他应用中修改，已暂停自动保存。编辑内容已保留，请另存副本或重新读取。",
          );
        else setNotice(result);
      } else setNotice(null);
    } catch {
      /* Checking availability must never interrupt reading; saves still verify the content version. */
    } finally {
      checking.current = false;
    }
  }, [enabled]);
  useEffect(() => {
    generation.current++;
    setNotice(null);
    clearTimeout(timer.current);
  }, [path, version]);
  useEffect(() => {
    const focus = () => {
      void check();
    };
    const visible = () => {
      if (document.visibilityState === "visible") focus();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (enabled) {
      const registration = getCurrentWindow().onFocusChanged?.(
        ({ payload }) => {
          if (payload) focus();
        },
      );
      if (registration)
        void registration
          .then((fn) => {
            if (disposed) fn();
            else unlisten = fn;
          })
          .catch(() => {});
    }
    return () => {
      disposed = true;
      generation.current++;
      clearTimeout(timer.current);
      unlisten?.();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, check]);
  useEffect(() => {
    if (!enabled || !path?.startsWith("/")) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const watchId = createSessionId();
    void listen<string>("document-changed", (event) => {
      if (event.payload === current.current.path) void check();
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
        return invoke("watch_document", { path, watchId }).then(() => {
          if (!disposed) void check();
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
      void invoke("watch_document", { path: null, watchId }).catch(() => {});
    };
  }, [enabled, path, check]);
  return { notice, check, dismiss: () => setNotice(null) };
}
