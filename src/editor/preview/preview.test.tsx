// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { undoDepth } from "@codemirror/commands";
import EditorWorkspace from "./EditorWorkspace";
import {
  constrainRatio,
  defaultPreview,
  readPreviewSettings,
} from "./settings";
import { interpolate } from "./scroll";
import { loadPreferences, savePreferences } from "../../storage";
import type { MarkdownEditorHandle } from "../MarkdownEditor";
vi.mock("../../diagrams/useMermaid", () => ({ useMermaid: vi.fn() }));
let width = 1100;
let handle: MarkdownEditorHandle | null = null;
beforeEach(() => {
  localStorage.clear();
  width = 1100;
  handle = null;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener() {},
    removeListener() {},
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
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return new DOMRect(
        0,
        0,
        this.classList.contains("editor-workspace") ? width : 0,
        600,
      );
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Harness() {
  const [text, setText] = useState("# 原稿\n\n正文");
  const [preview, setPreview] = useState({ ...defaultPreview, enabled: true });
  return (
    <>
      <button
        onClick={() => setPreview((p) => ({ ...p, enabled: !p.enabled }))}
      >
        切换预览
      </button>
      <EditorWorkspace
        path="/notes/preview.md"
        theme="light"
        preview={preview}
        onPreviewChange={setPreview}
        content={text}
        onChange={setText}
        onSave={vi.fn()}
        onReady={(h) => {
          handle = h;
        }}
        onExpand={vi.fn()}
        onArticleClick={vi.fn()}
      />
    </>
  );
}
it("缺省与损坏设置可恢复，比例/开关保存后能读回", () => {
  expect(readPreviewSettings(null)).toEqual(defaultPreview);
  expect(
    readPreviewSettings({ enabled: "yes", ratio: Infinity, sync: false }),
  ).toEqual({ ...defaultPreview, sync: false });
  const p = loadPreferences();
  p.editorPreview = { enabled: true, ratio: 0.62, sync: false };
  expect(savePreferences(p)).toBe(true);
  expect(loadPreferences().editorPreview).toEqual(p.editorPreview);
  expect(readPreviewSettings({ ratio: 9 }).ratio).toBe(0.7);
  expect(constrainRatio(0.3, 800)).toBeGreaterThanOrEqual(260 / 791);
});
it("按源码段落做双向位置映射，空白间隔和范围外不会产生NaN", () => {
  const points = [
    { line: 0, top: 0 },
    { line: 10, top: 400 },
    { line: 20, top: 1200 },
  ];
  expect(interpolate(points, 15, "line")).toBe(800);
  expect(interpolate(points, 800, "top")).toBe(15);
  expect(interpolate(points, -20, "line")).toBe(0);
  expect(interpolate(points, 999, "line")).toBe(1200);
  expect(interpolate([], 50, "top")).toBe(0);
});
it("预览直接显示新输入并清理危险HTML，开关不重建编辑器或丢失撤销与选区", async () => {
  render(<Harness />);
  const node = screen.getByLabelText("Markdown 编辑器");
  act(() => {
    handle!.jumpToLine(1);
    handle!.insert("# 新输入\n\n<script>window.bad=1</script>\n\n");
  });
  const before = handle!.capture!(),
    depth = undoDepth(before.state);
  const preview = screen.getByRole("region", { name: "实时 Markdown 预览" });
  await within(preview).findByRole("heading", { name: "新输入" });
  expect(preview.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "切换预览" }));
  expect(
    screen.queryByRole("region", { name: "实时 Markdown 预览" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "切换预览" }));
  expect(screen.getByLabelText("Markdown 编辑器")).toBe(node);
  expect(handle!.capture!().state.selection.main).toEqual(
    before.state.selection.main,
  );
  expect(undoDepth(handle!.capture!().state)).toBe(depth);
  expect(handle!.capture!().state.doc.toString()).toContain("新输入");
});
it("窄窗口编辑/预览单独显示，但编辑器与输入持续保留", async () => {
  width = 600;
  render(<Harness />);
  const node = screen.getByLabelText("Markdown 编辑器");
  act(() => handle!.insert("窄窗输入\n\n"));
  fireEvent.click(screen.getByRole("tab", { name: "预览" }));
  expect(node.isConnected).toBe(true);
  expect(node.closest("section")!.hidden).toBe(true);
  await within(
    screen.getByRole("region", { name: "实时 Markdown 预览" }),
  ).findByText("窄窗输入");
  fireEvent.click(screen.getByRole("tab", { name: "编辑" }));
  expect(screen.getByLabelText("Markdown 编辑器")).toBe(node);
  expect(node.closest("section")!.hidden).toBe(false);
  expect(handle!.capture!().state.doc.toString()).toContain("窄窗输入");
});
it("分隔条支持键盘调节并限制最小宽度，双击可恢复对半", () => {
  render(<Harness />);
  const divider = screen.getByRole("separator", { name: "调整编辑和预览宽度" });
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(divider.getAttribute("aria-valuenow")).toBe("52");
  fireEvent.keyDown(divider, { key: "End" });
  expect(Number(divider.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(70);
  fireEvent.doubleClick(divider);
  expect(divider.getAttribute("aria-valuenow")).toBe("50");
});

it("窄窗预览里发起查找和大纲定位，会先显示编辑器并顺序执行定位与聚焦", () => {
  width = 600;
  render(<Harness />);
  fireEvent.click(screen.getByRole("tab", { name: "预览" }));
  act(() => handle!.find());
  expect(
    screen.getByRole("tab", { name: "编辑" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(document.querySelector(".cm-search")).not.toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "预览" }));
  act(() => {
    handle!.jumpToLine(3);
    handle!.focus();
  });
  const state = handle!.capture!().state;
  expect(state.selection.main.head).toBe(state.doc.line(3).from);
  expect(
    screen.getByLabelText("Markdown 编辑器").closest("section")!.hidden,
  ).toBe(false);
});
