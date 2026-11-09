import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useDeferredValue,
  lazy,
  Suspense,
} from "react";
import type { MouseEvent as ReactMouseEvent, CSSProperties } from "react";
import {
  FolderOpen,
  List,
  SidebarSimple,
  FileText,
  ArrowRight,
  ArrowClockwise,
  X,
  Check,
  WarningCircle,
  ArrowLeft,
  Copy,
  FilePlus,
  ImageSquare,
  MagnifyingGlass,
  CaretRight,
  PencilSimple,
  Columns,
} from "@phosphor-icons/react";
import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { MarkdownEditorHandle } from "./editor/MarkdownEditor";
import type { EditorResume } from "./editor/MarkdownEditor";
import "./editor/editor.css";
import { useMermaid } from "./diagrams/useMermaid";
import MermaidViewer from "./diagrams/MermaidViewer";
import AppearanceMenu from "./theme/AppearanceMenu";
import DocumentModes from "./workspace/toolbar/DocumentModes";
import { FileMenu } from "./workspace/toolbar/DocumentMenus";
import type { ThemeName } from "./theme/themes";
import { isDarkTheme } from "./theme/themes";
import "./diagrams/diagrams.css";
import FindBar from "./reader/FindBar";
import HistoryDialog from "./reader/HistoryDialog";
import { defaultReading, readSettings } from "./reader/settings";
import { useExternalChanges } from "./reader/useExternalChanges";
import "./reader/reader.css";
import { NavigationTrail } from "./workspace/navigation";
import type { ReadingLocation } from "./workspace/navigation";
import OutlineNavigation from "./workspace/OutlineNavigation";
import FileContextMenu from "./workspace/FileContextMenu";
import type { ContextTarget } from "./workspace/FileContextMenu";
import ReadOnlyDialog from "./workspace/ReadOnlyDialog";
import ConfirmationDialog from "./workspace/ConfirmationDialog";
import ImageViewer from "./workspace/ImageViewer";
import type { ViewedImage } from "./workspace/ImageViewer";
import BatchNotice from "./workspace/BatchNotice";
import type { OpenFailure } from "./workspace/BatchNotice";
import "./workspace/workspace.css";
import {
  AutoSaveSession,
  normalizeText,
  saveError,
  createSessionId,
} from "./editor/autoSave";
import type { Draft, SaveSnapshot } from "./editor/autoSave";
import { renderMarkdown } from "./markdown";
import {
  basename,
  loadPreferences,
  rememberPosition,
  safeDecode,
  savePreferences,
} from "./storage";
import type { Position } from "./storage";
import { createAnchorResolver, prefixPrintAnchors } from "./documents/anchors";
import { useDocumentTransitions } from "./documents/useTransitions";
import { isCurrentOperation } from "./documents/operation";
import type { CopyResult, DocumentOperation } from "./documents/operation";
import { fitPrintDiagrams, groupPrintHeadings } from "./documents/print";
import QuickSwitcher from "./documents/QuickSwitcher";
import DocumentSearch from "./documents/search/DocumentSearch";
import type { SearchHit } from "./documents/search/useDocumentSearch";
import { analyzeCopy } from "./documents/copy/analyze";
import { isUntitledPath, locationLabel } from "./documents/untitled";
import { localImagePath } from "./documents/resources";
import { renderDiagram } from "./diagrams/engine";
import "./documents/documents.css";
import "./workspace/toolbar/toolbar.css";
import guide from "../samples/阅读指南.md?raw";
import landscape from "../samples/assets/landscape.svg";

const EditorWorkspace = lazy(() => import("./editor/preview/EditorWorkspace"));

interface ReaderDocument {
  path: string;
  name: string;
  content: string;
  version?: string;
  draft?: Draft | null;
  writable?: boolean;
  untitled?: boolean;
  unavailable?: boolean;
  recoveryWarning?: string;
}
interface OpenOptions {
  remember?: boolean;
  location?: ReadingLocation;
}
const GUIDE_PATH = "argus:guide";
const native = isTauri();
const emptySaveSnapshot: SaveSnapshot = {
  text: "",
  savedText: "",
  version: "",
  status: "saved",
  message: "",
  draftWarning: "",
};
const isMd = (path: string) => /\.(md|markdown|mdown|mkd)$/i.test(path);
const documentName = (path: string) =>
  path === GUIDE_PATH
    ? "阅读指南"
    : path.startsWith("browser:")
      ? path.slice(8)
      : basename(path);
