// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useRef } from "react";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import type { Draft } from "./autoSave";
const test = vi.hoisted(() => ({
  invoke: vi.fn(),
  analyze: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  handlers: new Map<string, (e: { payload: unknown }) => void>(),
  files: new Map<
    string,
    { content: string; version: string; untitled?: boolean }
  >(),
  drafts: new Map<string, Draft>(),
  fail: false,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: test.invoke,
  convertFileSrc: (s: string) => `asset://localhost${s}`,
}));
vi.mock("../documents/copy/analyze", () => ({ analyzeCopy: test.analyze }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: test.open,
  save: test.save,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (e: { payload: unknown }) => void) => {
    test.handlers.set(name, handler);
    return () => test.handlers.delete(name);
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: async () => {} }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ onDragDropEvent: async () => () => {} }),
}));
// CodeMirror itself is checked in the native app; this harness isolates save/navigation behavior.
vi.mock("./MarkdownEditor", () => ({
  default: ({
    content,
    onChange,
    onReady,
    onImage,
  }: {
    content: string;
    onChange(text: string): void;
    onReady?(view: MarkdownEditorHandle | null): void;
    onImage?(file: File): void;
  }) => {
    const node = useRef<HTMLTextAreaElement>(null);
    const callbacks = useRef({ onChange, onReady, onImage });
    callbacks.current = { onChange, onReady, onImage };
    useEffect(() => {
      callbacks.current.onReady?.({
        focus: () => node.current?.focus(),
        jumpToLine: () => {},
        find: () => {},
        insert: (text) => {
          if (node.current) {
            node.current.value += text;
            callbacks.current.onChange(node.current.value);
          }
        },
      });
      return () => callbacks.current.onReady?.(null);
    }, []);
    return (
      <textarea
        ref={node}
        aria-label="Markdown 编辑器"
        defaultValue={content}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files)[0];
          if (file) {
            e.preventDefault();
            onImage?.(file);
          }
        }}
      />
    );
  },
}));
beforeEach(() => {
  localStorage.clear();
  test.invoke.mockReset();
  test.analyze.mockReset();
  test.analyze.mockResolvedValue([]);
  test.open.mockReset();
  test.save.mockReset();
  test.handlers.clear();
  test.files.clear();
  test.drafts.clear();
  test.fail = false;
  test.files.set("/notes/edit.md", {
    content: "# 原文\n\n正文",
    version: "v1",
  });
  test.files.set("/notes/next.md", { content: "# 下一篇", version: "n1" });
  test.open.mockResolvedValue("/notes/edit.md");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "take_pending_files") return [];
      if (cmd === "new_document") {
        const path =
          "/Users/test/Library/Application Support/app.argus.reader/untitled/未命名 1.md";
        const file = { content: "", version: "empty", untitled: true };
        test.files.set(path, file);
        return { ...file, path, name: "未命名 1.md", draft: null };
      }
      if (cmd === "remove_untitled") {
        test.files.delete(String(args.path));
        return;
      }
      if (cmd === "insert_image") return "assets/unique.png";
      if (cmd === "read_document") {
        const file = test.files.get(String(args.path));
        if (!file) throw "文件不存在";
        return {
          ...file,
          path: args.path,
          name: String(args.path).split("/").pop(),
          draft: test.drafts.get(String(args.path)) ?? null,
        };
      }
      if (cmd === "write_draft") {
        const draft = args.draft as Draft;
        test.drafts.set(draft.path, { ...draft });
        return;
      }
      if (cmd === "clear_draft") {
        const draft = test.drafts.get(String(args.path));
        if (
          draft &&
          draft.sessionId === args.sessionId &&
          draft.revision <= Number(args.revision)
        )
          test.drafts.delete(String(args.path));
        return;
      }
      if (cmd === "save_document") {
        const draft = args.draft as Draft;
        test.drafts.set(draft.path, { ...draft });
        const file = test.files.get(draft.path)!;
        if (test.fail)
          throw { code: "permission", message: "文件只读，编辑内容已保留" };
        if (file.version !== draft.baseVersion)
          throw { code: "conflict", message: "文件已被其他程序修改" };
        file.content = draft.text;
        file.version += "+";
        return { version: file.version };
      }
      if (cmd === "save_copy") {
        test.files.set(String(args.path), {
          content: String(args.content),
          version: "copy-v1",
        });
        return { version: "copy-v1" };
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function openFileFromMenu() {
  fireEvent.click(screen.getByRole("button", { name: "文件" }));
  fireEvent.click(screen.getByTitle("打开文档（⌘ O）"));
}

async function openEditor() {
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "原文" });
  fireEvent.click(screen.getByLabelText("编辑文档"));
  return (await screen.findByLabelText(
    "Markdown 编辑器",
  )) as HTMLTextAreaElement;
}

