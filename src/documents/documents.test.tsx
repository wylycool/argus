// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDocumentTransitions } from "./useTransitions";
import QuickSwitcher from "./QuickSwitcher";
import HistoryDiff from "./HistoryDiff";
import ReadOnlyDialog from "../workspace/ReadOnlyDialog";
import HistoryDialog from "../reader/HistoryDialog";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mock.invoke.mockReset();
});
afterEach(cleanup);
it("快速切换去重、区分同名目录、支持键盘与失焦Esc", () => {
  const choose = vi.fn(),
    close = vi.fn();
  render(
    <QuickSwitcher
      paths={["/alpha/笔记.md", "/beta/笔记.md", "/alpha/笔记.md"]}
      onChoose={choose}
      onClose={close}
    />,
  );
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(screen.getByText("/alpha")).toBeTruthy();
  expect(screen.getByText("/beta")).toBeTruthy();
  const input = screen.getByLabelText("搜索文档");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(choose).toHaveBeenCalledWith("/beta/笔记.md");
  fireEvent.change(input, { target: { value: "alpha" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});
it("历史对比区分新增与删除，过大内容回退源码", () => {
  const view = render(
    <HistoryDiff previous={"原有\n删除\n"} current={"原有\n新增\n"} />,
  );
  expect(screen.getByText("新增")).toBeTruthy();
  expect(document.querySelector(".diff-chunk.added")?.textContent).toContain(
    "新增",
  );
  expect(document.querySelector(".diff-chunk.removed")?.textContent).toContain(
    "删除",
  );
  view.rerender(<HistoryDiff previous={"a".repeat(1_000_001)} current="b" />);
  expect(screen.getByText(/内容较长或差异过多/)).toBeTruthy();
});
it("清理历史需要确认，失败保留窗口；重试只清本文历史", async () => {
  let entries = [
    {
      id: "1-abcd",
      createdAt: 1700000000000,
      bytes: 20,
      version: "old",
      reason: "编辑前",
    },
  ];
  let fail = true;
  mock.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "list_history") return entries;
    if (cmd === "preview_history") return { content: "历史正文\n" };
    if (cmd === "history_usage")
      return {
        totalBytes: 100,
        documentBytes: 20,
        documentVersions: entries.length,
        totalVersions: 2,
      };
    if (cmd === "clear_history") {
      if (fail) throw { message: "清理失败" };
      entries = [];
    }
  });
  render(
    <HistoryDialog
      path="/notes/a.md"
      name="a.md"
      version="v1"
      currentContent={"当前正文\n"}
      onClose={vi.fn()}
      onRestored={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );
  await screen.findByText("历史正文");
  expect(screen.getByText("当前正文")).toBeTruthy();
  fireEvent.click(screen.getByText("管理历史"));
  await screen.findByText(/本文 1 个版本/);
  fireEvent.click(screen.getByText("清理本文历史"));
  expect(mock.invoke.mock.calls.some(([cmd]) => cmd === "clear_history")).toBe(
    false,
  );
  fireEvent.click(screen.getByText("确认清理"));
  await screen.findByText("清理失败");
  expect(screen.getByRole("dialog")).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByText("确认清理"));
  await screen.findByText("还没有历史版本");
  expect(mock.invoke).toHaveBeenCalledWith("clear_history", {
    path: "/notes/a.md",
    id: null,
  });
});

it("打印长图完整缩放到纸面，保留最后节点和原始viewBox", async () => {
  const { fitPrintDiagrams } = await import("./print");
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="mermaid-stage"><svg viewBox="0 0 500 1600"><text>最后一个节点</text></svg></div>';
  fitPrintDiagrams(root);
  const svg = root.querySelector("svg")!;
  expect(svg.style.height).toBe("720px");
  expect(svg.style.width).toBe("225px");
  expect(svg.getAttribute("viewBox")).toBe("0 0 500 1600");
  expect(svg.textContent).toContain("最后一个节点");
});

