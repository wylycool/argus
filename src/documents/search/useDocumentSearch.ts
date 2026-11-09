import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createSessionId, saveError } from "../../editor/autoSave";
export interface SearchBuffer {
  path: string;
  text: string;
  version: string;
}
export interface SearchHit {
  path: string;
  name: string;
  version: string;
  line: number;
  column: number;
  length: number;
  matched: string;
  before: string;
  after: string;
  buffer: boolean;
}
export interface SearchResults {
  hits: SearchHit[];
  failures: { path: string; message: string }[];
  searched: number;
  total: number;
  truncated: boolean;
  cancelled: boolean;
}
const empty: SearchResults = {
  hits: [],
  failures: [],
  searched: 0,
  total: 0,
  truncated: false,
  cancelled: false,
};
export function useDocumentSearch(
  paths: string[],
  buffer: SearchBuffer | undefined,
  query: string,
) {
  const [result, setResult] = useState(empty),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const delivered = useRef<{
    query: string;
    paths: string;
    path?: string;
    text?: string;
  } | null>(null);
  const revision = useRef(0),
    mounted = useRef(true),
    running = useRef(false),
    active = useRef<string | null>(null);
  const pending = useRef<{
    revision: number;
    paths: string[];
    query: string;
    buffer?: SearchBuffer;
  } | null>(null);
  const run = useRef<() => void>(() => {});
  run.current = () => {
    if (running.current || !pending.current || !mounted.current) return;
    const job = pending.current;
    pending.current = null;
    running.current = true;
    const requestId = createSessionId();
    active.current = requestId;
    void invoke<SearchResults>("search_documents", {
      requestId,
      paths: job.paths,
      query: job.query,
      buffer: job.buffer ?? null,
    })
      .then((value) => {
        if (
          mounted.current &&
          job.revision === revision.current &&
          !value.cancelled
        ) {
          delivered.current = {
            query: job.query,
            paths: job.paths.join("\0"),
            path: job.buffer?.path,
            text: job.buffer?.text,
          };
          setResult(value);
        }
      })
      .catch((e) => {
        if (mounted.current && job.revision === revision.current)
          setError(saveError(e).message);
      })
      .finally(() => {
        running.current = false;
        if (active.current === requestId) active.current = null;
        if (mounted.current && job.revision === revision.current)
          setLoading(false);
        run.current();
      });
  };
  const pathKey = paths.join("\0");
  const bufferTooLarge = useMemo(
    () =>
      Boolean(
        buffer &&
        (buffer.text.length > 16 * 1024 * 1024 ||
          new TextEncoder().encode(buffer.text).byteLength > 16 * 1024 * 1024),
      ),
    [buffer?.text],
  );
  useEffect(() => {
    const id = ++revision.current;
    pending.current = null;
    setResult(empty);
    setError("");
    setLoading(Boolean(query.trim()));
    if (active.current)
      void invoke("cancel_document_search", {
        requestId: active.current,
      }).catch(() => {});
    if (!query.trim()) return;
    if (bufferTooLarge) {
      setLoading(false);
      setError(
        "当前内容超过16 MB，暂时无法搜索。请先精简内容，编辑输入仍然保留。",
      );
      return;
    }
    const timer = setTimeout(() => {
      pending.current = { revision: id, paths, query, buffer };
      run.current();
    }, 220);
    return () => {
      clearTimeout(timer);
      pending.current = null;
    };
    // Buffer version changes on autosave; identical text does not need another search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey, buffer?.path, buffer?.text, query, bufferTooLarge]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
      pending.current = null;
      if (active.current)
        void invoke("cancel_document_search", {
          requestId: active.current,
        }).catch(() => {});
    };
  }, []);
  const current = delivered.current;
  const visible =
    current?.query === query &&
    current.paths === pathKey &&
    current.path === buffer?.path &&
    current.text === buffer?.text;
  return { result: visible ? result : empty, loading, error };
}