describe("编辑与自动保存的用户流程", () => {
  it("默认阅读，修改后自动写盘，完成后展示保存的新内容", async () => {
    const editor = await openEditor();
    fireEvent.change(editor, { target: { value: "# 已修改\n\n新正文" } });
    await waitFor(
      () =>
        expect(test.files.get("/notes/edit.md")?.content).toContain("# 已修改"),
      { timeout: 3000 },
    );
    expect(screen.getByLabelText("保存状态").textContent).toContain(
      "已自动保存",
    );
    expect(screen.queryByRole("button", { name: "立即保存" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("heading", { name: "已修改" });
    expect(screen.queryByLabelText("Markdown 编辑器")).toBeNull();
  });
  it("保存失败时关闭和退出都被阻止，内容及草稿保留", async () => {
    const editor = await openEditor();
    test.fail = true;
    fireEvent.change(editor, { target: { value: "# 不能丢失" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭 edit.md" }));
    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
    ).toBe("# 不能丢失");
    expect(test.drafts.get("/notes/edit.md")?.text).toBe("# 不能丢失");
    act(() => test.handlers.get("app-action")!({ payload: "quit" }));
    await waitFor(() =>
      expect(
        screen.getByText("尚有内容未保存，请先处理保存提示。"),
      ).toBeTruthy(),
    );
    expect(
      test.invoke.mock.calls.some(([cmd]) => cmd === "finish_window_action"),
    ).toBe(false);
    expect(test.files.get("/notes/edit.md")?.content).toContain("# 原文");
  });
  it("切换文件前先保存，保存失败则继续停留在编辑器", async () => {
    const editor = await openEditor();
    test.fail = true;
    fireEvent.change(editor, { target: { value: "# 修改" } });
    test.open.mockResolvedValue("/notes/next.md");
    openFileFromMenu();
    await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: "下一篇" })).toBeNull();
    test.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() =>
      expect(test.files.get("/notes/edit.md")?.content).toBe("# 修改"),
    );
    openFileFromMenu();
    await screen.findByRole("heading", { name: "下一篇" });
  });
  it("外部修改产生冲突，另存副本保留原文件和编辑内容", async () => {
    const editor = await openEditor();
    test.files.set("/notes/edit.md", {
      content: "# 外部版本",
      version: "external",
    });
    fireEvent.change(editor, { target: { value: "# 我的版本" } });
    act(() => test.handlers.get("menu-action")!({ payload: "save" }));
    await screen.findByRole("alert");
    expect(test.files.get("/notes/edit.md")?.content).toBe("# 外部版本");
    test.save.mockResolvedValue("/notes/copy.md");
    fireEvent.click(screen.getByText("另存副本"));
    await screen.findByRole("heading", { name: "我的版本" });
    expect(test.files.get("/notes/copy.md")?.content).toBe("# 我的版本");
    expect(test.files.get("/notes/edit.md")?.content).toBe("# 外部版本");
  });
  it("重新打开时能恢复未保存草稿，恢复不直接覆盖外部版本", async () => {
    test.drafts.set("/notes/edit.md", {
      path: "/notes/edit.md",
      text: "# 恢复内容",
      baseVersion: "old-version",
      sessionId: "previous",
      revision: 4,
    });
    render(<App />);
    openFileFromMenu();
    await screen.findByText("恢复草稿");
    expect(test.files.get("/notes/edit.md")?.content).toContain("# 原文");
    fireEvent.click(screen.getByText("恢复草稿"));
    expect(
      ((await screen.findByLabelText("Markdown 编辑器")) as HTMLTextAreaElement)
        .value,
    ).toBe("# 恢复内容");
    act(() => test.handlers.get("menu-action")!({ payload: "save" }));
    await screen.findByRole("alert");
    expect(test.files.get("/notes/edit.md")?.content).toContain("# 原文");
  });
  it("显式放弃未保存内容后读取外部版本，不触发覆盖", async () => {
    const editor = await openEditor();
    test.files.set("/notes/edit.md", {
      content: "# 外部版本",
      version: "external",
    });
    fireEvent.change(editor, { target: { value: "# 我的版本" } });
    act(() => test.handlers.get("menu-action")!({ payload: "save" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByText("重新读取"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByText("放弃并重新读取"));
    await screen.findByRole("heading", { name: "外部版本" });
    expect(test.drafts.has("/notes/edit.md")).toBe(false);
  });
});

describe("副本与只读文件保护", () => {
  it("正常阅读可另存副本，取消时保留当前文档", async () => {
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "原文" });
    test.save.mockResolvedValueOnce(null);
    act(() => test.handlers.get("menu-action")!({ payload: "save-copy" }));
    await waitFor(() => expect(test.save).toHaveBeenCalledOnce());
    expect(test.invoke.mock.calls.some(([cmd]) => cmd === "save_copy")).toBe(
      false,
    );
    test.save.mockResolvedValue("/notes/read-copy.md");
    act(() => test.handlers.get("menu-action")!({ payload: "save-copy" }));
    await screen.findByRole("button", { name: "查看 read-copy.md" });
    expect(test.files.get("/notes/read-copy.md")?.content).toBe(
      "# 原文\n\n正文",
    );
    expect(test.files.get("/notes/edit.md")?.content).toBe("# 原文\n\n正文");
  });
  it("正常编辑另存使用当前缓冲区，副本失败时保留输入", async () => {
    const editor = await openEditor();
    fireEvent.change(editor, { target: { value: "# 尚未自动写入的副本" } });
    test.save.mockResolvedValue("/notes/live-copy.md");
    const original = test.invoke.getMockImplementation()!;
    let fail = true;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "save_copy" && fail)
          throw {
            code: "exists",
            message: "副本文件名已存在，请换一个文件名。",
          };
        return original(cmd, args);
      },
    );
    act(() => test.handlers.get("menu-action")!({ payload: "save-copy" }));
    await screen.findByText("副本文件名已存在，请换一个文件名。");
    expect(
      (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
    ).toBe("# 尚未自动写入的副本");
    fail = false;
    act(() => test.handlers.get("menu-action")!({ payload: "save-copy" }));
    await screen.findByRole("button", { name: "查看 live-copy.md" });
    expect(test.files.get("/notes/live-copy.md")?.content).toBe(
      "# 尚未自动写入的副本",
    );
    expect(screen.queryByText("原文件未被覆盖")).toBeNull();
  });
  it("进入编辑前发现只读，取消继续阅读，另存成功后进入副本编辑", async () => {
    const original = test.invoke.getMockImplementation()!;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "probe_document")
          return {
            status: "unchanged",
            version: "v1",
            writable: args.path !== "/notes/edit.md",
          };
        return original(cmd, args);
      },
    );
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "原文" });
    fireEvent.click(screen.getByLabelText("编辑文档"));
    await screen.findByRole("dialog", { name: "这份文档目前无法直接编辑" });
    expect(screen.queryByLabelText("Markdown 编辑器")).toBeNull();
    expect(
      test.invoke.mock.calls.some(([cmd]) => cmd === "begin_edit_session"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "继续阅读" }));
    expect(screen.getByRole("heading", { name: "原文" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("编辑文档"));
    await screen.findByRole("dialog");
    test.save.mockResolvedValue("/notes/writable-copy.md");
    fireEvent.click(screen.getByRole("button", { name: "另存副本并编辑" }));
    const editor = await screen.findByLabelText("Markdown 编辑器");
    expect((editor as HTMLTextAreaElement).value).toBe("# 原文\n\n正文");
    expect(test.files.get("/notes/edit.md")?.content).toBe("# 原文\n\n正文");
    expect(test.invoke).toHaveBeenCalledWith(
      "begin_edit_session",
      expect.objectContaining({ path: "/notes/writable-copy.md" }),
    );
  });
  it("关闭其他文档时遇当前保存失败，不移除文件或丢失输入", async () => {
    test.open.mockResolvedValue(["/notes/edit.md", "/notes/next.md"]);
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "下一篇" });
    fireEvent.click(screen.getByRole("button", { name: "查看 edit.md" }));
    await screen.findByRole("heading", { name: "原文" });
    fireEvent.click(screen.getByLabelText("编辑文档"));
    const editor = await screen.findByLabelText("Markdown 编辑器");
    test.fail = true;
    fireEvent.change(editor, { target: { value: "# 保留输入" } });
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "查看 next.md" }),
      { clientX: 30, clientY: 100 },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "关闭其他文档" }));
    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
    ).toBe("# 保留输入");
    expect(screen.getByRole("button", { name: "查看 next.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 edit.md" })).toBeTruthy();
  });
});

it("另存对话框期间换了文档，旧结果不能复制或替换新文档", async () => {
  let resolve!: (value: string) => void;
  test.save.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "原文" });
  act(() => test.handlers.get("menu-action")!({ payload: "save-copy" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  test.open.mockResolvedValue("/notes/next.md");
  openFileFromMenu();
  await screen.findByRole("heading", { name: "下一篇" });
  await act(async () => resolve("/notes/stale-copy.md"));
  expect(test.invoke.mock.calls.some(([cmd]) => cmd === "save_copy")).toBe(
    false,
  );
  expect(screen.getByRole("heading", { name: "下一篇" })).toBeTruthy();
});

it("只读文件恢复草稿时另存，副本包含草稿而不是磁盘旧内容", async () => {
  test.drafts.set("/notes/edit.md", {
    path: "/notes/edit.md",
    text: "# 草稿中的内容",
    baseVersion: "old",
    sessionId: "old-session",
    revision: 4,
  });
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) =>
      cmd === "probe_document"
        ? {
            status: "unchanged",
            writable: args.path !== "/notes/edit.md",
            version: "v1",
          }
        : original(cmd, args),
  );
  render(<App />);
  openFileFromMenu();
  await screen.findByText("恢复草稿");
  fireEvent.click(screen.getByText("恢复草稿"));
  await screen.findByRole("dialog");
  test.save.mockResolvedValue("/notes/recovered-copy.md");
  fireEvent.click(screen.getByRole("button", { name: "另存副本并编辑" }));
  const editor = await screen.findByLabelText("Markdown 编辑器");
  expect((editor as HTMLTextAreaElement).value).toBe("# 草稿中的内容");
  expect(test.files.get("/notes/recovered-copy.md")?.content).toBe(
    "# 草稿中的内容",
  );
  expect(test.files.get("/notes/edit.md")?.content).toBe("# 原文\n\n正文");
});
it("预检查后权限再次变化，原生编辑会话拒绝仍显示只读流程", async () => {
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "probe_document")
        return { status: "unchanged", writable: true, version: "v1" };
      if (cmd === "begin_edit_session")
        throw { code: "readonly", message: "权限已变化" };
      return original(cmd, args);
    },
  );
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "原文" });
  fireEvent.click(screen.getByLabelText("编辑文档"));
  await screen.findByRole("dialog", { name: "这份文档目前无法直接编辑" });
  expect(screen.queryByLabelText("Markdown 编辑器")).toBeNull();
  expect(test.files.get("/notes/edit.md")?.content).toBe("# 原文\n\n正文");
});