it("中文组字期间不拦截Enter、方向键和Esc，提交尾随Enter也不会误开", () => {
  const choose = vi.fn(),
    close = vi.fn();
  render(
    <QuickSwitcher
      paths={["/a/笔记.md", "/b/笔记.md"]}
      onChoose={choose}
      onClose={close}
    />,
  );
  const input = screen.getByLabelText("搜索文档");
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "笔记" } });
  const down = new KeyboardEvent("keydown", {
    key: "ArrowDown",
    bubbles: true,
    cancelable: true,
    isComposing: true,
  });
  fireEvent(input, down);
  expect(down.defaultPrevented).toBe(false);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  expect(choose).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter", isComposing: false });
  expect(choose).not.toHaveBeenCalled();
  fireEvent.keyUp(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(choose).toHaveBeenCalledWith("/b/笔记.md");
});
it("WebKit的229按键即使没有组合状态也不提交快速切换", () => {
  const choose = vi.fn();
  render(
    <QuickSwitcher
      paths={["/文档/笔记.md"]}
      onChoose={choose}
      onClose={vi.fn()}
    />,
  );
  fireEvent.keyDown(screen.getByLabelText("搜索文档"), {
    key: "Enter",
    keyCode: 229,
  });
  expect(choose).not.toHaveBeenCalled();
});
it("阅读与打印共用锚点解析，支持编码、重复标题、自定义ID且不改SVG", async () => {
  const { renderMarkdown } = await import("../markdown");
  const { createAnchorResolver, prefixPrintAnchors } =
    await import("./anchors");
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(
    '# 文档\n\n[中文](#%E5%B0%8F%E8%8A%82) [重复](#小节-1) [自定义](#custom-id) [百分号](#%2520)\n\n## 小节\n\n## 小节\n\n<div id="custom-id">定制</div>\n<div id="%20">百分号ID</div>',
  ).html;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "diagram-id";
  root.append(svg);
  expect(createAnchorResolver(root)("%E5%B0%8F%E8%8A%82")?.id).toBe(
    "argus-heading-小节",
  );
  const duplicate = createAnchorResolver(root)("小节-1")!;
  prefixPrintAnchors(root);
  for (const link of root.querySelectorAll("a")) {
    const target = decodeURIComponent(link.getAttribute("href")!.slice(1));
    expect(
      Array.from(root.querySelectorAll("[id]")).some((e) => e.id === target),
    ).toBe(true);
  }
  expect(root.querySelector("svg")?.id).toBe("diagram-id");
  expect(root.contains(duplicate)).toBe(true);
  expect(
    decodeURIComponent(
      root.querySelectorAll("a")[1].getAttribute("href")!.slice(1),
    ),
  ).toBe(duplicate.id);
  for (const node of root.querySelectorAll<HTMLElement>("[id]"))
    if (!node.closest("svg")) expect(node.id).toMatch(/^[a-zA-Z0-9-]+$/);
});

it("快速切换候选异步减少后，选择仍有效且Enter可打开", () => {
  const choose = vi.fn();
  const view = render(
    <QuickSwitcher
      paths={["/a.md", "/b.md", "/c.md"]}
      onChoose={choose}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByLabelText("搜索文档");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  view.rerender(
    <QuickSwitcher paths={["/a.md"]} onChoose={choose} onClose={vi.fn()} />,
  );
  fireEvent.keyDown(input, { key: "Enter" });
  expect(choose).toHaveBeenCalledWith("/a.md");
});
it("快速切换关闭按钮获得焦点时，Enter不能打开候选文档", () => {
  const choose = vi.fn();
  render(
    <QuickSwitcher paths={["/a.md"]} onChoose={choose} onClose={vi.fn()} />,
  );
  const close = screen.getByRole("button", { name: "关闭快速切换" });
  close.focus();
  fireEvent.keyDown(close, { key: "Enter" });
  expect(choose).not.toHaveBeenCalled();
});

it("快速切换异步重排后保持用户已选中的文件身份", () => {
  const choose = vi.fn();
  const view = render(
    <QuickSwitcher
      paths={["/a.md", "/b.md", "/c.md"]}
      onChoose={choose}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByLabelText("搜索文档");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  view.rerender(
    <QuickSwitcher
      paths={["/c.md", "/a.md", "/b.md"]}
      onChoose={choose}
      onClose={vi.fn()}
    />,
  );
  fireEvent.keyDown(input, { key: "Enter" });
  expect(choose).toHaveBeenCalledWith("/b.md");
});
it("旧请求结束不能解锁新请求，同请求仍需全部任务完成", () => {
  const request = { current: 0 };
  const { result } = renderHook(() => useDocumentTransitions(request));
  let old!: () => void, newOne!: () => void, newTwo!: () => void;
  act(() => {
    old = result.current.hold();
  });
  expect(result.current.transitioning).toBe(true);
  act(() => {
    result.current.nextRequest();
  });
  expect(result.current.transitioning).toBe(false);
  act(() => {
    newOne = result.current.hold();
    newTwo = result.current.hold();
  });
  act(() => old());
  expect(result.current.transitioning).toBe(true);
  act(() => newOne());
  expect(result.current.transitioning).toBe(true);
  act(() => newTwo());
  expect(result.current.transitioning).toBe(false);
});

it("只读提示焦点退回body后Esc仍可取消，组字期间不误关", () => {
  const close = vi.fn();
  render(<ReadOnlyDialog name="只读.md" onCancel={close} onCopy={vi.fn()} />);
  fireEvent.keyDown(document.body, { key: "Escape", isComposing: true });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});

it("打印标题与第一段保持同组，保留锚点、顺序和原始文本", async () => {
  const { groupPrintHeadings } = await import("./print");
  const root = document.createElement("article");
  root.innerHTML =
    '<h1 id="title">标题</h1>\n<h2 id="section">小节</h2>\n<p>第一段<a href="#section">返回</a></p><p>第二段</p><h2 id="tail">尾节</h2>原始文字<p>尾段</p>';
  const text = root.textContent;
  const heading = root.querySelector("#section");
  groupPrintHeadings(root);
  expect(root.textContent).toBe(text);
  expect(root.querySelector("#section")).toBe(heading);
  expect(heading?.parentElement?.contains(root.querySelector("p"))).toBe(true);
  expect(heading?.parentElement?.contains(root.querySelectorAll("p")[1])).toBe(
    false,
  );
  expect(root.querySelector("a")?.getAttribute("href")).toBe("#section");
  expect(root.querySelector("#tail")?.parentElement?.textContent).toBe(
    "尾节原始文字",
  );
});
