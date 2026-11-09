// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  handlers: new Map<string, (e: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mocks.invoke,
  convertFileSrc: (s: string) => `asset://localhost${s}`,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, fn: (e: { payload: unknown }) => void) => {
    mocks.handlers.set(name, fn);
    return () => mocks.handlers.delete(name);
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn(async () => {}),
  }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: async (fn: (e: { payload: unknown }) => void) => {
      mocks.handlers.set("drop", fn);
      return () => mocks.handlers.delete("drop");
    },
  }),
}));
const doc = {
  path: "/notes/中文 空格.md",
  name: "中文 空格.md",
  content:
    "# 开始\n\n正文\n\n## 第二章\n\n```js\nconst x = 1;\n```\n\n![图](图片.png)",
  siblings: ["/notes/中文 空格.md", "/notes/other.md"],
};

beforeEach(() => {
  localStorage.clear();
  mocks.invoke.mockReset();
  mocks.open.mockReset();
  mocks.handlers.clear();
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
  HTMLElement.prototype.scrollTo = function (
    options?: ScrollToOptions | number,
    y?: number,
  ) {
    this.scrollTop =
      typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
  };
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.invoke.mockImplementation(async (cmd: string) =>
    cmd === "take_pending_files" ? [] : doc,
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

function chooseTheme(name: string) {
  fireEvent.click(screen.getByLabelText("外观设置"));
  fireEvent.click(screen.getByRole("button", { name }));
}
function chooseView(title: string) {
  fireEvent.click(screen.getByTitle(title));
}

describe("使用者阅读流程", () => {
  it("点击顶部文件名复制未编码的中文空格绝对路径，并给出结果反馈", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mocks.open.mockResolvedValue(doc.path);
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "开始" });
    const titleButton = document.querySelector<HTMLButtonElement>(
      "button.document-title",
    )!;
    expect(titleButton.textContent).toContain(doc.name);
    fireEvent.click(titleButton);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("/notes/中文 空格.md"),
    );
    expect(await screen.findByText("已复制绝对路径")).toBeTruthy();
    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(titleButton);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "复制路径失败",
    );
    expect(screen.getByRole("heading", { name: "开始" })).toBeTruthy();
  });
  it("内置指南不复制内部标识作为文件路径", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App />);
    fireEvent.click(screen.getByText("先读一读阅读指南"));
    const titleButton = document.querySelector<HTMLButtonElement>(
      "button.document-title",
    )!;
    expect(titleButton.disabled).toBe(true);
    fireEvent.click(titleButton);
    expect(writeText).not.toHaveBeenCalled();
  });
  it("主题切换记住深浅两侧选择，且暖白与磨砂独立", async () => {
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    chooseTheme("纯白");
    expect(document.documentElement.dataset.theme).toBe("white");
    act(() => mocks.handlers.get("menu-action")!({ payload: "theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => mocks.handlers.get("menu-action")!({ payload: "theme" }));
    expect(document.documentElement.dataset.theme).toBe("white");
    chooseTheme("淡紫");
    expect(document.documentElement.dataset.theme).toBe("lavender");
    act(() => mocks.handlers.get("menu-action")!({ payload: "theme" }));
    act(() => mocks.handlers.get("menu-action")!({ payload: "theme" }));
    expect(document.documentElement.dataset.theme).toBe("lavender");
    expect(
      JSON.parse(localStorage.getItem("argus.preferences.v1")!).theme,
    ).toBe("lavender");
    chooseTheme("暖白磨砂");
    expect(document.documentElement.dataset.theme).toBe("matte");
    act(() => mocks.handlers.get("menu-action")!({ payload: "theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => mocks.handlers.get("menu-action")!({ payload: "theme" }));
    expect(document.documentElement.dataset.theme).toBe("matte");
    expect(
      JSON.parse(localStorage.getItem("argus.preferences.v1")!).theme,
    ).toBe("matte");
    chooseTheme("暖白");
    expect(document.documentElement.dataset.theme).toBe("light");
    chooseTheme("石墨");
    expect(document.documentElement.dataset.theme).toBe("graphite");
    act(() => mocks.handlers.get("menu-action")!({ payload: "theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => mocks.handlers.get("menu-action")!({ payload: "theme" }));
    expect(document.documentElement.dataset.theme).toBe("graphite");
    chooseTheme("晨光");
    act(() => mocks.handlers.get("menu-action")!({ payload: "theme" }));
    expect(document.documentElement.dataset.theme).toBe("graphite");
    act(() => mocks.handlers.get("menu-action")!({ payload: "theme" }));
    expect(document.documentElement.dataset.theme).toBe("dawn");
  });
  it("只列出用户主动打开的文件，最近阅读折叠到唯一文件菜单", async () => {
    mocks.open.mockResolvedValue(doc.path);
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "开始" });
    expect(
      screen.getByRole("button", { name: "查看 中文 空格.md" }),
    ).toBeTruthy();
    expect(screen.queryByText("other.md")).toBeNull();
    expect(screen.queryByRole("region", { name: "最近阅读记录" })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    chooseView("只读源码");
    expect(screen.getByLabelText("只读 Markdown 源码").textContent).toContain(
      "# 开始",
    );
    expect(document.querySelector("textarea")).toBeNull();
    chooseTheme("深绿");
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "最近阅读" }));
    expect(screen.getByRole("region", { name: "最近阅读记录" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "最近阅读记录" })).toBeNull();
  });
  it("大纲属于当前文档，主动打开并可返回文件列表", async () => {
    const result = render(<App />);
    expect(screen.queryByLabelText("查看当前文档大纲")).toBeNull();
    mocks.open.mockResolvedValue(doc.path);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "开始" });
    expect(
      screen.queryByRole("navigation", { name: `${doc.name} 的大纲` }),
    ).toBeNull();
    fireEvent.click(screen.getByLabelText("查看当前文档大纲"));
    expect(
      screen.getByRole("navigation", { name: `${doc.name} 的大纲` }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "第二章" }));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("返回已打开文件"));
    expect(screen.getByRole("navigation", { name: "已打开文件" })).toBeTruthy();
    result.unmount();
  });
  it("关闭其他文档不影响当前阅读，关闭当前文档切换邻近项且不删除磁盘文件", async () => {
    mocks.invoke.mockImplementation(
      async (cmd: string, args?: { path: string }) =>
        cmd === "take_pending_files"
          ? []
          : cmd === "read_document"
            ? {
                ...doc,
                path: args!.path,
                name: args!.path.split("/").pop(),
                content: args!.path === "/a.md" ? "# A" : "# B",
              }
            : undefined,
    );
    const result = render(<App />);
    mocks.open.mockResolvedValue("/a.md");
    openFileFromMenu();
    await screen.findByRole("heading", { name: "A" });
    mocks.open.mockResolvedValue("/b.md");
    openFileFromMenu();
    await screen.findByRole("heading", { name: "B" });
    fireEvent.click(screen.getByRole("button", { name: "关闭 a.md" }));
    expect(screen.getByRole("heading", { name: "B" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "查看 a.md" })).toBeNull();
    mocks.open.mockResolvedValue("/a.md");
    openFileFromMenu();
    await screen.findByRole("heading", { name: "A" });
    fireEvent.click(screen.getByRole("button", { name: "关闭 a.md" }));
    await screen.findByRole("heading", { name: "B" });
    fireEvent.click(screen.getByRole("button", { name: "关闭 b.md" }));
    expect(screen.queryByRole("navigation", { name: "已打开文件" })).toBeNull();
    expect(screen.getByText("先读一读阅读指南")).toBeTruthy();
    expect(
      JSON.parse(localStorage.getItem("argus.preferences.v1")!).openedPaths,
    ).toEqual([]);
    expect(
      JSON.parse(localStorage.getItem("argus.preferences.v1")!).recent,
    ).toContain("/a.md");
    expect(
      mocks.invoke.mock.calls.every(([cmd]) =>
        [
          "read_document",
          "take_pending_files",
          "authorize_images",
          "watch_document",
          "probe_document",
        ].includes(cmd),
      ),
    ).toBe(true);
    result.unmount();
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "查看 a.md" })).toBeNull();
    expect(screen.queryByRole("button", { name: "查看 b.md" })).toBeNull();
  });
  it("打开列表持久化且去重，关闭正在读取的文档不会被迟到响应重新加入", async () => {
    localStorage.setItem(
      "argus.preferences.v1",
      JSON.stringify({
        lastPath: "/a.md",
        openedPaths: ["/a.md", "/b.md", "/b.md"],
        recent: ["/b.md"],
      }),
    );
    let resolveB: (value: typeof doc) => void = () => {};
    mocks.invoke.mockImplementation((cmd: string, args?: { path: string }) =>
      cmd === "take_pending_files"
        ? Promise.resolve([])
        : cmd === "read_document" && args?.path === "/b.md"
          ? new Promise((resolve) => {
              resolveB = resolve;
            })
          : Promise.resolve({
              ...doc,
              path: "/a.md",
              name: "a.md",
              content: "# A",
            }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: "A" });
    expect(screen.getAllByRole("button", { name: "查看 b.md" })).toHaveLength(
      1,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看 b.md" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭 b.md" }));
    await act(async () =>
      resolveB({ ...doc, path: "/b.md", name: "b.md", content: "# B" }),
    );
    expect(screen.queryByRole("heading", { name: "B" })).toBeNull();
    expect(screen.queryByRole("button", { name: "查看 b.md" })).toBeNull();
    expect(screen.getByRole("heading", { name: "A" })).toBeTruthy();
  });
  it("取消对话框不改变文档，读取失败保留当前文章", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("先读一读阅读指南"));
    const heading = screen.getByRole("heading", {
      name: "把注意力，留给文字。",
    });
    mocks.open.mockResolvedValue(null);
    openFileFromMenu();
    await act(async () => {
      await Promise.resolve();
    });
    expect(heading.isConnected).toBe(true);
    mocks.open.mockResolvedValue("/missing.md");
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_document") throw "无法打开文件：文件不存在";
      return [];
    });
    openFileFromMenu();
    await screen.findByRole("alert");
    expect(heading.isConnected).toBe(true);
  });
  it("重新启动恢复文件、主题、源码及独立的阅读位置", async () => {
    localStorage.setItem(
      "argus.preferences.v1",
      JSON.stringify({
        theme: "dark",
        view: "source",
        lastPath: doc.path,
        recent: [doc.path],
        positions: {
          [doc.path]: {
            source: { top: 280, ratio: 0.4 },
            render: { top: 120, ratio: 0.2 },
          },
        },
      }),
    );
    const result = render(<App />);
    await screen.findByLabelText("只读 Markdown 源码");
    await waitFor(() =>
      expect(document.querySelector("pre.source-view")).not.toBeNull(),
    );
    const reader = screen.getByLabelText("只读 Markdown 源码");
    Object.defineProperty(reader, "scrollHeight", {
      configurable: true,
      value: 1800,
    });
    Object.defineProperty(reader, "clientHeight", {
      configurable: true,
      value: 600,
    });
    fireEvent.wheel(reader);
    reader.scrollTop = 420;
    fireEvent.scroll(reader);
    chooseView("阅读视图");
    chooseView("只读源码");
    expect(reader.scrollTop).toBe(420);
    fireEvent.wheel(reader);
    reader.scrollTop = 610;
    fireEvent.scroll(reader);
    chooseTheme("暖白");
    expect(
      JSON.parse(localStorage.getItem("argus.preferences.v1")!).positions[
        doc.path
      ].source.top,
    ).toBe(610);
    result.unmount();
    render(<App />);
    await waitFor(() =>
      expect(document.querySelector("pre.source-view")).not.toBeNull(),
    );
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("快速打开时以最后一次请求为准", async () => {
    let resolveFirst: (value: typeof doc) => void = () => {};
    mocks.invoke.mockImplementation((cmd: string, args?: { path: string }) => {
      if (cmd === "take_pending_files") return Promise.resolve([]);
      if (args?.path === "/first.md")
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      return Promise.resolve({
        ...doc,
        path: "/second.md",
        name: "second.md",
        content: "# 第二份",
      });
    });
    render(<App />);
    await waitFor(() => expect(mocks.handlers.has("drop")).toBe(true));
    act(() => {
      mocks.handlers.get("drop")!({
        payload: { type: "drop", paths: ["/first.md"] },
      });
    });
    act(() => {
      mocks.handlers.get("drop")!({
        payload: { type: "drop", paths: ["/second.md"] },
      });
    });
    await screen.findByRole("heading", { name: "第二份" });
    await act(async () => resolveFirst(doc));
    expect(screen.queryByRole("heading", { name: "开始" })).toBeNull();
    expect(screen.getByRole("heading", { name: "第二份" })).toBeTruthy();
  });
  it("冷启动接收 Finder 文件，并从原生菜单切换视图", async () => {
    mocks.invoke.mockImplementation(async (cmd: string) =>
      cmd === "take_pending_files" ? [doc.path] : doc,
    );
    render(<App />);
    await screen.findByRole("heading", { name: "开始" });
    act(() => mocks.handlers.get("menu-action")!({ payload: "view" }));
    expect(document.querySelector(".source-view")?.textContent).toContain(
      "# 开始",
    );
  });
  it("存储不可用时展示提示，仍可继续阅读", async () => {
    const set = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("full");
      });
    render(<App />);
    fireEvent.click(screen.getByText("先读一读阅读指南"));
    const reader = screen.getByLabelText("Markdown 阅读区");
    fireEvent.wheel(reader);
    fireEvent.scroll(reader);
    expect(screen.getByRole("alert").textContent).toContain("无法保存阅读记录");
    expect(
      screen.getByRole("heading", { name: "把注意力，留给文字。" }),
    ).toBeTruthy();
    set.mockRestore();
  });
});