describe("0.7.1 草稿与另存失败保护", () => {
  it("菜单快捷键不能绕过待恢复草稿，明确恢复后仍可编辑", async () => {
    const draft: Draft = {
      path: "/notes/edit.md",
      text: "# 不能丢的草稿",
      baseVersion: "old",
      sessionId: "previous",
      revision: 4,
    };
    test.drafts.set(draft.path, draft);
    render(<App />);
    openFileFromMenu();
    await screen.findByText("恢复草稿");
    expect(
      (screen.getByLabelText("编辑文档") as HTMLButtonElement).disabled,
    ).toBe(true);
    act(() => test.handlers.get("menu-action")!({ payload: "edit" }));
    await screen.findByText("请先恢复或放弃未保存草稿，再进入编辑。");
    expect(
      test.invoke.mock.calls.some(
        ([cmd]) => cmd === "begin_edit_session" || cmd === "write_draft",
      ),
    ).toBe(false);
    expect(test.drafts.get(draft.path)).toEqual(draft);
    expect(screen.queryByLabelText("Markdown 编辑器")).toBeNull();
    fireEvent.click(screen.getByText("恢复草稿"));
    expect(
      ((await screen.findByLabelText("Markdown 编辑器")) as HTMLTextAreaElement)
        .value,
    ).toBe(draft.text);
    expect(test.invoke).toHaveBeenCalledWith(
      "begin_edit_session",
      expect.objectContaining({ recovery: draft }),
    );
  });
  it("明确放弃草稿后菜单可进入普通编辑", async () => {
    test.drafts.set("/notes/edit.md", {
      path: "/notes/edit.md",
      text: "# 旧草稿",
      baseVersion: "v1",
      sessionId: "old",
      revision: 3,
    });
    render(<App />);
    openFileFromMenu();
    await screen.findByText("恢复草稿");
    fireEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "放弃草稿",
      }),
    );
    await waitFor(() => expect(screen.queryByText("恢复草稿")).toBeNull());
    act(() => test.handlers.get("menu-action")!({ payload: "edit" }));
    expect(
      ((await screen.findByLabelText("Markdown 编辑器")) as HTMLTextAreaElement)
        .value,
    ).toBe("# 原文\n\n正文");
  });
  it("副本写入后读取失败保留输入与草稿，重试可以成功切换", async () => {
    const editor = await openEditor();
    test.fail = true;
    fireEvent.change(editor, { target: { value: "# 本地重要输入" } });
    test.save.mockResolvedValue("/notes/rescue.md");
    const original = test.invoke.getMockImplementation()!;
    let failRead = true;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (
          cmd === "read_document" &&
          args.path === "/notes/rescue.md" &&
          failRead
        )
          throw "副本无法访问";
        return original(cmd, args);
      },
    );
    act(() => test.handlers.get("menu-action")!({ payload: "save-copy" }));
    await screen.findByText(/副本无法访问/);
    expect(
      (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
    ).toBe("# 本地重要输入");
    expect(screen.getByRole("alert").textContent).toContain("/notes/rescue.md");
    await waitFor(() =>
      expect(test.drafts.get("/notes/edit.md")?.text).toBe("# 本地重要输入"),
    );
    expect(test.files.get("/notes/edit.md")?.content).toBe("# 原文\n\n正文");
    failRead = false;
    test.save.mockResolvedValue("/notes/retry.md");
    act(() => test.handlers.get("menu-action")!({ payload: "save-copy" }));
    await screen.findByRole("heading", { name: "本地重要输入" });
    expect(screen.queryByLabelText("Markdown 编辑器")).toBeNull();
    expect(test.files.get("/notes/retry.md")?.content).toBe("# 本地重要输入");
  });
  it("副本写入后被外部改动，不清理原输入或切换到变化后的副本", async () => {
    const editor = await openEditor();
    test.fail = true;
    fireEvent.change(editor, { target: { value: "# 保留这一版" } });
    test.save.mockResolvedValue("/notes/copy.md");
    const original = test.invoke.getMockImplementation()!;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "read_document" && args.path === "/notes/copy.md")
          return {
            path: args.path,
            name: "copy.md",
            content: "# 外部替换",
            version: "changed",
            draft: null,
          };
        return original(cmd, args);
      },
    );
    act(() => test.handlers.get("menu-action")!({ payload: "save-copy" }));
    await screen.findByText(/副本内容已经变化/);
    expect(
      (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
    ).toBe("# 保留这一版");
    expect(screen.queryByRole("heading", { name: "外部替换" })).toBeNull();
    await waitFor(() =>
      expect(test.drafts.get("/notes/edit.md")?.text).toBe("# 保留这一版"),
    );
  });
  it("等待副本读取时切换文档，迟到副本不能抢回当前文档", async () => {
    const editor = await openEditor();
    fireEvent.change(editor, { target: { value: "# 副本缓冲" } });
    test.save.mockResolvedValue("/notes/copy.md");
    const original = test.invoke.getMockImplementation()!;
    let resolve!: (result: unknown) => void;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "read_document" && args.path === "/notes/copy.md")
          return new Promise((r) => {
            resolve = r;
          });
        return original(cmd, args);
      },
    );
    act(() => test.handlers.get("menu-action")!({ payload: "save-copy" }));
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    test.open.mockResolvedValue("/notes/next.md");
    act(() => test.handlers.get("menu-action")!({ payload: "open" }));
    await screen.findByRole("heading", { name: "下一篇" });
    await act(async () =>
      resolve({
        path: "/notes/copy.md",
        name: "copy.md",
        content: "# 副本缓冲",
        version: "copy-v1",
        draft: null,
      }),
    );
    expect(screen.getByRole("heading", { name: "下一篇" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "副本缓冲" })).toBeNull();
  });
});