export default function App() {
  const [preferences, setPreferences] = useState(loadPreferences);
  const preferencesRef = useRef(preferences);
  const [doc, setDoc] = useState<ReaderDocument | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const [navigation, setNavigation] = useState<"outline" | "files">("files");
  const pendingPath = useRef<string | null>(null);
  const browserDocuments = useRef(new Map<string, ReaderDocument>());
  const [activeHeading, setActiveHeading] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadSequence, setLoadSequence] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(0);
  const readerRef = useRef<HTMLElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const sourceRef = useRef<HTMLPreElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const restoring = useRef(false);
  const storageWarning = useRef(false);
  const initialized = useRef(false);
  const [editing, setEditing] = useState<AutoSaveSession | null>(null);
  const editingRef = useRef<AutoSaveSession | null>(null);
  useEffect(
    () => () => {
      // Invalidate pending UI work and stop timers if this WebView is unmounted.
      requestId.current++;
      const session = editingRef.current;
      editingRef.current = null;
      if (session) {
        void session.protect();
        session.stop();
      }
    },
    [],
  );
  const editorViewRef = useRef<MarkdownEditorHandle | null>(null);
  const editorResumeRef = useRef<EditorResume | undefined>(undefined);
  const editorStartLine = useRef(1);
  const activeHeadingRef = useRef(activeHeading);
  activeHeadingRef.current = activeHeading;
  const [recovery, setRecoveryState] = useState<Draft | null>(null);
  const recoveryRef = useRef<Draft | null>(null);
  const setRecovery = useCallback((draft: Draft | null) => {
    recoveryRef.current = draft;
    setRecoveryState(draft);
  }, []);
  const [confirmation, setConfirmation] = useState<
    "reload" | "discard-recovery" | null
  >(null);
  const {
    transitioning,
    imagePending,
    hold: holdTransition,
    nextRequest,
    isPending: transitionPending,
  } = useDocumentTransitions(requestId);
  const [diagramSource, setDiagramSource] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [viewedImage, setViewedImage] = useState<ViewedImage | null>(null);
  const [readonlyPrompt, setReadonlyPrompt] = useState<ReaderDocument | null>(
    null,
  );
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(
    null,
  );
  const [batchFailures, setBatchFailures] = useState<OpenFailure[]>([]);
  const trail = useRef(new NavigationTrail());
  const [trailCount, setTrailCount] = useState(0);
  const copyBusy = useRef(false);
  const [copyPreparing, setCopyPreparing] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [documentSearchOpen, setDocumentSearchOpen] = useState(false);
  const searchArrival = useRef<{
    node: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
    cleanup(): void;
  } | null>(null);
  useEffect(
    () => () => {
      if (searchArrival.current) {
        clearTimeout(searchArrival.current.timer);
        searchArrival.current.cleanup();
        searchArrival.current.node.classList.remove("search-arrival");
      }
    },
    [],
  );
  const [localDrafts, setLocalDrafts] = useState<string[]>([]);
  const [printHtml, setPrintHtml] = useState("");
  const [printing, setPrinting] = useState(false);
  const printBusy = useRef(false);
  const queuedExternalFiles = useRef<string[]>([]);
  const drainExternalFiles = useRef(() => {});
  const documentActions = useRef({
    new: () => {},
    quick: () => {},
    search: () => {},
    image: () => {},
    imagePath: (_path: string) => {},
    paste: (_file: File) => {},
    print: () => {},
    save: (_finish = false) => {},
  });
  const activeBatch = useRef<{ id: number; paths: Set<string> } | null>(null);
  const utilityActions = useRef({
    find: () => {},
    history: () => {},
    font: (_delta: number) => {},
    reset: () => {},
    copy: () => {},
    back: () => {},
  });
  const historyBusy = useRef(false);
  const saveSnapshot = useSyncExternalStore(
    useCallback(
      (listener) => editing?.subscribe(listener) ?? (() => {}),
      [editing],
    ),
    useCallback(() => editing?.snapshot ?? emptySaveSnapshot, [editing]),
  );
  const deferredEditText = useDeferredValue(saveSnapshot.text);
  const editingActionsRef = useRef<{
    begin(): void;
    save(): void;
    finish(): void;
    window(action: string): void;
  }>({ begin() {}, save() {}, finish() {}, window() {} });
  const { theme, view, sidebar, recent, openedPaths } = preferences;
  const modalOpen = Boolean(
    confirmation ||
    diagramSource ||
    versionsOpen ||
    viewedImage ||
    readonlyPrompt ||
    quickOpen ||
    documentSearchOpen ||
    printing,
  );
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  const searchRevision = useMemo(() => ({ document: doc, view }), [doc, view]);
  const external = useExternalChanges({
    enabled: native,
    path: doc?.path,
    version: doc?.version,
    getSession: () => editingRef.current,
  });
  useEffect(() => {
    setVersionsOpen(false);
    setReadonlyPrompt(null);
    setContextTarget(null);
    setViewedImage(null);
  }, [doc?.path]);
  useEffect(() => {
    if (editing) setSearchOpen(false);
  }, [editing]);
  useEffect(() => {
    if (modalOpen) setContextTarget(null);
  }, [modalOpen]);
  useEffect(() => {
    setDiagramSource(null);
    setViewedImage(null);
  }, [doc?.path, view, editing, confirmation]);
  const notify = useCallback((text: string) => setNotice(text), []);
  const canCopyPath = Boolean(doc?.path.startsWith("/") && !doc?.untitled);
  const copyPath = useCallback(
    async (path: string) => {
      if (!path.startsWith("/") || isUntitledPath(path)) return;
      try {
        await navigator.clipboard.writeText(path);
        notify("已复制绝对路径");
      } catch {
        setError("复制路径失败，请重试。当前文档和编辑内容不受影响。");
      }
    },
    [notify],
  );
  const copyAbsolutePath = useCallback(() => {
    const path = docRef.current?.path;
    if (path) return copyPath(path);
  }, [copyPath]);

  const storePosition = useCallback(() => {
    const reader = readerRef.current;
    const current = docRef.current;
    if (!reader || !current || restoring.current) return;
    const range = reader.scrollHeight - reader.clientHeight;
    const p: Position = {
      top: reader.scrollTop,
      ratio: range > 0 ? reader.scrollTop / range : 0,
    };
    const prefs = preferencesRef.current;
    const next = {
      ...prefs,
      positions: rememberPosition(prefs.positions, current.path, prefs.view, p),
    };
    preferencesRef.current = next;
    if (!savePreferences(next) && !storageWarning.current) {
      storageWarning.current = true;
      setError("无法保存阅读记录：本机存储空间不足。当前阅读不受影响。");
    }
  }, []);
  const updatePreferences = useCallback(
    (patch: Partial<typeof preferences>) => {
      const next = { ...preferencesRef.current, ...patch };
      preferencesRef.current = next;
      setPreferences(next);
    },
    [],
  );
  const updateReading = useCallback(
    (value: typeof preferences.reading) => {
      const reader = readerRef.current;
      const path = docRef.current?.path;
      const range = reader ? reader.scrollHeight - reader.clientHeight : 0;
      const ratio = reader && range > 0 ? reader.scrollTop / range : 0;
      storePosition();
      updatePreferences({ reading: readSettings(value) });
      requestAnimationFrame(() => {
        if (
          reader &&
          reader === readerRef.current &&
          path === docRef.current?.path
        )
          reader.scrollTop =
            ratio * Math.max(0, reader.scrollHeight - reader.clientHeight);
      });
    },
    [storePosition, updatePreferences],
  );
  const authorizeDocumentImages = useCallback(
    async (result: ReaderDocument) => {
      const assets: string[] = [];
      renderMarkdown(result.content, (src) => {
        const local = localImagePath(src, result.path);
        if (local) assets.push(local);
        return src;
      });
      if (assets.length)
        await invoke("authorize_images", {
          paths: [...new Set(assets)].slice(0, 1000),
        });
    },
    [],
  );
  const prepareNavigation = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      const session = editingRef.current;
      if (!session) return isCurrent();
      const request = requestId.current;
      const valid = () =>
        isCurrent() &&
        requestId.current === request &&
        editingRef.current === session &&
        docRef.current?.path === session.path;
      const release = holdTransition();
      try {
        while (valid()) {
          if (!(await session.flush()) || !valid()) return false;
          const snapshot = session.snapshot;
          const updated = {
            ...docRef.current!,
            content: snapshot.text,
            version: snapshot.version,
            draft: null,
          };
          await authorizeDocumentImages(updated).catch(() => {});
          if (!valid()) return false;
          // An earlier asynchronous input (for example image insertion) can finish
          // while resource authorization is pending. Do not drop that final edit.
          if (
            session.dirty ||
            session.snapshot.text !== snapshot.text ||
            session.snapshot.version !== snapshot.version
          )
            continue;
          docRef.current = updated;
          setDoc(updated);
          session.stop();
          editingRef.current = null;
          setEditing(null);
          return true;
        }
        return false;
      } finally {
        release();
      }
    },
    [authorizeDocumentImages, holdTransition],
  );
  const captureLocation = useCallback((): ReadingLocation | null => {
    const current = docRef.current;
    if (!current) return null;
    const mode = preferencesRef.current.view;
    const reader = readerRef.current;
    const range = reader ? reader.scrollHeight - reader.clientHeight : 0;
    const position = reader
      ? {
          top: reader.scrollTop,
          ratio: range > 0 ? reader.scrollTop / range : 0,
        }
      : (preferencesRef.current.positions[current.path]?.[mode] ?? {
          top: 0,
          ratio: 0,
        });
    return { path: current.path, view: mode, position: { ...position } };
  }, []);
  const rememberLocation = useCallback(
    (origin: ReadingLocation | null, next: string) => {
      if (origin && origin.path !== next) {
        trail.current.push(origin);
        setTrailCount(trail.current.length);
      }
    },
    [],
  );
  const commitDocument = useCallback(
    (
      result: ReaderDocument,
      origin: ReadingLocation | null,
      options: OpenOptions = {},
    ) => {
      storePosition();
      if (options.remember !== false) rememberLocation(origin, result.path);
      const draft = result.draft;
      if (
        draft &&
        !result.unavailable &&
        normalizeText(draft.text) === normalizeText(result.content)
      ) {
        if (native && result.path.startsWith("/"))
          void invoke("clear_draft", {
            path: draft.path,
            sessionId: draft.sessionId,
            revision: draft.revision,
          }).catch(() => {});
        setRecovery(null);
      } else setRecovery(draft ?? null);
      if (result.recoveryWarning) setError(result.recoveryWarning);
      const target = options.location;
      updatePreferences({
        lastPath: result.path,
        openedPaths: [
          ...new Set([...preferencesRef.current.openedPaths, result.path]),
        ],
        ...(result.path.startsWith("/")
          ? {
              recent: [
                result.path,
                ...preferencesRef.current.recent.filter(
                  (p) => p !== result.path,
                ),
              ].slice(0, 12),
            }
          : {}),
        ...(target ? { view: target.view } : {}),
        positions: rememberPosition(
          preferencesRef.current.positions,
          result.path,
          target?.view ?? preferencesRef.current.view,
          target?.position,
        ),
      });
      docRef.current = result;
      setDoc(result);
      setLoadSequence((sequence) => sequence + 1);
    },
    [storePosition, rememberLocation, updatePreferences],
  );
  const showGuide = useCallback(
    async (options: OpenOptions = {}) => {
      const id = nextRequest();
      const origin = captureLocation();
      if (
        editingRef.current &&
        !(await prepareNavigation(() => id === requestId.current))
      )
        return null;
      if (id !== requestId.current) return null;
      setBusy(false);
      setError("");
      pendingPath.current = null;
      const result = { path: GUIDE_PATH, name: "阅读指南", content: guide };
      commitDocument(result, origin, options);
      return result;
    },
    [captureLocation, prepareNavigation, commitDocument, nextRequest],
  );
  const openPath = useCallback(
    async (
      path: string,
      base?: string,
      reload = false,
      options: OpenOptions = {},
    ) => {
      const id = nextRequest();
      const origin = captureLocation();
      if (
        editingRef.current &&
        !(await prepareNavigation(() => id === requestId.current))
      )
        return null;
      if (id !== requestId.current) return null;
      pendingPath.current = path;
      storePosition();
      setBusy(true);
      setError("");
      setReadonlyPrompt(null);
      try {
        const result = await invoke<ReaderDocument>("read_document", {
          path,
          base: base ?? null,
        });
        if (id !== requestId.current) return null;
        pendingPath.current = result.path;
        await authorizeDocumentImages(result).catch((e) => {
          if (id === requestId.current)
            setError(
              `文档已打开，部分本地图片无法读取：${saveError(e).message}`,
            );
        });
        if (id !== requestId.current) return null;
        commitDocument(result, origin, options);
        if (reload) notify("已重新读取文件");
        return result;
      } catch (e) {
        if (id === requestId.current) setError(saveError(e).message);
        return null;
      } finally {
        if (id === requestId.current) {
          setBusy(false);
          pendingPath.current = null;
        }
      }
    },
    [
      nextRequest,
      captureLocation,
      prepareNavigation,
      storePosition,
      authorizeDocumentImages,
      commitDocument,
      notify,
    ],
  );
  const openPaths = useCallback(
    async (paths: string[]) => {
      const unique = [...new Set(paths)];
      const candidates = unique.filter(isMd);
      const failures: OpenFailure[] = unique
        .filter((p) => !isMd(p))
        .map((path) => ({ path, message: "不是支持的 Markdown 文档" }));
      if (!candidates.length) {
        setBatchFailures(failures);
        setError("请选择 Markdown 文档");
        return null;
      }
      const id = nextRequest();
      const origin = captureLocation();
      if (
        editingRef.current &&
        !(await prepareNavigation(() => id === requestId.current))
      )
        return null;
      if (id !== requestId.current) return null;
      storePosition();
      setBusy(true);
      setError("");
      setBatchFailures([]);
      setReadonlyPrompt(null);
      const successful = new Set<string>();
      activeBatch.current = { id, paths: new Set(candidates) };
      let last: ReaderDocument | null = null;
      try {
        for (const path of candidates) {
          if (id !== requestId.current) return null;
          pendingPath.current = path;
          try {
            const result = await invoke<ReaderDocument>("read_document", {
              path,
              base: null,
            });
            if (id !== requestId.current) return null;
            if (successful.has(result.path)) continue;
            successful.add(result.path);
            activeBatch.current?.paths.add(result.path);
            last = result;
            pendingPath.current = result.path;
            updatePreferences({
              openedPaths: [
                ...new Set([
                  ...preferencesRef.current.openedPaths,
                  result.path,
                ]),
              ],
              recent: [
                result.path,
                ...preferencesRef.current.recent.filter(
                  (p) => p !== result.path,
                ),
              ].slice(0, 12),
            });
          } catch (e) {
            if (id !== requestId.current) return null;
            failures.push({ path, message: saveError(e).message });
          }
        }
        if (last) {
          await authorizeDocumentImages(last).catch((e) => {
            if (id === requestId.current)
              setError(`部分本地图片无法读取：${saveError(e).message}`);
          });
          if (id !== requestId.current) return null;
          commitDocument(last, origin);
        }
        if (id === requestId.current) {
          setBatchFailures(failures);
          if (successful.size > 1) notify(`已打开 ${successful.size} 篇文档`);
        }
        return last;
      } finally {
        if (activeBatch.current?.id === id) activeBatch.current = null;
        if (id === requestId.current) {
          setBusy(false);
          pendingPath.current = null;
        }
      }
    },
    [
      nextRequest,
      captureLocation,
      prepareNavigation,
      storePosition,
      updatePreferences,
      authorizeDocumentImages,
      commitDocument,
      notify,
    ],
  );
  const openExternalPaths = useCallback(
    async (paths: string[]) => {
      if (modalOpenRef.current || historyBusy.current || printBusy.current) {
        queuedExternalFiles.current = [
          ...new Set([...queuedExternalFiles.current, ...paths]),
        ];
        return;
      }
      return await openPaths(paths);
    },
    [openPaths],
  );
  drainExternalFiles.current = () => {
    if (
      modalOpenRef.current ||
      historyBusy.current ||
      printBusy.current ||
      !queuedExternalFiles.current.length
    )
      return;
    const paths = queuedExternalFiles.current;
    queuedExternalFiles.current = [];
    void openPaths(paths);
  };
  useEffect(() => {
    if (!modalOpen) drainExternalFiles.current();
  }, [modalOpen]);
  const chooseFile = useCallback(async () => {
    if (!native) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: "打开 Markdown 文档",
        filters: [
          {
            name: "Markdown 文档",
            extensions: ["md", "markdown", "mdown", "mkd"],
          },
        ],
      });
      if (selected)
        await openExternalPaths(
          typeof selected === "string" ? [selected] : selected,
        );
    } catch (e) {
      setError(`无法打开文件选择器：${saveError(e).message}`);
    }
  }, [openExternalPaths]);
  const openBrowserFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return null;
      const id = nextRequest();
      const origin = captureLocation();
      if (
        editingRef.current &&
        !(await prepareNavigation(() => id === requestId.current))
      )
        return null;
      if (id !== requestId.current) return null;
      setBusy(true);
      setError("");
      setBatchFailures([]);
      activeBatch.current = {
        id,
        paths: new Set(files.map((file) => `browser:${file.name}`)),
      };
      const failures: OpenFailure[] = [];
      let last: ReaderDocument | null = null;
      try {
        for (const file of files) {
          if (id !== requestId.current) return null;
          if (!isMd(file.name)) {
            failures.push({
              path: file.name,
              message: "不是支持的 Markdown 文档",
            });
            continue;
          }
          if (file.size > 16 * 1024 * 1024) {
            failures.push({ path: file.name, message: "文档超过16 MB" });
            continue;
          }
          try {
            const content = new TextDecoder("utf-8", { fatal: true }).decode(
              await file.arrayBuffer(),
            );
            if (id !== requestId.current) return null;
            last = { path: `browser:${file.name}`, name: file.name, content };
            browserDocuments.current.set(last.path, last);
            updatePreferences({
              openedPaths: [
                ...new Set([...preferencesRef.current.openedPaths, last.path]),
              ],
            });
          } catch {
            failures.push({
              path: file.name,
              message: "文档不是UTF-8编码，请先转换为UTF-8",
            });
          }
        }
        if (last) commitDocument(last, origin);
        setBatchFailures(failures);
        return last;
      } finally {
        if (activeBatch.current?.id === id) activeBatch.current = null;
        if (id === requestId.current) setBusy(false);
      }
    },
    [
      captureLocation,
      prepareNavigation,
      updatePreferences,
      commitDocument,
      nextRequest,
    ],
  );
  const activateDocument = useCallback(
    async (path: string, options: OpenOptions = {}) => {
      if (path === docRef.current?.path && !options.location) {
        nextRequest();
        pendingPath.current = null;
        setBusy(false);
        return docRef.current;
      }
      if (path === GUIDE_PATH) {
        return showGuide(options);
      }
      const browserDoc = browserDocuments.current.get(path);
      if (browserDoc) {
        const id = nextRequest();
        if (
          editingRef.current &&
          !(await prepareNavigation(() => id === requestId.current))
        )
          return;
        const origin = captureLocation();
        pendingPath.current = null;
        setBusy(false);
        commitDocument(browserDoc, origin, options);
        if (options.location)
          requestAnimationFrame(() => {
            if (readerRef.current && docRef.current?.path === path)
              readerRef.current.scrollTop = options.location!.position.top;
          });
        return browserDoc;
      }
      return await openPath(path, undefined, false, options);
    },
    [
      showGuide,
      openPath,
      prepareNavigation,
      captureLocation,
      commitDocument,
      nextRequest,
    ],
  );
  const goBack = useCallback(async () => {
    if (modalOpen || copyBusy.current) return;
    const target = trail.current.peek();
    if (!target) return;
    const result = await activateDocument(target.path, {
      remember: false,
      location: target,
    });
    if (result && docRef.current?.path === result.path) {
      trail.current.remove(target);
      setTrailCount(trail.current.length);
    }
  }, [activateDocument, modalOpen]);
  const closeDocument = useCallback(
    async (path: string) => {
      const cancelsBatch =
        activeBatch.current?.id === requestId.current &&
        activeBatch.current.paths.has(path);
      if (docRef.current?.path === path) {
        const id = nextRequest();
        if (
          editingRef.current &&
          !(await prepareNavigation(() => id === requestId.current))
        )
          return;
      }
      storePosition();
      const paths = preferencesRef.current.openedPaths;
      const index = paths.indexOf(path);
      const remaining = paths.filter((p) => p !== path);
      browserDocuments.current.delete(path);
      const isCurrent = docRef.current?.path === path;
      if (isCurrent || pendingPath.current === path || cancelsBatch) {
        nextRequest();
        pendingPath.current = null;
        setBusy(false);
      }
      updatePreferences({
        openedPaths: remaining,
        ...(preferencesRef.current.lastPath === path ? { lastPath: null } : {}),
      });
      if (isUntitledPath(path))
        notify("草稿已保留在本机，可在快速切换（⌘ P）中重新打开。");
      if (!isCurrent) return;
      setDoc(null);
      docRef.current = null;
      setError("");
      setRecovery(null);
      setProgress(0);
      setNavigation("files");
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next) void activateDocument(next);
    },
    [
      storePosition,
      updatePreferences,
      activateDocument,
      prepareNavigation,
      nextRequest,
      notify,
    ],
  );
  const closeOtherDocuments = useCallback(
    async (path: string) => {
      const id = nextRequest();
      pendingPath.current = null;
      setBusy(false);
      if (!preferencesRef.current.openedPaths.includes(path)) return;
      if (
        editingRef.current &&
        editingRef.current.path !== path &&
        !(await prepareNavigation(() => id === requestId.current))
      )
        return;
      if (id !== requestId.current) return;
      if (docRef.current?.path !== path) {
        const result = await activateDocument(path);
        if (!result || docRef.current?.path !== path) return;
      }
      storePosition();
      updatePreferences({ openedPaths: [path] });
      for (const key of browserDocuments.current.keys())
        if (key !== path) browserDocuments.current.delete(key);
      notify("已关闭其他文档，磁盘文件仍然保留。");
    },
    [
      nextRequest,
      prepareNavigation,
      activateDocument,
      storePosition,
      updatePreferences,
      notify,
    ],
  );
  const closeContextMenu = useCallback(() => setContextTarget(null), []);
  const revealDocument = useCallback(async (path: string) => {
    try {
      await invoke("reveal_document", { path });
    } catch (e) {
      setError(saveError(e).message);
    }
  }, []);
  const toggleOutline = useCallback(() => {
    if (!docRef.current) return;
    setNavigation((current) =>
      current === "outline" && preferencesRef.current.sidebar
        ? "files"
        : "outline",
    );
    updatePreferences({ sidebar: true });
  }, [updatePreferences]);
  const switchView = useCallback(
    async (next?: "render" | "source") => {
      if (editingRef.current && !(await prepareNavigation())) return;
      storePosition();
      updatePreferences({
        view:
          next ??
          (preferencesRef.current.view === "render" ? "source" : "render"),
      });
    },
    [storePosition, updatePreferences, prepareNavigation],
  );
  const selectTheme = useCallback(
    (theme: ThemeName) =>
      updatePreferences({
        theme,
        ...(isDarkTheme(theme)
          ? { lastDarkTheme: theme }
          : { lastLightTheme: theme }),
      }),
    [updatePreferences],
  );
  const toggleTheme = useCallback(
    () =>
      selectTheme(
        isDarkTheme(preferencesRef.current.theme)
          ? preferencesRef.current.lastLightTheme
          : preferencesRef.current.lastDarkTheme,
      ),
    [selectTheme],
  );
  const toggleSidebar = useCallback(() => {
    storePosition();
    updatePreferences({ sidebar: !preferencesRef.current.sidebar });
  }, [storePosition, updatePreferences]);
  const reload = useCallback(() => {
    if (editingRef.current) {
      setConfirmation("reload");
      return;
    }
    const current = docRef.current;
    if (current && native && current.path !== GUIDE_PATH)
      void openPath(current.path, undefined, true);
    else if (current?.path === GUIDE_PATH) notify("阅读指南已是最新版本");
  }, [openPath, notify]);

  const beginEditing = useCallback(
    async (draft?: Draft, resume?: EditorResume) => {
      if (modalOpenRef.current) return;
      if (editingRef.current) {
        if (transitionPending()) {
          notify("正在完成当前操作，请稍候。");
          return;
        }
        editingActionsRef.current.finish();
        return;
      }
      const current = docRef.current;
      if (
        !current ||
        !native ||
        current.path === GUIDE_PATH ||
        current.path.startsWith("browser:")
      )
        return;
      if (recoveryRef.current && draft !== recoveryRef.current) {
        notify("请先恢复或放弃未保存草稿，再进入编辑。");
        return;
      }
      if (!current.version) {
        setError("这份文件缺少保存版本，请重新读取后编辑。");
        return;
      }
      if (current.unavailable) {
        setReadonlyPrompt({
          ...current,
          content: draft?.text ?? current.content,
        });
        return;
      }
      const request = nextRequest();
      pendingPath.current = null;
      setBusy(false);
      storePosition();
      setError("");
      const sessionId = createSessionId();
      const release = holdTransition();
      try {
        const probe = await invoke<{ status?: string; writable?: boolean }>(
          "probe_document",
          { path: current.path, version: current.version },
        );
        if (
          request !== requestId.current ||
          docRef.current?.path !== current.path
        )
          return;
        if (probe?.status === "changed" || probe?.status === "missing") {
          setError(
            "磁盘文件已经变化或无法访问，请重新读取后再编辑。当前内容仍保留。",
          );
          return;
        }
        if (probe?.writable === false) {
          setReadonlyPrompt({
            ...current,
            content: draft?.text ?? current.content,
          });
          return;
        }
        await invoke("begin_edit_session", {
          path: current.path,
          sessionId,
          recovery: draft ?? null,
        });
      } catch (error) {
        if (
          request !== requestId.current ||
          docRef.current?.path !== current.path
        )
          return;
        if (saveError(error).code === "readonly")
          setReadonlyPrompt({
            ...current,
            content: draft?.text ?? current.content,
          });
        else setError(saveError(error).message);
        return;
      } finally {
        release();
      }
      if (
        request !== requestId.current ||
        docRef.current?.path !== current.path
      )
        return;
      editorStartLine.current =
        (renderMarkdown(current.content).headings.find(
          (h) => h.id === activeHeadingRef.current,
        )?.line ?? 0) + 1;
      const session = new AutoSaveSession(
        current.path,
        current.content,
        current.version,
        {
          writeDraft: (draft) => invoke("write_draft", { draft }),
          save: (draft) => invoke("save_document", { draft }),
          clearDraft: (draft) =>
            invoke("clear_draft", {
              path: draft.path,
              sessionId: draft.sessionId,
              revision: draft.revision,
            }),
        },
        draft,
        sessionId,
      );
      editingRef.current = session;
      editorResumeRef.current = resume;
      setEditing(session);
      setRecovery(null);
      updatePreferences({ view: "render" });
      void session.protect();
      return session;
    },
    [
      prepareNavigation,
      updatePreferences,
      storePosition,
      notify,
      holdTransition,
      nextRequest,
      transitionPending,
    ],
  );
  const finishEditing = useCallback(async () => {
    if (transitionPending()) {
      notify("正在完成当前操作，请稍候。");
      return;
    }
    if (docRef.current?.untitled) {
      documentActions.current.save(true);
      return;
    }
    if (await prepareNavigation()) {
      updatePreferences({ view: "render" });
      const current = docRef.current;
      if (current && native && current.path !== GUIDE_PATH)
        await openPath(current.path);
    }
  }, [
    prepareNavigation,
    updatePreferences,
    openPath,
    transitionPending,
    notify,
  ]);
  const finishWindow = useCallback(
    async (action: string) => {
      if (!["close", "quit"].includes(action)) return;
      if (
        historyBusy.current ||
        copyBusy.current ||
        printBusy.current ||
        transitionPending()
      ) {
        notify("正在完成当前操作，请稍候再关闭。");
        return;
      }
      if (!(await prepareNavigation())) {
        notify("尚有内容未保存，请先处理保存提示。");
        return;
      }
      storePosition();
      savePreferences(preferencesRef.current);
      try {
        await invoke("finish_window_action", { action });
      } catch (e) {
        setError(saveError(e).message);
      }
    },
    [prepareNavigation, storePosition, notify, transitionPending],
  );
  editingActionsRef.current = {
    begin: () => beginEditing(),
    save: () => {
      if (docRef.current?.untitled) documentActions.current.save();
      else void editingRef.current?.flush();
    },
    finish: () => {
      void finishEditing();
    },
    window: (action) => {
      void finishWindow(action);
    },
  };
  const openFind = useCallback(() => {
    if (!docRef.current || modalOpen) return;
    if (editingRef.current) {
      editorViewRef.current?.find();
      return;
    }
    setSearchOpen(true);
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(".reader-find input")?.focus(),
    );
  }, [modalOpen]);
  const showVersions = useCallback(async () => {
    if (transitionPending()) {
      notify("正在完成当前操作，请稍候。");
      return;
    }
    const current = docRef.current;
    if (
      !native ||
      !current?.path.startsWith("/") ||
      current.untitled ||
      modalOpen
    )
      return;
    if (!(await prepareNavigation()) || docRef.current?.path !== current.path)
      return;
    setSearchOpen(false);
    setVersionsOpen(true);
  }, [prepareNavigation, modalOpen, transitionPending, notify]);
  const changeFont = useCallback(
    (delta: number) => {
      if (modalOpen) return;
      updateReading({
        ...preferencesRef.current.reading,
        fontSize: preferencesRef.current.reading.fontSize + delta,
      });
    },
    [updateReading, modalOpen],
  );
  utilityActions.current = {
    find: openFind,
    history: () => void showVersions(),
    font: changeFont,
    reset: () => {
      if (!modalOpenRef.current) updateReading({ ...defaultReading });
    },
    copy: () => {},
    back: () => {
      void goBack();
    },
  };
  const saveAsCopy = useCallback(
    async (
      editAfter = false,
      sourceOverride?: ReaderDocument,
    ): Promise<CopyResult> => {
      const current = sourceOverride ?? docRef.current;
      const session = editingRef.current;
      if (!native || !current || copyBusy.current || historyBusy.current)
        return { status: "blocked" };
      if (docRef.current?.path !== current.path) return { status: "blocked" };
      if (
        current.untitled &&
        recoveryRef.current &&
        !session &&
        !sourceOverride
      ) {
        notify("请先恢复或放弃未保存草稿，再保存到文件。");
        return { status: "blocked" };
      }
      const token = nextRequest();
      pendingPath.current = null;
      setBusy(false);
      copyBusy.current = true;
      const valid = () =>
        token === requestId.current &&
        docRef.current?.path === current.path &&
        editingRef.current === session;
      let writtenPath: string | null = null;
      let release: (() => void) | undefined;
      try {
        const fallback =
          current.name.replace(/\.(md|markdown|mdown|mkd)$/i, "") +
          "（副本）.md";
        const selected = await save({
          title: current.untitled
            ? "保存 Markdown 文档"
            : "另存为 Markdown 副本",
          defaultPath: current.untitled
            ? current.name
            : current.path.startsWith("/")
              ? current.path.replace(
                  /\.(md|markdown|mdown|mkd)$/i,
                  "（副本）.md",
                )
              : fallback,
          filters: [{ name: "Markdown 文档", extensions: ["md"] }],
        });
        if (!selected) return { status: "cancelled" };
        if (!valid()) return { status: "cancelled" };
        release = holdTransition();
        setCopyPreparing(current.name);
        const text = session?.snapshot.text ?? current.content;
        if (
          text.length > 16 * 1024 * 1024 ||
          new TextEncoder().encode(text).byteLength > 16 * 1024 * 1024
        )
          throw new Error("文档超过16 MB，尚未另存，请先精简内容。");
        const source =
          current.path.startsWith("/") && !current.untitled
            ? current.path
            : null;
        const references = source ? await analyzeCopy(text, source) : [];
        if (!valid()) return { status: "cancelled" };
        if (session && session.snapshot.text !== text)
          throw new Error(
            "资源分析期间输入已经变化，请重新另存。当前输入仍保留。",
          );
        const saved = await invoke<{
          version: string;
          content?: string;
          images?: number;
        }>("save_copy", {
          path: selected,
          content: text,
          source,
          references,
        });
        writtenPath = selected;
        if (!valid()) {
          notify(`副本已保存：${basename(selected)}`);
          return { status: "written", path: selected };
        }
        // Read and validate the destination before releasing the only live buffer.
        const result = await invoke<ReaderDocument>("read_document", {
          path: selected,
          base: null,
        });
        if (!valid()) return { status: "written", path: selected };
        if (
          result.version !== saved.version ||
          normalizeText(result.content) !== normalizeText(saved.content ?? text)
        )
          throw new Error("副本内容已经变化，尚未切换。");
        let imageError = "";
        await authorizeDocumentImages(result).catch((e) => {
          imageError = `部分本地图片无法读取：${saveError(e).message}`;
        });
        if (!valid()) return { status: "written", path: selected };
        if (session && session.snapshot.text !== text)
          throw new Error("保存期间输入已经变化，尚未切换。");
        const origin = captureLocation();
        const resume =
          editAfter && session ? editorViewRef.current?.capture?.() : undefined;
        if (session) {
          try {
            await session.discard();
          } catch (e) {
            setError(
              `副本已保存：${selected}。结束编辑未完成，当前输入仍保留：${saveError(e).message}`,
            );
            return { status: "written", path: selected };
          }
          if (!valid()) return { status: "written", path: selected };
          if (editingRef.current === session) {
            editingRef.current = null;
            setEditing(null);
          }
        }
        commitDocument(result, origin, {
          remember: !current.untitled,
          ...(current.untitled && origin
            ? { location: { ...origin, path: result.path } }
            : {}),
        });
        let cleanupWarning = "";
        if (current.untitled) {
          // Keep the transition owned until cleanup completes. Native creation may
          // reuse this temporary pathname as soon as its file has been removed.
          await invoke("remove_untitled", {
            path: current.path,
            expectedVersion: session?.snapshot.version ?? current.version ?? "",
          })
            .then(() => {
              trail.current.retarget(current.path, result.path);
              updatePreferences({
                openedPaths: preferencesRef.current.openedPaths.filter(
                  (p) => p !== current.path,
                ),
                recent: preferencesRef.current.recent.filter(
                  (p) => p !== current.path,
                ),
                positions: Object.fromEntries(
                  Object.entries(preferencesRef.current.positions).filter(
                    ([p]) => p !== current.path,
                  ),
                ),
              });
            })
            .catch(() => {
              cleanupWarning =
                "文档已保存；原草稿仍保留，可从文件列表或快速切换重新打开。";
            });
        }
        if (
          token !== requestId.current ||
          docRef.current?.path !== result.path
        ) {
          if (cleanupWarning) notify(cleanupWarning);
          return { status: "written", path: selected };
        }
        setError(imageError);
        notify(
          cleanupWarning ||
            (current.untitled
              ? "文档已保存。"
              : saved.images
                ? `副本已保存，已携带 ${saved.images} 张本地图片，并已切换。`
                : "副本已保存，并已切换到副本。"),
        );
        const resumed = editAfter
          ? await beginEditing(undefined, resume)
          : null;
        if (
          docRef.current?.path !== result.path ||
          (editAfter && (!resumed || editingRef.current !== resumed))
        )
          return { status: "written", path: selected };
        return {
          status: "switched",
          path: selected,
          context: {
            path: result.path,
            session: resumed ?? null,
            request: requestId.current,
          },
        };
      } catch (e) {
        if (valid())
          setError(
            writtenPath
              ? `副本已写入：${writtenPath}。未能完成切换：${saveError(e).message} 当前文档和输入仍然保留。`
              : saveError(e).message,
          );
        return writtenPath
          ? { status: "written", path: writtenPath }
          : { status: "failed" };
      } finally {
        copyBusy.current = false;
        setCopyPreparing(null);
        release?.();
      }
    },
    [
      beginEditing,
      notify,
      authorizeDocumentImages,
      captureLocation,
      commitDocument,
      updatePreferences,
      holdTransition,
      nextRequest,
    ],
  );
  utilityActions.current.copy = () => {
    if (!modalOpen) void saveAsCopy();
  };
  documentActions.current.save = (finish = false) => {
    void saveAsCopy(!finish && Boolean(editingRef.current));
  };
  documentActions.current.new = () => {
    if (!native || modalOpenRef.current || copyBusy.current) return;
    void (async () => {
      const id = nextRequest();
      const origin = captureLocation();
      if (!(await prepareNavigation(() => id === requestId.current))) return;
      try {
        const result = await invoke<ReaderDocument>("new_document");
        if (id !== requestId.current) {
          void invoke("remove_untitled", {
            path: result.path,
            expectedVersion: result.version ?? "",
          }).catch(() => {});
          return;
        }
        commitDocument(result, origin);
        updatePreferences({ view: "render" });
        await beginEditing();
      } catch (e) {
        setError(saveError(e).message);
      }
    })();
  };
  useEffect(() => {
    if (!native || !quickOpen) return;
    let disposed = false;
    void invoke<string[]>("list_untitled")
      .then((paths) => {
        if (!disposed && Array.isArray(paths)) setLocalDrafts(paths);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [quickOpen]);
  documentActions.current.search = () => {
    if (
      !native ||
      modalOpenRef.current ||
      copyBusy.current ||
      historyBusy.current
    )
      return;
    if (transitionPending()) {
      notify("正在完成当前操作，请稍候。");
      return;
    }
    if (
      !preferencesRef.current.openedPaths.some((path) => path.startsWith("/"))
    ) {
      notify("请先打开需要搜索的 Markdown 文档。");
      return;
    }
    setSearchOpen(false);
    setDocumentSearchOpen(true);
  };
  documentActions.current.quick = () => {
    if (!modalOpenRef.current) setQuickOpen(true);
  };
  const insertImage = async (source?: string, file?: File) => {
    const origin = docRef.current;
    const originSession = editingRef.current;
    if (!native || !origin || !originSession || modalOpenRef.current) return;
    if (transitionPending()) {
      notify("正在完成当前操作，请稍候再插入图片。");
      return;
    }
    let release = holdTransition("image");
    let operation: DocumentOperation = {
      path: origin.path,
      session: originSession,
      request: requestId.current,
    };
    const valid = () =>
      isCurrentOperation(
        operation,
        docRef.current?.path,
        editingRef.current,
        requestId.current,
      );
    try {
      if (file && file.size > 8 * 1024 * 1024)
        throw new Error(
          "粘贴图片超过8 MB，请压缩或通过插入图片按钮选择原文件。",
        );
      if (origin.untitled) {
        const result = await saveAsCopy(true);
        if (result.status !== "switched" || !result.context.session) return;
        operation = result.context;
        release();
        release = holdTransition("image");
      }
      if (!valid()) return;
      const bytes = file
        ? Array.from(new Uint8Array(await file.arrayBuffer()))
        : null;
      if (!valid()) return;
      const relative = await invoke<string>("insert_image", {
        path: operation.path,
        source: source ?? null,
        bytes,
      });
      if (!valid()) return;
      const deadline = Date.now() + 3000;
      while (!editorViewRef.current && valid() && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 16));
      if (!valid()) return;
      if (!editorViewRef.current)
        throw new Error("编辑器尚未就绪，请重试插入图片。");
      editorViewRef.current.insert(`\n![图片](${relative})\n`);
    } catch (e) {
      if (valid()) setError(saveError(e).message);
    } finally {
      release();
      if (valid())
        requestAnimationFrame(() => {
          if (valid()) editorViewRef.current?.focus();
        });
    }
  };
  documentActions.current.paste = (file) => {
    void insertImage(undefined, file);
  };
  documentActions.current.imagePath = (path) => {
    void insertImage(path);
  };
  documentActions.current.image = () => {
    if (!editingRef.current || modalOpenRef.current) {
      notify("请先进入编辑，再插入图片。");
      return;
    }
    const session = editingRef.current;
    void open({
      multiple: false,
      title: "插入图片",
      filters: [
        {
          name: "图片",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
        },
      ],
    })
      .then((selected) => {
        if (typeof selected === "string" && editingRef.current === session)
          void insertImage(selected);
      })
      .catch((e) => setError(saveError(e).message));
  };
  documentActions.current.print = () => {
    if (!native || !docRef.current || modalOpenRef.current || printBusy.current)
      return;
    const current = docRef.current;
    const content = editingRef.current?.snapshot.text ?? current.content;
    printBusy.current = true;
    setPrinting(true);
    void (async () => {
      await authorizeDocumentImages({ ...current, content });
      const prepared = renderMarkdown(content, (src) => {
        if (/^(https?:|data:|blob:|asset:)/i.test(src)) return src;
        if (current.path === GUIDE_PATH && src === "assets/landscape.svg")
          return landscape;
        const local = localImagePath(src, current.path);
        return local ? convertFileSrc(local) : "";
      });
      if (prepared.diagrams.length > 50)
        throw new Error("单次打印最多包含50张图表，请拆分文档。");
      const host = document.createElement("div");
      host.innerHTML = prepared.html;
      for (const diagram of prepared.diagrams.slice(0, 50)) {
        const stage = host.querySelector(
          `[data-argus-diagram="${diagram.id}"] .mermaid-stage`,
        );
        if (stage)
          stage.innerHTML =
            (await renderDiagram(diagram.source, "white")) ?? "";
      }
      fitPrintDiagrams(host);
      groupPrintHeadings(host);
      prefixPrintAnchors(host);
      host.querySelectorAll("img").forEach((img) => (img.loading = "eager"));
      setPrintHtml(host.innerHTML);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await Promise.all(
        Array.from(
          document.querySelectorAll<HTMLImageElement>(".print-document img"),
        ).map(
          (img) =>
            new Promise<void>((resolve, reject) => {
              if (img.complete) {
                if (img.naturalWidth) resolve();
                else reject(new Error("有图片无法加载，请修正图片后再打印。"));
                return;
              }
              const timer = setTimeout(() => finish(false), 10000);
              const finish = (ok: boolean) => {
                clearTimeout(timer);
                img.onload = null;
                img.onerror = null;
                if (ok) resolve();
                else
                  reject(
                    new Error("有图片未能加载，请检查网络或路径后再打印。"),
                  );
              };
              img.onload = () => finish(true);
              img.onerror = () => finish(false);
            }),
        ),
      );
      await document.fonts?.ready;
      await invoke("print_document");
    })()
      .catch((e) => setError(`无法准备打印：${saveError(e).message}`))
      .finally(() => {
        setPrinting(false);
        printBusy.current = false;
        drainExternalFiles.current();
        // Native macOS printing outlives this IPC call. Retain one hidden,
        // sanitized snapshot until the next print replaces it.
      });
  };
  const confirmReload = useCallback(async () => {
    const current = docRef.current;
    if (!current) return;
    const release = holdTransition();
    try {
      if (confirmation === "discard-recovery" && recovery)
        await invoke("clear_draft", {
          path: recovery.path,
          sessionId: recovery.sessionId,
          revision: recovery.revision,
        });
      if (confirmation === "reload") {
        const session = editingRef.current;
        if (session) {
          await session.discard();
          editingRef.current = null;
          setEditing(null);
        }
      }
      setConfirmation(null);
      setRecovery(null);
      if (confirmation === "reload")
        await openPath(current.path, undefined, true);
    } catch (e) {
      setError(saveError(e).message);
    } finally {
      release();
    }
  }, [confirmation, recovery, openPath, holdTransition]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    savePreferences(preferencesRef.current);
  }, [preferences]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2400);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (native)
      void getCurrentWindow()
        .setTitle(doc ? `${doc.name} — Argus` : "Argus")
        .catch(() => {});
    document.title = doc ? `${doc.name} — Argus` : "Argus";
  }, [doc]);
  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const drainPending = async () => {
      const files = await invoke<string[]>("take_pending_files");
      if (disposed) return false;
      if (files.length) {
        openExternalPaths(files);
        return true;
      }
      return false;
    };
    const attach = async () => {
      if (native) {
        const pending = [
          listen<string>("menu-action", (e) => {
            if (modalOpenRef.current && e.payload !== "quit") return;
            if (
              transitionPending() &&
              !["open", "new", "navigate-back", "quit", "save"].includes(
                e.payload,
              )
            ) {
              notify("正在完成当前操作，请稍候。");
              return;
            }
            if (e.payload === "new") documentActions.current.new();
            if (e.payload === "quick-switch") documentActions.current.quick();
            if (e.payload === "insert-image") documentActions.current.image();
            if (e.payload === "print-document") documentActions.current.print();
            if (e.payload === "search-opened") documentActions.current.search();
            if (e.payload === "find") utilityActions.current.find();
            if (e.payload === "history") utilityActions.current.history();
            if (e.payload === "font-increase") utilityActions.current.font(1);
            if (e.payload === "font-decrease") utilityActions.current.font(-1);
            if (e.payload === "reading-reset") utilityActions.current.reset();
            if (e.payload === "open") void chooseFile();
            if (e.payload === "save-copy") utilityActions.current.copy();
            if (e.payload === "navigate-back") utilityActions.current.back();
            if (e.payload === "view") switchView();
            if (e.payload === "theme") toggleTheme();
            if (e.payload === "sidebar") toggleSidebar();
            if (e.payload === "reload") reload();
            if (e.payload === "edit") editingActionsRef.current.begin();
            if (e.payload === "save") editingActionsRef.current.save();
            if (e.payload === "quit") editingActionsRef.current.window("quit");
          }),
          listen<string>("app-action", (e) =>
            editingActionsRef.current.window(e.payload),
          ),
          listen("files-opened", () => {
            void drainPending().catch((e) => setError(String(e)));
          }),
          getCurrentWebviewWindow().onDragDropEvent((e) => {
            if (e.payload.type === "enter" || e.payload.type === "over")
              setDragging(true);
            if (e.payload.type === "leave") setDragging(false);
            if (e.payload.type === "drop") {
              setDragging(false);
              const paths = e.payload.paths;
              if (
                editingRef.current &&
                paths.length === 1 &&
                /\.(png|jpe?g|gif|webp|bmp)$/i.test(paths[0])
              )
                documentActions.current.imagePath(paths[0]);
              else openExternalPaths(paths);
            }
          }),
        ];
        const results = await Promise.allSettled(pending);
        for (const result of results) {
          if (result.status === "fulfilled") {
            if (disposed) result.value();
            else unlisteners.push(result.value);
          } else if (!disposed)
            setError(`系统事件注册失败：${String(result.reason)}`);
        }
      }
      if (disposed || initialized.current) return;
      initialized.current = true;
      if (native && (await drainPending())) return;
      if (docRef.current) return;
      const lastPath = preferencesRef.current.lastPath;
      if (lastPath === GUIDE_PATH) showGuide();
      else if (native && lastPath) void openPath(lastPath);
    };
    void attach().catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [
    chooseFile,
    openPath,
    openPaths,
    openExternalPaths,
    transitionPending,
    reload,
    showGuide,
    switchView,
    toggleSidebar,
    toggleTheme,
    notify,
  ]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        utilityActions.current.back();
        return;
      }
      if (
        !native &&
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "s"
      ) {
        e.preventDefault();
        utilityActions.current.copy();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "f") {
          e.preventDefault();
          if (e.shiftKey) documentActions.current.search();
          else utilityActions.current.find();
          return;
        }
        if (!editingRef.current && ["+", "=", "-", "0"].includes(key)) {
          e.preventDefault();
          if (key === "0") utilityActions.current.reset();
          else utilityActions.current.font(key === "-" ? -1 : 1);
          return;
        }
      }
      if (e.key === "Escape") {
        setError("");
        setDragging(false);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || native) return;
      const key = e.key.toLowerCase();
      if (key === "o") {
        e.preventDefault();
        void chooseFile();
      }
      if (e.shiftKey && key === "m") {
        e.preventDefault();
        switchView();
      }
      if (e.shiftKey && key === "l") {
        e.preventDefault();
        toggleTheme();
      }
      if (key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    const onHide = () => {
      if (editingRef.current) void editingRef.current.protect();
      storePosition();
      savePreferences(preferencesRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [chooseFile, storePosition, switchView, toggleSidebar, toggleTheme]);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (editingRef.current?.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, []);

  const outlineSource =
    editing && navigation === "outline"
      ? deferredEditText
      : (doc?.content ?? "");
  const rendered = useMemo(
    () =>
      renderMarkdown(outlineSource, (src) => {
        if (doc?.path === GUIDE_PATH && src === "assets/landscape.svg")
          return landscape;
        if (!doc || !native || /^(?:https?:|data:|blob:|asset:)/i.test(src))
          return src;
        const local = localImagePath(src, doc.path);
        return local ? convertFileSrc(local) : "";
      }),
    [doc, outlineSource],
  );

  const updateScroll = useCallback(() => {
    const reader = readerRef.current;
    if (!reader) return;
    const range = reader.scrollHeight - reader.clientHeight;
    setProgress(
      range > 0
        ? Math.min(100, Math.round((reader.scrollTop / range) * 100))
        : 100,
    );
    if (preferencesRef.current.view === "render") {
      const top = reader.getBoundingClientRect().top;
      const headings = Array.from(
        articleRef.current?.querySelectorAll<HTMLElement>(
          "h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]",
        ) ?? [],
      );
      let active = headings[0]?.id ?? "";
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top - top <= 110)
          active = heading.id;
        else break;
      }
      if (range > 0 && reader.scrollTop >= range - 2)
        active = headings.at(-1)?.id ?? active;
      setActiveHeading(active);
    }
    storePosition();
  }, [storePosition]);

  useLayoutEffect(() => {
    const reader = readerRef.current;
    if (!reader || !doc) return;
    restoring.current = true;
    const position = preferencesRef.current.positions[doc.path]?.[view];
    const target = position?.top ?? 0;
    reader.scrollTop = target;
    setActiveHeading(rendered.headings[0]?.id ?? "");
    const apply = () => {
      if (restoring.current)
        reader.scrollTop = Math.min(
          target,
          Math.max(0, reader.scrollHeight - reader.clientHeight),
        );
    };
    const observer = new ResizeObserver(apply);
    const content = view === "render" ? articleRef.current : sourceRef.current;
    if (content) observer.observe(content);
    const endRestoration = () => {
      restoring.current = false;
      observer.disconnect();
    };
    reader.addEventListener("wheel", endRestoration, { passive: true });
    reader.addEventListener("touchstart", endRestoration, { passive: true });
    reader.addEventListener("pointerdown", endRestoration);
    const timer = setTimeout(() => {
      endRestoration();
      updateScroll();
    }, 2000);
    const frame = requestAnimationFrame(() => {
      apply();
      updateScroll();
    });
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      restoring.current = false;
      reader.removeEventListener("wheel", endRestoration);
      reader.removeEventListener("touchstart", endRestoration);
      reader.removeEventListener("pointerdown", endRestoration);
    };
  }, [doc, view, rendered, updateScroll, editing]);
  useMermaid(
    articleRef,
    rendered.diagrams,
    theme,
    Boolean(doc && !editing && view === "render"),
    setDiagramSource,
    updateScroll,
  );

  const jumpTo = useCallback((id: string, line?: number) => {
    restoring.current = false;
    if (editingRef.current && editorViewRef.current) {
      const editor = editorViewRef.current;
      editor.jumpToLine((line ?? 0) + 1);
      editor.focus();
      setActiveHeading(id);
      return;
    }
    if (preferencesRef.current.view === "source" && readerRef.current) {
      const lineHeight = parseFloat(
        getComputedStyle(sourceRef.current!).lineHeight,
      );
      readerRef.current.scrollTo({
        top: (line ?? 0) * lineHeight,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    } else {
      const target = createAnchorResolver(articleRef.current ?? document)(id);
      target?.scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
    setActiveHeading(id);
  }, []);
  const locateSearchHit = async (hit: SearchHit) => {
    setDocumentSearchOpen(false);
    const current = docRef.current;
    const session = editingRef.current;
    const matches = (input: string) => {
      const text = normalizeText(input);
      let from = 0;
      for (let line = 1; line < hit.line; line++) {
        const next = text.indexOf("\n", from);
        if (next < 0) return false;
        from = next + 1;
      }
      const end = text.indexOf("\n", from);
      return (
        from + hit.column + hit.length <= (end < 0 ? text.length : end) &&
        text.slice(from + hit.column, from + hit.column + hit.length) ===
          hit.matched
      );
    };
    if (current?.path === hit.path && session) {
      const request = requestId.current;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (
        request !== requestId.current ||
        editingRef.current !== session ||
        docRef.current?.path !== hit.path
      )
        return;
      if (!matches(session.snapshot.text)) {
        notify("内容已变化，请重新搜索。");
        return;
      }
      if (editorViewRef.current?.revealMatch)
        editorViewRef.current.revealMatch(hit.line, hit.column, hit.length);
      else editorViewRef.current?.jumpToLine(hit.line);
      return;
    }
    const result: ReaderDocument | null | undefined = await activateDocument(
      hit.path,
    );
    if (!result) {
      requestAnimationFrame(() => editorViewRef.current?.focus());
      return;
    }
    const request = requestId.current;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (request !== requestId.current || docRef.current?.path !== result.path)
      return;
    if (
      (!hit.buffer && result.version !== hit.version) ||
      !matches(result.content)
    ) {
      notify("文档内容已变化，已打开最新内容，请重新搜索。");
      return;
    }
    restoring.current = false;
    const reader = readerRef.current;
    if (!reader) return;
    if (preferencesRef.current.view === "source") {
      const height =
        Number.parseFloat(getComputedStyle(sourceRef.current!).lineHeight) ||
        24;
      reader.scrollTop = Math.max(
        0,
        (hit.line - 1) * height - reader.clientHeight / 3,
      );
    } else {
      const line = hit.line - 1;
      let target: HTMLElement | undefined;
      for (const node of articleRef.current?.querySelectorAll<HTMLElement>(
        "[data-argus-line]",
      ) ?? []) {
        const from = Number(node.dataset.argusLine),
          end = Number(node.dataset.argusEnd);
        if (
          from <= line &&
          line < end &&
          (!target ||
            from > Number(target.dataset.argusLine) ||
            (from === Number(target.dataset.argusLine) &&
              end <= Number(target.dataset.argusEnd)))
        )
          target = node;
      }
      if (!target) {
        await switchView("source");
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (
          request !== requestId.current ||
          docRef.current?.path !== result.path ||
          !sourceRef.current ||
          !readerRef.current
        )
          return;
        const height =
          Number.parseFloat(getComputedStyle(sourceRef.current).lineHeight) ||
          24;
        restoring.current = false;
        readerRef.current.scrollTop = Math.max(
          0,
          (hit.line - 1) * height - readerRef.current.clientHeight / 3,
        );
        notify(`此处为原始HTML，已定位到源码第${hit.line}行。`);
      }
      if (target) {
        for (
          let details = target.closest("details");
          details;
          details = details.parentElement?.closest("details") ?? null
        )
          details.open = true;
        target.scrollIntoView({ block: "center", behavior: "instant" });
        if (searchArrival.current) {
          clearTimeout(searchArrival.current.timer);
          searchArrival.current.cleanup();
          searchArrival.current.node.classList.remove("search-arrival");
        }
        target.classList.add("search-arrival");
        const node = target;
        const cleanup = () => {
          observer.disconnect();
          for (const event of ["wheel", "pointerdown", "touchstart", "keydown"])
            reader.removeEventListener(event, cleanup);
        };
        const observer = new ResizeObserver(() => {
          if (
            !node.isConnected ||
            request !== requestId.current ||
            docRef.current?.path !== result.path
          ) {
            cleanup();
            return;
          }
          node.scrollIntoView({ block: "center", behavior: "instant" });
        });
        if (articleRef.current) observer.observe(articleRef.current);
        for (const event of ["wheel", "pointerdown", "touchstart", "keydown"])
          reader.addEventListener(event, cleanup, { passive: true });
        searchArrival.current = {
          node,
          cleanup,
          timer: setTimeout(() => {
            cleanup();
            node.classList.remove("search-arrival");
            searchArrival.current = null;
          }, 2200),
        };
      }
    }
    reader.focus({ preventScroll: true });
    updateScroll();
  };

  const handleArticleClick = async (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>(".copy-code");
    if (copy) {
      const text =
        copy.closest(".code-block")?.querySelector("code")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = "已复制";
        setTimeout(() => {
          if (copy.isConnected) copy.textContent = "复制";
        }, 1600);
      } catch {
        setError("复制失败，请选中代码后按 ⌘ C 复制");
      }
      return;
    }
    const image = target.closest<HTMLImageElement>("img.reader-image");
    if (image && !image.closest("a")) {
      setViewedImage({ src: image.currentSrc || image.src, alt: image.alt });
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      jumpTo(href.slice(1));
      return;
    }
    if (/^(https?:|mailto:)/i.test(href)) {
      if (native) {
        try {
          await invoke("open_external", { url: href });
        } catch (e) {
          setError(String(e));
        }
      } else window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    const path = href.split(/[?#]/)[0];
    if (isMd(safeDecode(path)) && native && doc && doc.path !== GUIDE_PATH) {
      const opening = openPath(safeDecode(path), doc.path);
      const navigationRequest = requestId.current;
      const result = await opening;
      if (!result || requestId.current !== navigationRequest) return;
      const anchor = href.includes("#")
        ? href.split("#").slice(1).join("#")
        : "";
      if (anchor)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            // A link arrival belongs to the request that opened its target, even on same-path reloads.
            if (
              requestId.current === navigationRequest &&
              docRef.current?.path === result.path &&
              readerRef.current?.isConnected &&
              !editingRef.current &&
              !modalOpenRef.current
            )
              jumpTo(anchor);
          }),
        );
    } else setError("此链接不是网页或可打开的 Markdown 文档");
  };
  const openedNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const path of openedPaths)
      counts.set(documentName(path), (counts.get(documentName(path)) ?? 0) + 1);
    return counts;
  }, [openedPaths]);
  return (
    <div
      className={`app ${sidebar ? "" : "sidebar-hidden"}`}
      style={
        {
          "--reading-font-size": `${preferences.reading.fontSize}px`,
          "--reading-line-height": preferences.reading.lineHeight,
          "--reading-width": `${preferences.reading.width}px`,
        } as CSSProperties
      }
      onDragOver={(e) => {
        if (!native) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!native && !e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        if (!native) {
          e.preventDefault();
          setDragging(false);
          void openBrowserFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.markdown,.mdown,.mkd"
        hidden
        onChange={(e) => {
          void openBrowserFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <header className="toolbar" data-tauri-drag-region inert={modalOpen}>
        <div className="toolbar-leading" data-tauri-drag-region>
          <button
            className="icon-button"
            onClick={toggleSidebar}
            title="显示 / 隐藏导航（⌘ \）"
            aria-label={sidebar ? "隐藏导航" : "显示导航"}
            aria-pressed={sidebar}
          >
            <SidebarSimple size={18} weight="regular" />
          </button>
          <button
            className="icon-button navigation-back"
            aria-label="返回上一处"
            title="返回上一处（⌘ ⌥ ←）"
            disabled={!trailCount || transitioning || busy}
            onClick={() => void goBack()}
          >
            <ArrowLeft size={17} />
          </button>
          <FileMenu
            key={doc?.path ?? "empty"}
            inactive={modalOpen}
            hasCurrentDocument={Boolean(doc)}
            hasCopy={Boolean(native && doc)}
            canPrint={Boolean(native && doc)}
            hasPath={canCopyPath}
            canHistory={Boolean(
              native &&
              doc?.path.startsWith("/") &&
              !doc?.untitled &&
              !transitioning,
            )}
            canSearchAll={Boolean(
              native && openedPaths.some((path) => path.startsWith("/")),
            )}
            recent={recent.map((path) => ({
              path,
              name: documentName(path),
              location: locationLabel(path) || path,
            }))}
            onOpen={() => void chooseFile()}
            onNew={() => documentActions.current.new()}
            onQuick={() => documentActions.current.quick()}
            onSearchAll={() => documentActions.current.search()}
            onRecent={(path) => void activateDocument(path)}
            onCopy={() => void saveAsCopy()}
            onPrint={() => documentActions.current.print()}
            onReveal={() => {
              if (doc) void revealDocument(doc.path);
            }}
            onHistory={() => void showVersions()}
          />
        </div>
        <div className="toolbar-identity" data-tauri-drag-region>
          {doc ? (
            <button
              className="document-title"
              title={
                canCopyPath
                  ? `${doc.path}\n点击复制绝对路径`
                  : doc.untitled
                    ? "未命名草稿，保存后可复制文件路径"
                    : "内置或预览文档没有可复制的本地绝对路径"
              }
              aria-label="复制当前文档绝对路径"
              disabled={!canCopyPath}
              onClick={() => void copyAbsolutePath()}
            >
              <FileText size={16} weight="regular" />
              <span>{doc.name}</span>
              {canCopyPath && (
                <Copy className="title-copy-icon" size={13} weight="regular" />
              )}
            </button>
          ) : (
            <div className="document-title" data-tauri-drag-region>
              <span>Argus</span>
            </div>
          )}
        </div>
        <div className="toolbar-actions">
          {doc && !editing && (
            <DocumentModes
              view={view}
              disabled={transitioning || busy}
              onView={(next) => void switchView(next)}
            />
          )}
          {editing && (
            <button
              className="toolbar-control preview-toggle"
              aria-label="实时预览"
              aria-pressed={preferences.editorPreview.enabled}
              title="边编辑边预览，不需要先保存"
              onClick={() =>
                updatePreferences({
                  editorPreview: {
                    ...preferencesRef.current.editorPreview,
                    enabled: !preferencesRef.current.editorPreview.enabled,
                  },
                })
              }
            >
              <Columns size={17} />
              <span>预览</span>
            </button>
          )}
          <div className="toolbar-utilities" role="group" aria-label="阅读工具">
            <button
              className="toolbar-control toolbar-icon"
              aria-label="文内查找"
              title="文内查找（⌘ F）"
              disabled={!doc}
              onClick={openFind}
            >
              <MagnifyingGlass size={18} />
            </button>
            <AppearanceMenu
              theme={theme}
              onChange={selectTheme}
              reading={preferences.reading}
              onReadingChange={updateReading}
            />
          </div>
          {doc && (
            <div className="toolbar-edit-actions">
              {editing && (
                <button
                  className="toolbar-control toolbar-icon"
                  aria-label="插入图片"
                  title="插入图片"
                  disabled={transitioning}
                  onClick={() => documentActions.current.image()}
                >
                  <ImageSquare size={18} />
                </button>
              )}
              <button
                className="toolbar-control edit-action"
                aria-label={editing ? "保存" : "编辑文档"}
                title={
                  editing ? "保存并返回阅读（⌘ E）" : "编辑当前文档（⌘ E）"
                }
                disabled={
                  transitioning ||
                  busy ||
                  (!editing &&
                    !(native && doc.path !== GUIDE_PATH && !recovery))
                }
                onClick={() =>
                  void (editing ? finishEditing() : beginEditing())
                }
              >
                {editing ? <Check size={16} /> : <PencilSimple size={16} />}
                <span>{editing ? "保存" : "编辑"}</span>
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="workspace" inert={modalOpen}>
        <aside className="sidebar" aria-label="文档导航" inert={!sidebar}>
          <div className="sidebar-heading">
            {navigation === "outline" && doc ? (
              <>
                <button
                  className="icon-button"
                  onClick={() => setNavigation("files")}
                  aria-label="返回已打开文件"
                  title="返回已打开文件"
                >
                  <ArrowLeft size={17} />
                </button>
                <div className="sidebar-heading-text">
                  <span>文档大纲</span>
                  <small title={doc.path}>{doc.name}</small>
                </div>
                <span className="sidebar-count">
                  {rendered.headings.length}
                </span>
              </>
            ) : (
              <>
                <span>已打开文件</span>
                <span className="sidebar-count">{openedPaths.length}</span>
              </>
            )}
          </div>
          <div className="navigation-panel">
            {navigation === "outline" && doc ? (
              <>
                {rendered.headings.length ? (
                  <OutlineNavigation
                    key={doc.path}
                    headings={rendered.headings}
                    name={doc.name}
                    active={activeHeading}
                    onJump={jumpTo}
                  />
                ) : (
                  <div className="sidebar-empty">
                    <List size={24} weight="light" />
                    <p>这篇文档没有标题</p>
                  </div>
                )}
              </>
            ) : openedPaths.length ? (
              <nav className="opened-files" aria-label="已打开文件">
                {openedPaths.map((path) => {
                  const name = documentName(path);
                  return (
                    <div className="opened-file-entry" key={path}>
                      <div
                        className={`opened-file ${path === doc?.path ? "active" : ""}`}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setContextTarget({
                            path,
                            name,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === "ContextMenu" ||
                            (event.shiftKey && event.key === "F10")
                          ) {
                            event.preventDefault();
                            const box =
                              event.currentTarget.getBoundingClientRect();
                            setContextTarget({
                              path,
                              name,
                              x: box.left + 24,
                              y: box.bottom,
                            });
                          }
                        }}
                      >
                        <button
                          className="opened-file-main"
                          aria-haspopup="menu"
                          title={
                            path === GUIDE_PATH || isUntitledPath(path)
                              ? name
                              : path
                          }
                          aria-label={`查看 ${name}`}
                          aria-current={path === doc?.path ? "page" : undefined}
                          onClick={() => void activateDocument(path)}
                        >
                          <FileText size={17} weight="light" />
                          {editing?.path === path &&
                            saveSnapshot.text !== saveSnapshot.savedText && (
                              <span
                                className="opened-file-dirty"
                                title="有尚未保存的修改"
                              >
                                •
                              </span>
                            )}
                          <span className="opened-file-label">
                            <span>{name}</span>
                            {(openedNameCounts.get(name) ?? 0) > 1 && (
                              <small>
                                {path.split("/").slice(-3, -1).join("/")}
                              </small>
                            )}
                          </span>
                        </button>
                        <button
                          className="close-file"
                          aria-label={`关闭 ${name}`}
                          title="关闭文档（不删除文件）"
                          onClick={() => closeDocument(path)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                      {path === doc?.path && (
                        <button
                          className="sidebar-outline-link"
                          onClick={toggleOutline}
                          aria-label="查看当前文档大纲"
                          title={`${name} 的大纲`}
                        >
                          <List size={15} />
                          <span>文档大纲</span>
                          {!editing && (
                            <span className="outline-count">
                              {rendered.headings.length}
                            </span>
                          )}
                          <CaretRight size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </nav>
            ) : (
              <div className="sidebar-empty">
                <FileText size={25} weight="light" />
                <p>打开的文档会显示在这里</p>
                <button
                  className="sidebar-open-link"
                  onClick={() => void chooseFile()}
                >
                  打开文档
                </button>
              </div>
            )}
          </div>
        </aside>
        <div className="reading-column">
          {batchFailures.length > 0 && (
            <BatchNotice
              failures={batchFailures}
              onClose={() => setBatchFailures([])}
            />
          )}
          {searchOpen && !editing && doc && (
            <FindBar
              rootRef={view === "render" ? articleRef : sourceRef}
              contentKey={searchRevision}
              onClose={() => {
                setSearchOpen(false);
                readerRef.current?.focus({ preventScroll: true });
              }}
            />
          )}
          {external.notice && !editing && !doc?.unavailable && (
            <div className="external-notice" role="status">
              <WarningCircle size={18} />
              <span>
                {external.notice.status === "missing"
                  ? "原文件已移动或删除，当前内容仍可阅读。"
                  : "文件已在其他应用中修改，当前显示的是之前的内容。"}
              </span>
              {external.notice.status !== "missing" && (
                <button onClick={reload}>读取最新内容</button>
              )}
              <button
                className="icon-button"
                aria-label="稍后处理文件变化"
                onClick={external.dismiss}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <WarningCircle size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="关闭提示"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {doc?.untitled && (
            <div className="untitled-notice">
              <span>未命名草稿会自动保留在本机，保存后可选择文件位置。</span>
              {!editing && (
                <button onClick={() => documentActions.current.save()}>
                  保存到文件…
                </button>
              )}
            </div>
          )}
          {copyPreparing && (
            <div className="untitled-notice" role="status">
              <ArrowClockwise size={15} className="spin" />
              <span>正在整理 {copyPreparing} 的副本和本地图片…</span>
            </div>
          )}
          {printing && (
            <div className="untitled-notice" role="status">
              正在准备打印内容…
            </div>
          )}
          {recovery && !editing && (
            <div className="editor-notice draft-notice" role="status">
              <span>发现这篇文档的未保存草稿，可以恢复后继续编辑。</span>
              <button onClick={() => beginEditing(recovery)}>恢复草稿</button>
              <button onClick={() => setConfirmation("discard-recovery")}>
                放弃草稿
              </button>
            </div>
          )}
          {editing && (saveSnapshot.message || saveSnapshot.draftWarning) && (
            <div className="editor-notice" role="alert">
              <WarningCircle size={17} />
              <span>{saveSnapshot.message || saveSnapshot.draftWarning}</span>
              <button
                disabled={transitioning}
                onClick={() => void editingRef.current?.flush()}
              >
                重试保存
              </button>
              <button
                disabled={transitioning}
                onClick={() => void saveAsCopy()}
              >
                另存副本
              </button>
              <button
                disabled={transitioning}
                onClick={() => setConfirmation("reload")}
              >
                重新读取
              </button>
            </div>
          )}
          <main
            className={editing ? "editor-surface" : "reader"}
            ref={editing ? undefined : readerRef}
            inert={Boolean(confirmation) || transitioning}
            onScroll={updateScroll}
            tabIndex={0}
            aria-label={
              editing
                ? "Markdown 编辑区域"
                : view === "render"
                  ? "Markdown 阅读区"
                  : "只读 Markdown 源码"
            }
            aria-busy={busy}
            onKeyDown={(e) => {
              if (
                [
                  "ArrowDown",
                  "ArrowUp",
                  "PageDown",
                  "PageUp",
                  "Home",
                  "End",
                  " ",
                ].includes(e.key)
              )
                restoring.current = false;
            }}
          >
            {editing ? (
              <Suspense
                fallback={
                  <div className="editor-loading" role="status">
                    正在打开编辑器…
                  </div>
                }
              >
                <EditorWorkspace
                  path={doc!.path}
                  theme={theme}
                  preview={preferences.editorPreview}
                  onPreviewChange={(editorPreview) =>
                    updatePreferences({ editorPreview })
                  }
                  onExpand={setDiagramSource}
                  onArticleClick={(event) => void handleArticleClick(event)}
                  key={editing.sessionId}
                  content={saveSnapshot.text}
                  initialLine={editorStartLine.current}
                  resume={editorResumeRef.current}
                  onChange={(text) => editingRef.current?.update(text)}
                  onSave={() => {
                    editingActionsRef.current.save();
                  }}
                  onImage={(file) => documentActions.current.paste(file)}
                  onReady={(view) => {
                    editorViewRef.current = view;
                    if (view) editorResumeRef.current = undefined;
                  }}
                />
              </Suspense>
            ) : doc ? (
              <>
                {view === "render" ? (
                  <article
                    ref={articleRef}
                    className="markdown-body"
                    key={`${doc.path}-${loadSequence}-render`}
                    onClick={(e) => void handleArticleClick(e)}
                    onKeyDown={(event) => {
                      if (
                        (event.key === "Enter" || event.key === " ") &&
                        event.target instanceof HTMLImageElement &&
                        event.target.classList.contains("reader-image")
                      ) {
                        event.preventDefault();
                        setViewedImage({
                          src: event.target.currentSrc || event.target.src,
                          alt: event.target.alt,
                        });
                      }
                    }}
                    onLoadCapture={updateScroll}
                    onErrorCapture={(e) => {
                      if (e.target instanceof HTMLImageElement) {
                        e.target.classList.add("image-failed");
                        e.target.title =
                          "图片无法加载，请检查图片路径或网络连接";
                      }
                    }}
                    dangerouslySetInnerHTML={{ __html: rendered.html }}
                  />
                ) : (
                  <pre
                    ref={sourceRef}
                    className="source-view"
                    key={`${doc.path}-source`}
                  >
                    <code>{doc.content}</code>
                  </pre>
                )}
              </>
            ) : (
              <div className="welcome">
                <div className="welcome-symbol" aria-hidden="true">
                  <span>a</span>
                  <i />
                </div>
                <h1>
                  打开文档，
                  <br />
                  安静地读。
                </h1>
                <p>给文字一点空间，也给自己一点专注。</p>
                <button
                  className="primary-button"
                  onClick={() => void chooseFile()}
                >
                  <FolderOpen size={20} weight="light" />
                  打开 Markdown 文档<span>⌘ O</span>
                </button>
                {native && (
                  <button
                    className="guide-button"
                    onClick={() => documentActions.current.new()}
                  >
                    <FilePlus size={18} />
                    新建文档 <span>⌘ N</span>
                  </button>
                )}
                <div className="drop-hint">或将 .md 文件拖到此处</div>
                <button
                  className="guide-button"
                  onClick={() => void showGuide()}
                >
                  先读一读阅读指南
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </main>
          <footer className="statusbar">
            <div>
              {doc ? (
                <>
                  <span className="status-dot" />
                  <span>
                    {editing
                      ? "编辑模式"
                      : view === "source"
                        ? "只读源码"
                        : "阅读模式"}
                  </span>
                  <span className="status-separator">·</span>
                  <span>
                    {editing
                      ? `${saveSnapshot.text.length.toLocaleString()} 字符`
                      : `${rendered.words.toLocaleString()} 字`}
                  </span>
                  <span className="status-separator">·</span>
                  <span>
                    {editing
                      ? `${saveSnapshot.text.split("\n").length} 行`
                      : `约 ${rendered.minutes} 分钟`}
                  </span>
                </>
              ) : (
                <>
                  <span className="status-dot" />
                  <span>准备好，开始阅读</span>
                </>
              )}
            </div>
            <div>
              {editing ? (
                <>
                  <span
                    className="save-status"
                    data-state={imagePending ? "saving" : saveSnapshot.status}
                    role="status"
                    aria-label="保存状态"
                  >
                    {imagePending || saveSnapshot.status === "saving" ? (
                      <ArrowClockwise size={14} className="spin" />
                    ) : saveSnapshot.status === "saved" ? (
                      <Check size={14} />
                    ) : saveSnapshot.status === "error" ||
                      saveSnapshot.status === "conflict" ? (
                      <WarningCircle size={15} />
                    ) : (
                      <span className="status-dot" />
                    )}
                    <span className="save-status-text">
                      {imagePending
                        ? "正在插入图片…"
                        : saveSnapshot.status === "saved"
                          ? doc?.untitled
                            ? "草稿已保存"
                            : "已自动保存"
                          : saveSnapshot.status === "saving"
                            ? "保存中…"
                            : saveSnapshot.status === "conflict"
                              ? "文件有冲突"
                              : saveSnapshot.status === "error"
                                ? "保存失败"
                                : "待保存"}
                    </span>
                  </span>
                  <span className="save-key-hint">⌘ S 保存</span>
                </>
              ) : busy ? (
                <span className="loading-label">
                  <ArrowClockwise size={14} className="spin" />
                  正在打开…
                </span>
              ) : doc ? (
                <>
                  <button
                    className="reload-button"
                    onClick={reload}
                    title="重新读取文件（⌘ R）"
                    aria-label="重新读取文件"
                  >
                    <ArrowClockwise size={14} />
                  </button>
                  <span className="progress-label">{progress}%</span>
                  <div className="progress-track">
                    <div style={{ width: `${progress}%` }} />
                  </div>
                </>
              ) : (
                <span>UTF-8 · Markdown</span>
              )}
            </div>
          </footer>
        </div>
      </div>
      {dragging && (
        <div className="drop-overlay">
          <div>
            <FolderOpen size={48} weight="light" />
            <h2>在这里打开文档</h2>
            <p>松开鼠标，开始阅读 Markdown</p>
          </div>
        </div>
      )}
      {printHtml && (
        <article
          className="print-document markdown-body"
          dangerouslySetInnerHTML={{ __html: printHtml }}
        />
      )}
      {documentSearchOpen && (
        <DocumentSearch
          paths={openedPaths.filter((p) => p.startsWith("/"))}
          buffer={
            doc?.path.startsWith("/")
              ? {
                  path: doc.path,
                  text: editing?.snapshot.text ?? doc.content,
                  version: editing?.snapshot.version ?? doc.version ?? "",
                }
              : undefined
          }
          onClose={() => {
            setDocumentSearchOpen(false);
            requestAnimationFrame(() => {
              // Respect a new focus target chosen after the dialog closed.
              if (
                document.activeElement !== document.body &&
                document.activeElement?.isConnected
              )
                return;
              if (editingRef.current) editorViewRef.current?.focus();
              else readerRef.current?.focus({ preventScroll: true });
            });
          }}
          onChoose={(hit) => void locateSearchHit(hit)}
        />
      )}
      {quickOpen && (
        <QuickSwitcher
          paths={[...openedPaths, ...recent, ...localDrafts].filter(
            (p) => p !== GUIDE_PATH,
          )}
          current={doc?.path}
          onClose={() => setQuickOpen(false)}
          onChoose={(path) => {
            setQuickOpen(false);
            void activateDocument(path);
          }}
        />
      )}
      {diagramSource !== null && (
        <MermaidViewer
          source={diagramSource}
          theme={theme}
          onClose={() => setDiagramSource(null)}
        />
      )}
      {confirmation && (
        <ConfirmationDialog
          title={
            confirmation === "reload"
              ? "放弃未保存内容并重新读取？"
              : "放弃这份未保存草稿？"
          }
          description={
            confirmation === "reload"
              ? "将结束编辑并读取磁盘中的最新文件。尚未保存的内容会被放弃，已自动保存的内容不会撤回。"
              : "磁盘原文件不会改动。这份本机草稿将被移除。"
          }
          label={confirmation === "reload" ? "放弃并重新读取" : "放弃草稿"}
          busy={transitioning}
          onCancel={() => {
            setConfirmation(null);
            requestAnimationFrame(() => editorViewRef.current?.focus());
          }}
          onConfirm={() => void confirmReload()}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {viewedImage && (
        <ImageViewer image={viewedImage} onClose={() => setViewedImage(null)} />
      )}
      {contextTarget && !modalOpen && (
        <FileContextMenu
          target={contextTarget}
          onClose={closeContextMenu}
          onReveal={() => void revealDocument(contextTarget.path)}
          onCopy={() => void copyPath(contextTarget.path)}
          onCloseOthers={() => void closeOtherDocuments(contextTarget.path)}
          canCloseOthers={openedPaths.length > 1}
        />
      )}
      {readonlyPrompt && (
        <ReadOnlyDialog
          name={readonlyPrompt.name}
          unavailable={readonlyPrompt.unavailable}
          onCancel={() => setReadonlyPrompt(null)}
          onCopy={() => {
            const source = readonlyPrompt;
            setReadonlyPrompt(null);
            void saveAsCopy(true, source);
          }}
        />
      )}
      {versionsOpen && doc && (
        <HistoryDialog
          path={doc.path}
          name={doc.name}
          version={doc.version ?? ""}
          currentContent={doc.content}
          onClose={() => setVersionsOpen(false)}
          onBusyChange={(busy) => {
            historyBusy.current = busy;
            if (!busy) drainExternalFiles.current();
          }}
          onRestored={async () => {
            setVersionsOpen(false);
            await openPath(doc.path, undefined, true);
            notify("已恢复历史版本，恢复前的内容也已保留。");
          }}
        />
      )}
    </div>
  );
}