describe("阅读效率与历史恢复", () => {
  it("原生菜单打开文内搜索，定位后可用Esc清除标记", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("先读一读阅读指南"));
    act(() => mocks.handlers.get("menu-action")!({ payload: "find" }));
    const input = await screen.findByLabelText("查找内容");
    fireEvent.change(input, { target: { value: "Markdown" } });
    await waitFor(() =>
      expect(
        document.querySelectorAll("mark.reader-match").length,
      ).toBeGreaterThan(0),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(document.querySelector("mark.reader-match")).toBeNull();
  });
  it("重新读取同一篇含图表的文档后，搜索高亮同步重新定位", async () => {
    const content =
      "# 重复阅读\n\n重复正文\n\n```mermaid\nflowchart LR\nA-->B\n```";
    mocks.open.mockResolvedValue(doc.path);
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "take_pending_files"
        ? []
        : { ...doc, content, version: "same-version" },
    );
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "重复阅读" });
    act(() => mocks.handlers.get("menu-action")!({ payload: "find" }));
    fireEvent.change(await screen.findByLabelText("查找内容"), {
      target: { value: "重复" },
    });
    await waitFor(() =>
      expect(document.querySelectorAll("mark.reader-match").length).toBe(2),
    );
    const first = document
      .querySelector("[data-argus-diagram]")!
      .getAttribute("data-argus-diagram");
    act(() => mocks.handlers.get("menu-action")!({ payload: "reload" }));
    await waitFor(() =>
      expect(
        document
          .querySelector("[data-argus-diagram]")!
          .getAttribute("data-argus-diagram"),
      ).not.toBe(first),
    );
    await waitFor(() =>
      expect(document.querySelectorAll("mark.reader-match").length).toBe(2),
    );
  });
  it("排版立即应用，保存后重新打开仍保留字号、行距和宽度", async () => {
    const first = render(<App />);
    fireEvent.click(screen.getByText("先读一读阅读指南"));
    fireEvent.click(screen.getByRole("button", { name: "外观设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "排版" }));
    fireEvent.change(screen.getByRole("slider", { name: "正文字号" }), {
      target: { value: "22" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "阅读行距" }), {
      target: { value: "2.2" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "正文宽度" }), {
      target: { value: "920" },
    });
    expect(
      document
        .querySelector<HTMLElement>(".app")!
        .style.getPropertyValue("--reading-font-size"),
    ).toBe("22px");
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("argus.preferences.v1")!).reading,
      ).toEqual({ fontSize: 22, lineHeight: 2.2, width: 920 }),
    );
    first.unmount();
    render(<App />);
    expect(
      document
        .querySelector<HTMLElement>(".app")!
        .style.getPropertyValue("--reading-width"),
    ).toBe("920px");
    act(() => mocks.handlers.get("menu-action")!({ payload: "reading-reset" }));
    expect(
      document
        .querySelector<HTMLElement>(".app")!
        .style.getPropertyValue("--reading-font-size"),
    ).toBe("17px");
  });
  it("历史恢复需二次确认，冲突保留窗口与原文，重试成功重新读取", async () => {
    let content = "# 当前内容";
    let fail = true;
    mocks.open.mockResolvedValue(doc.path);
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "take_pending_files") return [];
      if (cmd === "read_document") return { ...doc, content, version: "v1" };
      if (cmd === "list_history")
        return [
          {
            id: "old",
            createdAt: 1700000000000,
            bytes: 20,
            version: "old",
            reason: "编辑前",
          },
        ];
      if (cmd === "preview_history") return { content: "# 最初版本" };
      if (cmd === "restore_history") {
        if (fail)
          throw { code: "conflict", message: "文件在外部已修改，未覆盖。" };
        content = "# 最初版本";
        return { version: "v2" };
      }
    });
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "当前内容" });
    act(() => mocks.handlers.get("menu-action")!({ payload: "history" }));
    await screen.findByText("# 最初版本");
    fireEvent.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(
      mocks.invoke.mock.calls.filter((c) => c[0] === "restore_history"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    await screen.findByText("文件在外部已修改，未覆盖。");
    expect(screen.getByRole("dialog", { name: "历史版本" })).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "恢复此版本" }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    await screen.findByRole("heading", { name: "最初版本" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith("restore_history", {
      path: doc.path,
      id: "old",
      expectedVersion: "v1",
    });
  });
});