describe("六项新功能的编辑流程", () => {
  it("新建后直接编辑，先保留本机草稿，取消首次保存保留输入，保存后继续编辑", async () => {
    render(<App />);
    act(() => test.handlers.get("menu-action")?.({ payload: "new" }));
    const editor = await screen.findByLabelText("Markdown 编辑器");
    fireEvent.change(editor, { target: { value: "# 新建内容" } });
    await waitFor(
      () =>
        expect(
          test.files.get(
            "/Users/test/Library/Application Support/app.argus.reader/untitled/未命名 1.md",
          )?.content,
        ).toBe("# 新建内容"),
      { timeout: 3000 },
    );
    expect(screen.getByLabelText("保存状态").textContent).toContain(
      "草稿已保存",
    );
    test.save.mockResolvedValue(null);
    act(() => test.handlers.get("menu-action")?.({ payload: "save" }));
    await waitFor(() => expect(test.save).toHaveBeenCalled());
    expect(
      (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
    ).toBe("# 新建内容");
    test.save.mockResolvedValue("/notes/created.md");
    act(() => test.handlers.get("menu-action")?.({ payload: "save" }));
    await screen.findByRole("button", { name: "查看 created.md" });
    await screen.findByLabelText("Markdown 编辑器");
    expect(test.files.get("/notes/created.md")?.content).toBe("# 新建内容");
    expect(test.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "保存 Markdown 文档",
        defaultPath: "未命名 1.md",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "查看 未命名 1.md" }),
    ).toBeNull();
  });
  it("未命名文档关闭应用后重新读取仍能找回内容", async () => {
    const first = render(<App />);
    act(() => test.handlers.get("menu-action")?.({ payload: "new" }));
    fireEvent.change(await screen.findByLabelText("Markdown 编辑器"), {
      target: { value: "# 重启后保留" },
    });
    act(() => test.handlers.get("app-action")?.({ payload: "quit" }));
    await waitFor(() =>
      expect(test.invoke).toHaveBeenCalledWith("finish_window_action", {
        action: "quit",
      }),
    );
    first.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: "重启后保留" });
    expect(screen.getByText(/未命名草稿会自动保留/)).toBeTruthy();
  });
  it("图片插入写入相对链接，失败不更改原输入", async () => {
    const editor = await openEditor();
    fireEvent.change(editor, { target: { value: "# 正文" } });
    test.open.mockResolvedValue("/images/picture.png");
    fireEvent.click(screen.getByRole("button", { name: "插入图片" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
      ).toContain("\n![图片](assets/unique.png)\n"),
    );
    const before = (
      screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement
    ).value;
    const original = test.invoke.getMockImplementation()!;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "insert_image") throw "图片目录不可写";
        return original(cmd, args);
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "插入图片" }));
    await screen.findByText("图片目录不可写");
    expect(
      (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
    ).toBe(before);
  });
  it("粘贴截图通过编辑器事件处理，不触发打开Markdown", async () => {
    const editor = await openEditor();
    test.open.mockClear();
    const file = new File(["image"], "image.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    });
    fireEvent.paste(editor, { clipboardData: { files: [file] } });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
      ).toContain("![图片](assets/unique.png)"),
    );
    expect(test.open).not.toHaveBeenCalled();
    expect(test.invoke).toHaveBeenCalledWith(
      "insert_image",
      expect.objectContaining({
        path: "/notes/edit.md",
        bytes: [137, 80, 78, 71],
        source: null,
      }),
    );
  });
  it("快速切换搜索目标并保存当前编辑，保存失败仍保留输入", async () => {
    test.open.mockResolvedValue(["/notes/next.md", "/notes/edit.md"]);
    const editor = await openEditor();
    test.fail = true;
    fireEvent.change(editor, { target: { value: "# 不能丢失的编辑" } });
    act(() => test.handlers.get("menu-action")?.({ payload: "quick-switch" }));
    const input = await screen.findByLabelText("搜索文档");
    fireEvent.change(input, { target: { value: "next" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
    ).toBe("# 不能丢失的编辑");
    expect(screen.queryByRole("heading", { name: "下一篇" })).toBeNull();
  });
  it("打印使用当前编辑内容，不退出编辑或把源码编辑器送入打印", async () => {
    const editor = await openEditor();
    fireEvent.change(editor, { target: { value: "# 打印标题\n\n打印正文" } });
    const original = test.invoke.getMockImplementation()!;
    let printed = "";
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "print_document") {
          printed =
            document.querySelector(".print-document")?.textContent ?? "";
          return;
        }
        return original(cmd, args);
      },
    );
    act(() =>
      test.handlers.get("menu-action")?.({ payload: "print-document" }),
    );
    await waitFor(() => expect(printed).toContain("打印正文"));
    expect(printed).toContain("打印标题");
    expect(screen.getByLabelText("Markdown 编辑器")).toBeTruthy();
    expect(document.querySelector(".print-document")?.textContent).toContain(
      "打印正文",
    );
  });
});

it("保存新插入图片前先授权，重新读取同一正文也会重建失败图片", async () => {
  const editor = await openEditor();
  fireEvent.change(editor, {
    target: { value: "# 原文\n\n![图片](assets/new.png)" },
  });
  test.invoke.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByRole("heading", { name: "原文" });
  const calls = test.invoke.mock.calls.map(([cmd]) => cmd);
  expect(calls.indexOf("authorize_images")).toBeGreaterThanOrEqual(0);
  expect(calls.indexOf("authorize_images")).toBeLessThan(
    calls.indexOf("read_document"),
  );
  const image = screen.getByRole("button", { name: "放大图片：图片" });
  fireEvent.error(image);
  expect(image.classList.contains("image-failed")).toBe(true);
  act(() => test.handlers.get("menu-action")?.({ payload: "reload" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "放大图片：图片" })).not.toBe(
      image,
    ),
  );
  expect(
    screen
      .getByRole("button", { name: "放大图片：图片" })
      .classList.contains("image-failed"),
  ).toBe(false);
});
it("快速切换可以找回不在最近列表中的本机未命名草稿", async () => {
  const path =
    "/Users/test/Library/Application Support/app.argus.reader/untitled/未命名 99.md";
  test.files.set(path, {
    content: "# 旧草稿仍在",
    version: "draft-99",
    untitled: true,
  });
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) =>
      cmd === "list_untitled" ? [path] : original(cmd, args),
  );
  render(<App />);
  act(() => test.handlers.get("menu-action")?.({ payload: "quick-switch" }));
  const option = await screen.findByRole("option", { name: /未命名 99.md/ });
  fireEvent.click(option);
  await screen.findByRole("heading", { name: "旧草稿仍在" });
});

describe("0.8.1 首次保存与图片来源保护", () => {
  it("待恢复未命名草稿阻止所有首次保存入口，明确恢复后可完整保存", async () => {
    const path =
      "/Users/test/Library/Application Support/app.argus.reader/untitled/未命名 1.md";
    const draft: Draft = {
      path,
      text: "# 待恢复的重要内容",
      baseVersion: "old",
      sessionId: "previous",
      revision: 5,
    };
    test.files.set(path, {
      content: "# 已落盘旧草稿",
      version: "old",
      untitled: true,
    });
    test.drafts.set(path, draft);
    test.open.mockResolvedValue(path);
    render(<App />);
    openFileFromMenu();
    await screen.findByText("恢复草稿");
    for (const payload of ["save", "save-copy"])
      act(() => test.handlers.get("menu-action")?.({ payload }));
    fireEvent.click(screen.getByRole("button", { name: "保存到文件…" }));
    await screen.findByText("请先恢复或放弃未保存草稿，再保存到文件。");
    expect(test.save).not.toHaveBeenCalled();
    expect(
      test.invoke.mock.calls.some(
        ([cmd]) => cmd === "remove_untitled" || cmd === "save_copy",
      ),
    ).toBe(false);
    expect(test.files.has(path)).toBe(true);
    expect(test.drafts.get(path)).toEqual(draft);
    fireEvent.click(screen.getByText("恢复草稿"));
    expect(
      ((await screen.findByLabelText("Markdown 编辑器")) as HTMLTextAreaElement)
        .value,
    ).toBe(draft.text);
    test.save.mockResolvedValue("/notes/recovered.md");
    act(() => test.handlers.get("menu-action")?.({ payload: "save" }));
    await screen.findByRole("button", { name: "查看 recovered.md" });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "查看 未命名 1.md" }),
      ).toBeNull(),
    );
    expect(test.files.get("/notes/recovered.md")?.content).toBe(draft.text);
  });
  it("第一次保存目标延迟返回时切换编辑文档，旧图片不得写入新文档", async () => {
    test.save.mockResolvedValue("/notes/source-export.md");
    let resolve!: (v: unknown) => void;
    const original = test.invoke.getMockImplementation()!;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "read_document" && args.path === "/notes/source-export.md")
          return new Promise((r) => {
            resolve = r;
          });
        return original(cmd, args);
      },
    );
    render(<App />);
    act(() => test.handlers.get("menu-action")?.({ payload: "new" }));
    fireEvent.change(await screen.findByLabelText("Markdown 编辑器"), {
      target: { value: "# 来源草稿" },
    });
    const file = new File(["image"], "image.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    });
    fireEvent.paste(screen.getByLabelText("Markdown 编辑器"), {
      clipboardData: { files: [file] },
    });
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    test.open.mockResolvedValue("/notes/next.md");
    act(() => test.handlers.get("menu-action")?.({ payload: "open" }));
    await screen.findByRole("heading", { name: "下一篇" });
    act(() => test.handlers.get("menu-action")?.({ payload: "edit" }));
    const editor = await screen.findByLabelText("Markdown 编辑器");
    const copied = await original("read_document", {
      path: "/notes/source-export.md",
    });
    await act(async () => resolve(copied));
    expect(test.invoke.mock.calls.some(([cmd]) => cmd === "insert_image")).toBe(
      false,
    );
    expect((editor as HTMLTextAreaElement).value).toBe("# 下一篇");
    fireEvent.paste(editor, { clipboardData: { files: [file] } });
    await waitFor(() =>
      expect((editor as HTMLTextAreaElement).value).toContain("![图片]"),
    );
    expect(test.invoke).toHaveBeenCalledWith(
      "insert_image",
      expect.objectContaining({ path: "/notes/next.md" }),
    );
  });
  it("未命名文档首次保存成功后，图片继续插入正确的正式文档", async () => {
    test.save.mockResolvedValue("/notes/with-image.md");
    render(<App />);
    act(() => test.handlers.get("menu-action")?.({ payload: "new" }));
    const editor = await screen.findByLabelText("Markdown 编辑器");
    fireEvent.change(editor, { target: { value: "# 图片笔记" } });
    const file = new File(["image"], "image.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    });
    fireEvent.paste(editor, { clipboardData: { files: [file] } });
    await screen.findByRole("button", { name: "查看 with-image.md" });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
      ).toContain("![图片](assets/unique.png)"),
    );
    expect(test.invoke).toHaveBeenCalledWith(
      "insert_image",
      expect.objectContaining({ path: "/notes/with-image.md" }),
    );
  });
  it("读取粘贴字节时切换后重新编辑同一文件，旧操作仍会取消", async () => {
    const editor = await openEditor();
    let resolve!: (v: ArrayBuffer) => void;
    const file = new File(["image"], "image.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((r) => {
          resolve = r;
        }),
    });
    fireEvent.paste(editor, { clipboardData: { files: [file] } });
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    expect(
      (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    test.open.mockResolvedValue("/notes/next.md");
    act(() => test.handlers.get("menu-action")?.({ payload: "open" }));
    await screen.findByRole("heading", { name: "下一篇" });
    test.open.mockResolvedValue("/notes/edit.md");
    act(() => test.handlers.get("menu-action")?.({ payload: "open" }));
    await screen.findByRole("heading", { name: "原文" });
    fireEvent.click(screen.getByLabelText("编辑文档"));
    await screen.findByLabelText("Markdown 编辑器");
    await act(async () => resolve(new Uint8Array([137, 80, 78, 71]).buffer));
    expect(test.invoke.mock.calls.some(([cmd]) => cmd === "insert_image")).toBe(
      false,
    );
  });
  it("原生拒绝草稿清理时保留列表入口，正式副本照常可用", async () => {
    const original = test.invoke.getMockImplementation()!;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "remove_untitled")
          throw { code: "recovery", message: "发现未处理草稿" };
        return original(cmd, args);
      },
    );
    render(<App />);
    act(() => test.handlers.get("menu-action")?.({ payload: "new" }));
    fireEvent.change(await screen.findByLabelText("Markdown 编辑器"), {
      target: { value: "# 正式内容" },
    });
    test.save.mockResolvedValue("/notes/retained.md");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("heading", { name: "正式内容" });
    await screen.findByText(
      "文档已保存；原草稿仍保留，可从文件列表或快速切换重新打开。",
    );
    expect(
      screen.getByRole("button", { name: "查看 未命名 1.md" }),
    ).toBeTruthy();
    expect(test.files.get("/notes/retained.md")?.content).toBe("# 正式内容");
  });
  it("打印的普通中文标题链接能解析到实际打印ID", async () => {
    test.files.set("/notes/edit.md", {
      content: "# 标题\n\n[到小节](#小节)\n\n## 小节\n\n正文",
      version: "v1",
    });
    let targetExists: boolean | undefined;
    const original = test.invoke.getMockImplementation()!;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "print_document") {
          const root = document.querySelector(".print-document")!;
          const href = root.querySelector("a")!.getAttribute("href")!;
          targetExists = Array.from(root.querySelectorAll("[id]")).some(
            (e) => e.id === decodeURIComponent(href.slice(1)),
          );
          return;
        }
        return original(cmd, args);
      },
    );
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "标题" });
    act(() =>
      test.handlers.get("menu-action")?.({ payload: "print-document" }),
    );
    await waitFor(() => expect(targetExists).toBe(true));
  });
});

it("旧完成编辑操作迟到，不能抢回文档或结束新编辑会话", async () => {
  const editor = await openEditor();
  fireEvent.change(editor, {
    target: { value: "# A保存内容\n\n![图](assets/a.png)" },
  });
  const original = test.invoke.getMockImplementation()!;
  let resolve!: () => void;
  let first = true;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "authorize_images" && first) {
        first = false;
        return new Promise<void>((r) => {
          resolve = r;
        });
      }
      return original(cmd, args);
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  test.open.mockResolvedValue("/notes/next.md");
  act(() => test.handlers.get("menu-action")?.({ payload: "open" }));
  await screen.findByRole("heading", { name: "下一篇" });
  act(() => test.handlers.get("menu-action")?.({ payload: "edit" }));
  const next = await screen.findByLabelText("Markdown 编辑器");
  fireEvent.change(next, { target: { value: "# B的新编辑" } });
  try {
    await act(async () => resolve());
    expect(next.isConnected).toBe(true);
    expect(
      (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
    ).toBe("# B的新编辑");
  } finally {
    await waitFor(
      () =>
        expect(test.files.get("/notes/next.md")?.content).toBe("# B的新编辑"),
      { timeout: 3000 },
    );
  }
});
it("历史窗口打开时原生菜单不能绕过模态打开其他文件", async () => {
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) =>
      cmd === "list_history" ? [] : original(cmd, args),
  );
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "原文" });
  act(() => test.handlers.get("menu-action")?.({ payload: "history" }));
  await screen.findByRole("dialog", { name: "历史版本" });
  test.open.mockClear();
  test.open.mockResolvedValue("/notes/next.md");
  act(() => test.handlers.get("menu-action")?.({ payload: "open" }));
  expect(test.open).not.toHaveBeenCalled();
});

it("完成编辑等待读取图片授权期间的最后输入，必须再次保存后才能结束", async () => {
  const editor = await openEditor();
  fireEvent.change(editor, {
    target: { value: "# 较早输入\n\n![图](assets/a.png)" },
  });
  const original = test.invoke.getMockImplementation()!;
  let resolve!: () => void;
  let first = true;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "authorize_images" && first) {
        first = false;
        return new Promise<void>((r) => {
          resolve = r;
        });
      }
      return original(cmd, args);
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  fireEvent.change(editor, {
    target: { value: "# 后到输入\n\n![图](assets/a.png)" },
  });
  await act(async () => resolve());
  await screen.findByRole("heading", { name: "后到输入" });
  expect(test.files.get("/notes/edit.md")?.content).toContain("# 后到输入");
});