describe("批量文件、阅读返回与文件操作", () => {
  it("多选、拖拽和Finder事件都打开全部指定文件，去重并保留失败明细", async () => {
    const files = new Map(
      ["a", "b", "c", "d", "e", "f"].map((name) => [
        `/${name}.md`,
        {
          path: `/${name}.md`,
          name: `${name}.md`,
          content: `# ${name.toUpperCase()}`,
          version: "v1",
        },
      ]),
    );
    let pending: string[] = [];
    mocks.invoke.mockImplementation(
      async (command: string, args?: { path?: string }) => {
        if (command === "take_pending_files") {
          const result = pending;
          pending = [];
          return result;
        }
        if (command === "read_document") {
          const path = args?.path === "/alias/a.md" ? "/a.md" : args?.path;
          const file = files.get(path ?? "");
          if (!file) throw "文件不存在";
          return { ...file };
        }
      },
    );
    mocks.open.mockResolvedValue([
      "/a.md",
      "/alias/a.md",
      "/b.md",
      "/missing.md",
      "/note.txt",
    ]);
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "B" });
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: true, directory: false }),
    );
    expect(screen.getAllByRole("button", { name: "查看 a.md" })).toHaveLength(
      1,
    );
    expect(screen.getByText("2 个文件未能打开")).toBeTruthy();
    expect(screen.getByText("/missing.md")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "查看 c.md" })).toBeNull();
    act(() =>
      mocks.handlers.get("drop")!({
        payload: { type: "drop", paths: ["/c.md", "/d.md"] },
      }),
    );
    await screen.findByRole("heading", { name: "D" });
    expect(screen.getByRole("button", { name: "查看 c.md" })).toBeTruthy();
    pending = ["/e.md", "/f.md"];
    act(() => mocks.handlers.get("files-opened")!({ payload: null }));
    await screen.findByRole("heading", { name: "F" });
    expect(screen.getByRole("button", { name: "查看 e.md" })).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /^查看 [abcdef]\.md$/ }),
    ).toHaveLength(6);
  });
  it("批量读取被新操作打断后，不复活旧文件或继续读取剩余项", async () => {
    let resolve!: (value: unknown) => void;
    mocks.open.mockResolvedValue(["/slow.md", "/never.md"]);
    mocks.invoke.mockImplementation(
      (command: string, args?: { path?: string }) =>
        command === "take_pending_files"
          ? Promise.resolve([])
          : command === "read_document" && args?.path === "/slow.md"
            ? new Promise((r) => {
                resolve = r;
              })
            : Promise.resolve(doc),
    );
    render(<App />);
    openFileFromMenu();
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    fireEvent.click(screen.getByText("先读一读阅读指南"));
    await act(async () =>
      resolve({ ...doc, path: "/slow.md", name: "slow.md", content: "# 迟到" }),
    );
    expect(screen.queryByRole("heading", { name: "迟到" })).toBeNull();
    expect(screen.queryByRole("button", { name: "查看 slow.md" })).toBeNull();
    expect(
      mocks.invoke.mock.calls.some(
        ([cmd, args]) => cmd === "read_document" && args.path === "/never.md",
      ),
    ).toBe(false);
  });
  it("连续文档链接可逐次返回原位置，文件失效时保留当前内容和返回记录", async () => {
    const files = new Map([
      ["/notes/a.md", "# A\n\n[下一篇](b.md)"],
      ["/notes/b.md", "# B\n\n[下一篇](c.md)"],
      ["/notes/c.md", "# C"],
    ]);
    mocks.open.mockResolvedValue("/notes/a.md");
    mocks.invoke.mockImplementation(
      async (command: string, args?: { path?: string }) => {
        if (command === "take_pending_files") return [];
        if (command === "read_document") {
          const path = args!.path!.startsWith("/")
            ? args!.path!
            : "/notes/" + args!.path;
          const content = files.get(path);
          if (!content) throw "文件不存在";
          return { path, name: path.split("/").at(-1), content, version: "v1" };
        }
      },
    );
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "A" });
    const reader = screen.getByRole("main");
    Object.defineProperties(reader, {
      scrollHeight: { configurable: true, value: 2600 },
      clientHeight: { configurable: true, value: 500 },
    });
    fireEvent.wheel(reader);
    reader.scrollTop = 320;
    fireEvent.scroll(reader);
    fireEvent.click(screen.getByRole("link", { name: "下一篇" }));
    await screen.findByRole("heading", { name: "B" });
    fireEvent.wheel(reader);
    reader.scrollTop = 510;
    fireEvent.scroll(reader);
    fireEvent.click(screen.getByRole("link", { name: "下一篇" }));
    await screen.findByRole("heading", { name: "C" });
    fireEvent.click(screen.getByRole("button", { name: "返回上一处" }));
    await screen.findByRole("heading", { name: "B" });
    expect(reader.scrollTop).toBe(510);
    files.delete("/notes/a.md");
    fireEvent.click(screen.getByRole("button", { name: "返回上一处" }));
    await screen.findByText("文件不存在");
    expect(screen.getByRole("heading", { name: "B" })).toBeTruthy();
    files.set("/notes/a.md", "# A\n\n[下一篇](b.md)");
    fireEvent.click(screen.getByRole("button", { name: "返回上一处" }));
    await screen.findByRole("heading", { name: "A" });
    expect(reader.scrollTop).toBe(320);
  });
  it("右键非当前文件时复制、Finder定位和关闭其他文档都针对该文件", async () => {
    const a = {
      path: "/notes/中文 空格.md",
      name: "中文 空格.md",
      content: "# A",
      version: "v1",
    };
    const b = {
      path: "/notes/b.md",
      name: "b.md",
      content: "# B",
      version: "v1",
    };
    const files = new Map([
      [a.path, a],
      [b.path, b],
    ]);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mocks.open.mockResolvedValue([a.path, b.path]);
    mocks.invoke.mockImplementation(
      async (cmd: string, args?: { path?: string }) =>
        cmd === "take_pending_files"
          ? []
          : cmd === "read_document"
            ? { ...files.get(args!.path!) }
            : undefined,
    );
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "B" });
    const openMenu = () =>
      fireEvent.contextMenu(
        screen.getByRole("button", { name: "查看 中文 空格.md" }),
        { clientX: 30, clientY: 100 },
      );
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "复制绝对路径" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(a.path));
    expect(screen.getByRole("heading", { name: "B" })).toBeTruthy();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "在 Finder 中显示" }));
    expect(mocks.invoke).toHaveBeenCalledWith("reveal_document", {
      path: a.path,
    });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "关闭其他文档" }));
    await screen.findByRole("heading", { name: "A" });
    expect(screen.queryByRole("button", { name: "查看 b.md" })).toBeNull();
    expect(files.get(b.path)?.content).toBe("# B");
  });
  it("普通图片可鼠标或键盘放大，关闭后保持阅读位置", async () => {
    mocks.open.mockResolvedValue(doc.path);
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "开始" });
    const reader = screen.getByRole("main");
    fireEvent.wheel(reader);
    reader.scrollTop = 260;
    fireEvent.scroll(reader);
    const image = screen.getByRole("button", { name: "放大图片：图" });
    fireEvent.click(image);
    expect(screen.getByRole("dialog", { name: "图" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭图片" }));
    expect(reader.scrollTop).toBe(260);
    fireEvent.keyDown(image, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "图" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it("关闭批量中已读取的最后成功项，后续失败不能把它重新加入", async () => {
  let reject!: (reason: unknown) => void;
  mocks.open.mockResolvedValue(["/a.md", "/b.md", "/slow.md"]);
  mocks.invoke.mockImplementation(
    (command: string, args?: { path?: string }) => {
      if (command === "take_pending_files") return Promise.resolve([]);
      if (command === "read_document" && args?.path === "/slow.md")
        return new Promise((_r, j) => {
          reject = j;
        });
      return Promise.resolve({
        ...doc,
        path: args?.path,
        name: args?.path?.split("/").at(-1),
        content: args?.path === "/a.md" ? "# A" : "# B",
      });
    },
  );
  render(<App />);
  fireEvent.click(screen.getByText("先读一读阅读指南"));
  openFileFromMenu();
  await screen.findByRole("button", { name: "查看 b.md" });
  await waitFor(() => expect(reject).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "关闭 b.md" }));
  await act(async () => reject("外部读取失败"));
  expect(screen.queryByRole("button", { name: "查看 b.md" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "B" })).toBeNull();
  expect(screen.getByRole("button", { name: "查看 a.md" })).toBeTruthy();
});

it("阅读位置按最近使用淘汰，重新阅读旧文档不会丢掉刚保存的位置", async () => {
  const oldest = "/notes/0.md";
  localStorage.setItem(
    "argus.preferences.v1",
    JSON.stringify({
      lastPath: oldest,
      positions: Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          `/notes/${i}.md`,
          { render: { top: i, ratio: 0 } },
        ]),
      ),
    }),
  );
  mocks.invoke.mockImplementation(
    async (cmd: string, args: Record<string, unknown> = {}) =>
      cmd === "read_document"
        ? {
            path: args.path,
            name: String(args.path).split("/").pop(),
            content: "# 测试",
          }
        : [],
  );
  render(<App />);
  await screen.findByRole("heading", { name: "测试" });
  const reader = screen.getByLabelText("Markdown 阅读区");
  Object.defineProperties(reader, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 600 },
  });
  fireEvent.wheel(reader);
  reader.scrollTop = 520;
  fireEvent.scroll(reader);
  mocks.open.mockResolvedValue("/notes/new.md");
  openFileFromMenu();
  await screen.findByRole("button", { name: "查看 new.md" });
  fireEvent.wheel(reader);
  reader.scrollTop = 200;
  fireEvent.scroll(reader);
  const positions = JSON.parse(
    localStorage.getItem("argus.preferences.v1")!,
  ).positions;
  expect(Object.keys(positions)).toHaveLength(100);
  expect(positions[oldest]?.render.top).toBe(520);
  expect(positions["/notes/1.md"]).toBeUndefined();
});