it("图片尚在插入时退出应等待，完成后再保存退出", async () => {
  await openEditor();
  test.open.mockResolvedValue("/images/a.png");
  const original = test.invoke.getMockImplementation()!;
  let resolve!: (value: string) => void;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "insert_image")
        return new Promise<string>((r) => {
          resolve = r;
        });
      return original(cmd, args);
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "插入图片" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  try {
    await act(async () =>
      test.handlers.get("app-action")?.({ payload: "quit" }),
    );
    expect(
      test.invoke.mock.calls.some(([cmd]) => cmd === "finish_window_action"),
    ).toBe(false);
    await act(async () => resolve("assets/a.png"));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
      ).toContain("![图片]"),
    );
    act(() => test.handlers.get("app-action")?.({ payload: "quit" }));
    await waitFor(() =>
      expect(test.invoke).toHaveBeenCalledWith("finish_window_action", {
        action: "quit",
      }),
    );
    expect(test.files.get("/notes/edit.md")?.content).toContain("![图片]");
  } finally {
    resolve("assets/a.png");
  }
});

it("Finder在模态窗口中打开的文件会排队，关闭后才处理", async () => {
  const original = test.invoke.getMockImplementation()!;
  let incoming = false;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "list_history") return [];
      if (cmd === "take_pending_files") {
        if (incoming) {
          incoming = false;
          return ["/notes/next.md"];
        }
        return [];
      }
      return original(cmd, args);
    },
  );
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "原文" });
  act(() => test.handlers.get("menu-action")?.({ payload: "history" }));
  await screen.findByRole("dialog", { name: "历史版本" });
  incoming = true;
  await act(async () => test.handlers.get("files-opened")?.({ payload: null }));
  expect(screen.getByRole("dialog", { name: "历史版本" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "下一篇" })).toBeNull();
  fireEvent.click(screen.getByLabelText("关闭历史版本"));
  await screen.findByRole("heading", { name: "下一篇" });
});
it("文件对话框返回时模态已打开，所选文件不会在背后切换", async () => {
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) =>
      cmd === "list_history" ? [] : original(cmd, args),
  );
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "原文" });
  let resolve!: (path: string) => void;
  test.open.mockImplementation(
    () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
  );
  act(() => test.handlers.get("menu-action")?.({ payload: "open" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  act(() => test.handlers.get("menu-action")?.({ payload: "history" }));
  await screen.findByRole("dialog", { name: "历史版本" });
  await act(async () => resolve("/notes/next.md"));
  expect(screen.getByRole("dialog", { name: "历史版本" })).toBeTruthy();
  fireEvent.click(screen.getByLabelText("关闭历史版本"));
  await screen.findByRole("heading", { name: "下一篇" });
});
it("组件卸载后只保留草稿，不再通过遗留定时器写入文件", async () => {
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: "# 卸载时保留的输入" } });
  cleanup();
  await waitFor(() =>
    expect(test.drafts.get("/notes/edit.md")?.text).toBe("# 卸载时保留的输入"),
  );
  const saves = test.invoke.mock.calls.filter(
    ([cmd]) => cmd === "save_document",
  ).length;
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(
    test.invoke.mock.calls.filter(([cmd]) => cmd === "save_document"),
  ).toHaveLength(saves);
  expect(test.files.get("/notes/edit.md")?.content).toBe("# 原文\n\n正文");
});

describe("后续审查：临时文档身份与特殊路径", () => {
  it("首次保存的清理完成前不能复用临时路径创建新文档", async () => {
    let finishCleanup!: () => void;
    const original = test.invoke.getMockImplementation()!;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "remove_untitled") {
          await original(cmd, args);
          await new Promise<void>((resolve) => {
            finishCleanup = resolve;
          });
          return;
        }
        return original(cmd, args);
      },
    );
    render(<App />);
    act(() => test.handlers.get("menu-action")?.({ payload: "new" }));
    fireEvent.change(await screen.findByLabelText("Markdown 编辑器"), {
      target: { value: "# 已保存的第一篇" },
    });
    test.save.mockResolvedValue("/notes/first.md");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("heading", { name: "已保存的第一篇" });
    await waitFor(() => expect(finishCleanup).toBeTypeOf("function"));
    act(() => test.handlers.get("menu-action")?.({ payload: "new" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      test.invoke.mock.calls.filter(([cmd]) => cmd === "new_document"),
    ).toHaveLength(1);
    await act(async () => finishCleanup());
    act(() => test.handlers.get("menu-action")?.({ payload: "new" }));
    await screen.findByLabelText("Markdown 编辑器");
    expect(
      screen.getByRole("button", { name: "查看 未命名 1.md" }),
    ).toBeTruthy();
  });

  it("未命名文档首次保存后，返回历史跟随正式路径而非已清理路径", async () => {
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "原文" });
    act(() => test.handlers.get("menu-action")?.({ payload: "new" }));
    fireEvent.change(await screen.findByLabelText("Markdown 编辑器"), {
      target: { value: "# 导航草稿" },
    });
    test.open.mockResolvedValue("/notes/next.md");
    openFileFromMenu();
    await screen.findByRole("heading", { name: "下一篇" });
    fireEvent.click(screen.getByRole("button", { name: "查看 未命名 1.md" }));
    await screen.findByRole("heading", { name: "导航草稿" });
    test.save.mockResolvedValue("/notes/navigation.md");
    fireEvent.click(screen.getByRole("button", { name: "保存到文件…" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "查看 未命名 1.md" }),
      ).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "返回上一处" }));
    await screen.findByRole("heading", { name: "下一篇" });
    fireEvent.click(screen.getByRole("button", { name: "返回上一处" }));
    await screen.findByRole("heading", { name: "导航草稿" });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回上一处" }));
    await screen.findByRole("heading", { name: "原文" });
  });

  it("本地图片在含字面百分号编码和中文的目录中保留真实路径", async () => {
    const path = "/notes/100%25 中文/note.md";
    test.files.set(path, {
      content: "# 特殊目录\n\n![图](assets/图.png)",
      version: "p1",
    });
    test.open.mockResolvedValue(path);
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "特殊目录" });
    expect(test.invoke).toHaveBeenCalledWith("authorize_images", {
      paths: ["/notes/100%25 中文/assets/图.png"],
    });
    expect(screen.getByAltText("图").getAttribute("src")).toBe(
      "asset://localhost/notes/100%25 中文/assets/图.png",
    );
  });
});

it("草稿清理延迟时打开其他文件，旧保存不得把新文件带入编辑", async () => {
  let finishCleanup!: () => void;
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "remove_untitled") {
        await original(cmd, args);
        await new Promise<void>((resolve) => {
          finishCleanup = resolve;
        });
        return;
      }
      return original(cmd, args);
    },
  );
  render(<App />);
  act(() => test.handlers.get("menu-action")?.({ payload: "new" }));
  fireEvent.change(await screen.findByLabelText("Markdown 编辑器"), {
    target: { value: "# 旧保存" },
  });
  test.save.mockResolvedValue("/notes/old-save.md");
  act(() => test.handlers.get("menu-action")?.({ payload: "save" }));
  await waitFor(() => expect(finishCleanup).toBeTypeOf("function"));
  test.open.mockResolvedValue("/notes/next.md");
  act(() => test.handlers.get("menu-action")?.({ payload: "open" }));
  await screen.findByRole("heading", { name: "下一篇" });
  await act(async () => finishCleanup());
  expect(screen.queryByLabelText("Markdown 编辑器")).toBeNull();
  expect(screen.getByRole("heading", { name: "下一篇" })).toBeTruthy();
});

it("原文件丢失后重开，保留本机草稿并能另存，取消时也不清理草稿", async () => {
  const path = "/notes/deleted.md";
  const draft = {
    path,
    text: "# 丢失原文件后的重要草稿",
    baseVersion: "missing-base",
    sessionId: "previous",
    revision: 3,
  };
  test.drafts.set(path, draft);
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "read_document" && args.path === path)
        return {
          path,
          name: "deleted.md",
          content: draft.text,
          version: draft.baseVersion,
          draft,
          unavailable: true,
          writable: false,
          recoveryWarning:
            "原文件无法读取，当前展示本机恢复草稿。请另存副本以保留内容。",
        };
      if (cmd === "probe_document" && args.path === path)
        return { status: "missing", writable: false };
      return original(cmd, args);
    },
  );
  test.open.mockResolvedValue(path);
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "丢失原文件后的重要草稿" });
  expect(test.drafts.get(path)).toEqual(draft);
  fireEvent.click(screen.getByRole("button", { name: "恢复草稿" }));
  await screen.findByRole("dialog");
  expect(screen.getByText(/原文件已无法读取/)).toBeTruthy();
  test.save.mockResolvedValue(null);
  fireEvent.click(screen.getByRole("button", { name: "另存副本并编辑" }));
  await waitFor(() => expect(test.save).toHaveBeenCalledOnce());
  expect(test.drafts.get(path)).toEqual(draft);
  fireEvent.click(screen.getByRole("button", { name: "恢复草稿" }));
  await screen.findByRole("dialog");
  test.save.mockResolvedValue("/notes/rescued.md");
  fireEvent.click(screen.getByRole("button", { name: "另存副本并编辑" }));
  const editor = await screen.findByLabelText("Markdown 编辑器");
  expect((editor as HTMLTextAreaElement).value).toBe(draft.text);
  expect(test.files.get("/notes/rescued.md")?.content).toBe(draft.text);
  expect(test.files.has(path)).toBe(false);
  expect(test.drafts.get(path)).toEqual(draft);
});

it("放弃确认框焦点退回body后Esc仍取消，输入与草稿保持完整", async () => {
  const editor = await openEditor();
  test.fail = true;
  fireEvent.change(editor, { target: { value: "# 保留这份输入" } });
  act(() => test.handlers.get("menu-action")?.({ payload: "reload" }));
  await screen.findByRole("alertdialog");
  fireEvent.keyDown(document.body, { key: "Escape", isComposing: true });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(
    (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
  ).toBe("# 保留这份输入");
  expect(test.files.get("/notes/edit.md")?.content).toBe("# 原文\n\n正文");
});

it.each(["历史", "快速切换", "只读", "放弃确认", "图片", "文档搜索"])(
  "%s弹层期间菜单与排版快捷键不能修改背后的文档",
  async (kind) => {
    localStorage.setItem(
      "argus.preferences.v1",
      JSON.stringify({
        reading: { fontSize: 23, lineHeight: 2.2, width: 940 },
      }),
    );
    test.files.set("/notes/edit.md", {
      content: "# 原文\n\n![图](assets/a.png)",
      version: "v1",
    });
    const original = test.invoke.getMockImplementation()!;
    test.invoke.mockImplementation(
      async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "list_history" || cmd === "list_untitled") return [];
        if (cmd === "probe_document")
          return {
            status: "unchanged",
            version: "v1",
            writable: kind !== "只读",
          };
        return original(cmd, args);
      },
    );
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "原文" });
    if (kind === "历史")
      act(() => test.handlers.get("menu-action")?.({ payload: "history" }));
    if (kind === "文档搜索")
      act(() =>
        test.handlers.get("menu-action")?.({ payload: "search-opened" }),
      );
    if (kind === "快速切换")
      act(() =>
        test.handlers.get("menu-action")?.({ payload: "quick-switch" }),
      );
    if (kind === "图片") fireEvent.click(screen.getByAltText("图"));
    if (kind === "只读" || kind === "放弃确认") {
      fireEvent.click(screen.getByLabelText("编辑文档"));
      if (kind === "放弃确认") {
        await screen.findByLabelText("Markdown 编辑器");
        act(() => test.handlers.get("menu-action")?.({ payload: "reload" }));
      }
    }
    const modal = await screen.findByRole(
      kind === "放弃确认" ? "alertdialog" : "dialog",
    );
    await act(async () => {
      await Promise.resolve();
    });
    const callStart = test.invoke.mock.calls.length;
    test.open.mockClear();
    test.save.mockClear();
    const before = JSON.parse(localStorage.getItem("argus.preferences.v1")!);
    for (const payload of [
      "new",
      "open",
      "edit",
      "save",
      "save-copy",
      "view",
      "theme",
      "reload",
      "quick-switch",
      "insert-image",
      "history",
      "print-document",
      "navigate-back",
      "font-increase",
      "font-decrease",
      "reading-reset",
    ]) {
      act(() => test.handlers.get("menu-action")?.({ payload }));
    }
    fireEvent.keyDown(document.body, { key: "0", metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(modal.isConnected).toBe(true);
    expect(test.open).not.toHaveBeenCalled();
    expect(test.save).not.toHaveBeenCalled();
    expect(
      test.invoke.mock.calls
        .slice(callStart)
        .some(([cmd]) =>
          [
            "new_document",
            "read_document",
            "begin_edit_session",
            "insert_image",
            "print_document",
          ].includes(cmd),
        ),
    ).toBe(false);
    const after = JSON.parse(localStorage.getItem("argus.preferences.v1")!);
    expect(after.reading).toEqual(before.reading);
    expect(after.theme).toBe(before.theme);
    expect(after.lastPath).toBe(before.lastPath);
  },
);

it("跨文档搜索只传已打开文件，点击命中定位阅读段落", async () => {
  localStorage.setItem(
    "argus.preferences.v1",
    JSON.stringify({
      openedPaths: ["/notes/edit.md", "/notes/next.md"],
      recent: ["/not-open/closed.md"],
    }),
  );
  test.files.set("/notes/next.md", {
    content: "# 下一篇\n\nNeedle 所在段落",
    version: "n1",
  });
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) =>
      cmd === "search_documents"
        ? {
            hits: [
              {
                path: "/notes/next.md",
                name: "next.md",
                version: "n1",
                line: 3,
                column: 0,
                length: 6,
                matched: "Needle",
                before: "",
                after: " 所在段落",
                buffer: false,
              },
            ],
            failures: [],
            searched: 2,
            total: 2,
            truncated: false,
            cancelled: false,
          }
        : original(cmd, args),
  );
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "原文" });
  act(() => test.handlers.get("menu-action")?.({ payload: "search-opened" }));
  fireEvent.change(await screen.findByLabelText("搜索已打开文档的内容"), {
    target: { value: "Needle" },
  });
  fireEvent.click(await screen.findByRole("option"));
  await screen.findByRole("heading", { name: "下一篇" });
  await waitFor(() =>
    expect(document.querySelector(".search-arrival")?.textContent).toBe(
      "Needle 所在段落",
    ),
  );
  const request = test.invoke.mock.calls.find(
    ([c]) => c === "search_documents",
  )![1];
  expect(request.paths).toEqual(["/notes/edit.md", "/notes/next.md"]);
  expect(screen.queryByRole("button", { name: "查看 closed.md" })).toBeNull();
});