it("文件菜单打开快速切换后，取消保留同一个入口并恢复键盘焦点", async () => {
  mocks.open.mockResolvedValue(doc.path);
  render(<App />);
  openFileFromMenu();
  await screen.findByRole("heading", { name: "开始" });
  const trigger = screen.getByRole("button", { name: "文件" });
  trigger.focus();
  fireEvent.click(trigger);
  const item = screen.getByRole("menuitem", { name: /快速切换文档/ });
  item.focus();
  fireEvent.click(item);
  await screen.findByRole("dialog", { name: "快速切换文档" });
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("button", { name: "文件" })).toBe(trigger);
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole("menu", { name: "文件菜单" })).toBeNull();
});

it.each(["切换其他文档", "重新读取同一文档", "保持当前文档"])(
  "章节定位迟到遇到%s时，只对仍有效的链接到达执行",
  async (kind) => {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const files = new Map([
      ["/notes/a.md", "# A\n\n[去目标章节](b.md#目标)"],
      ["/notes/b.md", "# B\n\n## 目标\n\nB正文"],
      ["/notes/c.md", "# C\n\n## 目标\n\nC正文"],
    ]);
    mocks.invoke.mockImplementation(
      async (command: string, args?: { path?: string }) => {
        if (command === "take_pending_files") return [];
        if (command === "read_document") {
          const path = args!.path!.startsWith("/")
            ? args!.path!
            : "/notes/" + args!.path;
          return {
            path,
            name: path.split("/").at(-1),
            content: files.get(path),
            version: "v1",
          };
        }
      },
    );
    mocks.open
      .mockResolvedValueOnce("/notes/a.md")
      .mockResolvedValueOnce("/notes/c.md");
    render(<App />);
    openFileFromMenu();
    await screen.findByRole("heading", { name: "A" });
    fireEvent.click(screen.getByRole("link", { name: "去目标章节" }));
    await screen.findByRole("heading", { name: "B" });
    if (kind === "切换其他文档") {
      openFileFromMenu();
      await screen.findByRole("heading", { name: "C" });
    } else if (kind === "重新读取同一文档") {
      files.set("/notes/b.md", "# B2\n\n## 目标\n\n重新读取内容");
      fireEvent.click(screen.getByRole("button", { name: "重新读取文件" }));
      await screen.findByRole("heading", { name: "B2" });
    }
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    await act(async () => {
      for (let i = 0; i < 5; i++) {
        const batch = [...frames.values()];
        frames.clear();
        for (const callback of batch) callback(performance.now());
        await Promise.resolve();
      }
    });
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(
      kind === "保持当前文档" ? 1 : 0,
    );
    expect(
      screen.getByRole("heading", {
        name:
          kind === "切换其他文档"
            ? "C"
            : kind === "重新读取同一文档"
              ? "B2"
              : "B",
      }),
    ).toBeTruthy();
  },
);