it("搜索当前未保存输入不结束编辑，保存冲突时选其他文件仍保留输入", async () => {
  const editor = await openEditor();
  test.fail = true;
  fireEvent.change(editor, { target: { value: "# 原文\n\nNeedle 未保存" } });
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) =>
      cmd === "search_documents"
        ? {
            hits: [
              {
                path: "/notes/edit.md",
                name: "edit.md",
                version: "v1",
                line: 3,
                column: 0,
                length: 6,
                matched: "Needle",
                before: "",
                after: " 未保存",
                buffer: true,
              },
              {
                path: "/notes/next.md",
                name: "next.md",
                version: "n1",
                line: 1,
                column: 2,
                length: 3,
                matched: "下一篇",
                before: "# ",
                after: "",
                buffer: false,
              },
            ],
            failures: [],
            searched: 2,
            total: 2,
            truncated: false,
            cancelled: false,
          }
        : original(cmd, args),
  );
  act(() => test.handlers.get("menu-action")?.({ payload: "search-opened" }));
  fireEvent.change(await screen.findByLabelText("搜索已打开文档的内容"), {
    target: { value: "Needle" },
  });
  fireEvent.click((await screen.findAllByRole("option"))[0]);
  expect(
    (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
  ).toContain("Needle 未保存");
  expect(test.files.get("/notes/edit.md")?.content).toBe("# 原文\n\n正文");
  expect(
    test.invoke.mock.calls.find(([c]) => c === "search_documents")![1].buffer
      .text,
  ).toContain("Needle 未保存");
  act(() => test.handlers.get("menu-action")?.({ payload: "search-opened" }));
  fireEvent.change(await screen.findByLabelText("搜索已打开文档的内容"), {
    target: { value: "Needle" },
  });
  fireEvent.click((await screen.findAllByRole("option"))[1]);
  await screen.findByRole("alert");
  expect(screen.queryByRole("heading", { name: "下一篇" })).toBeNull();
  expect(
    (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
  ).toContain("Needle 未保存");
});

it("命中文档随后发生变化时打开最新内容并提示重新搜索，不跳到旧位置", async () => {
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) =>
      cmd === "search_documents"
        ? {
            hits: [
              {
                path: "/notes/next.md",
                name: "next.md",
                version: "older",
                line: 1,
                column: 2,
                length: 3,
                matched: "下一篇",
                before: "# ",
                after: "",
                buffer: false,
              },
            ],
            failures: [],
            searched: 1,
            total: 1,
            truncated: false,
            cancelled: false,
          }
        : original(cmd, args),
  );
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "原文" });
  act(() => test.handlers.get("menu-action")?.({ payload: "search-opened" }));
  fireEvent.change(await screen.findByLabelText("搜索已打开文档的内容"), {
    target: { value: "下一篇" },
  });
  fireEvent.click(await screen.findByRole("option"));
  await screen.findByText("文档内容已变化，已打开最新内容，请重新搜索。");
  expect(document.querySelector(".search-arrival")).toBeNull();
});

it("另存携带资源后按原生返回的新源码校验，原输入与原文件不被改写", async () => {
  const content = "# 原文\n\n![图](old.png)";
  const rewritten = "# 原文\n\n![图](copy.assets-abc/hash.png)";
  test.files.set("/notes/edit.md", { content, version: "v1" });
  test.analyze.mockResolvedValue([
    { from: 11, to: 18, path: "/notes/old.png", suffix: "", image: true },
  ]);
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "save_copy") {
        test.files.set(String(args.path), {
          content: rewritten,
          version: "copy-v1",
        });
        return { version: "copy-v1", content: rewritten, images: 1 };
      }
      return original(cmd, args);
    },
  );
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "原文" });
  test.save.mockResolvedValue("/elsewhere/copy.md");
  act(() => test.handlers.get("menu-action")?.({ payload: "save-copy" }));
  await screen.findByRole("button", { name: "查看 copy.md" });
  expect(test.invoke).toHaveBeenCalledWith(
    "save_copy",
    expect.objectContaining({
      source: "/notes/edit.md",
      content,
      references: expect.arrayContaining([
        expect.objectContaining({ path: "/notes/old.png" }),
      ]),
    }),
  );
  expect(test.files.get("/notes/edit.md")?.content).toBe(content);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByAltText("图").getAttribute("src")).toBe(
    "asset://localhost/elsewhere/copy.assets-abc/hash.png",
  );
});

it("资源分析期间迟到输入必须保留，不能用旧缓冲区另存并结束会话", async () => {
  const editor = await openEditor();
  let complete!: (value: unknown[]) => void;
  test.analyze.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  test.save.mockResolvedValue("/elsewhere/new.md");
  act(() => test.handlers.get("menu-action")?.({ payload: "save-copy" }));
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  fireEvent.change(editor, { target: { value: "# 后到输入" } });
  await act(async () => complete([]));
  await screen.findByRole("alert");
  expect(
    (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
  ).toBe("# 后到输入");
  expect(test.invoke.mock.calls.some(([c]) => c === "save_copy")).toBe(false);
});

it("原始HTML命中没有安全的渲染行标记时定位源码，不改变HTML结构", async () => {
  test.files.set("/notes/next.md", {
    content: "<details>\nNeedle raw\n</details>",
    version: "n1",
  });
  const original = test.invoke.getMockImplementation()!;
  test.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) =>
      cmd === "search_documents"
        ? {
            hits: [
              {
                path: "/notes/next.md",
                name: "next.md",
                version: "n1",
                line: 2,
                column: 0,
                length: 6,
                matched: "Needle",
                before: "",
                after: " raw",
                buffer: false,
              },
            ],
            failures: [],
            searched: 1,
            total: 1,
            truncated: false,
            cancelled: false,
          }
        : original(cmd, args),
  );
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "原文" });
  act(() => test.handlers.get("menu-action")?.({ payload: "search-opened" }));
  fireEvent.change(await screen.findByLabelText("搜索已打开文档的内容"), {
    target: { value: "Needle" },
  });
  fireEvent.click(await screen.findByRole("option"));
  await screen.findByText("此处为原始HTML，已定位到源码第2行。");
  expect(screen.getByLabelText("只读 Markdown 源码").textContent).toContain(
    "Needle raw",
  );
});

it("编辑与查看方式分离，保存失败保留输入，保存成功后可查看源码", async () => {
  const editor = await openEditor();
  test.fail = true;
  fireEvent.change(editor, { target: { value: "# 模式切换保留输入" } });
  expect(screen.queryByRole("group", { name: "查看方式" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByRole("alert");
  expect(
    (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
  ).toBe("# 模式切换保留输入");
  test.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByRole("group", { name: "查看方式" });
  fireEvent.click(screen.getByRole("button", { name: "只读源码" }));
  await screen.findByLabelText("只读 Markdown 源码");
  expect(test.files.get("/notes/edit.md")?.content).toBe("# 模式切换保留输入");
  expect(screen.queryByLabelText("Markdown 编辑器")).toBeNull();
});

it("保存失败时实时预览仍反映当前输入，切换预览不丢内容，重试后可正常保存回阅读", async () => {
  const editor = await openEditor();
  test.fail = true;
  fireEvent.click(screen.getByRole("button", { name: "实时预览" }));
  fireEvent.change(editor, {
    target: { value: "# 尚未保存的预览\n\n**保留这段输入**" },
  });
  const preview = await screen.findByRole("region", {
    name: "实时 Markdown 预览",
  });
  await within(preview).findByRole("heading", { name: "尚未保存的预览" });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByRole("alert");
  expect(test.files.get("/notes/edit.md")?.content).toBe("# 原文\n\n正文");
  fireEvent.click(screen.getByRole("button", { name: "实时预览" }));
  expect(
    (screen.getByLabelText("Markdown 编辑器") as HTMLTextAreaElement).value,
  ).toContain("保留这段输入");
  test.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await within(
    await screen.findByRole("main", { name: "Markdown 阅读区" }),
  ).findByRole("heading", { name: "尚未保存的预览" });
  expect(test.files.get("/notes/edit.md")?.content).toContain("保留这段输入");
});
