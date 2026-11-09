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
import DocumentSearch from "./DocumentSearch";
import { useDocumentSearch } from "./useDocumentSearch";
import type { SearchResults } from "./useDocumentSearch";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
const result = (word: string): SearchResults => ({
  hits: [
    {
      path: "/a.md",
      name: "a.md",
      version: "v1",
      line: 3,
      column: 0,
      length: word.length,
      matched: word,
      before: "",
      after: " context",
      buffer: true,
    },
  ],
  failures: [],
  searched: 1,
  total: 1,
  truncated: false,
  cancelled: false,
});
beforeEach(() => {
  vi.useFakeTimers();
  mock.invoke.mockReset();
  mock.invoke.mockResolvedValue(result("needle"));
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("旧搜索可取消且串行，只执行最新排队请求，不显示迟到结果", async () => {
  const resolves: ((r: SearchResults) => void)[] = [];
  mock.invoke.mockImplementation((command: string) =>
    command === "search_documents"
      ? new Promise<SearchResults>((resolve) => resolves.push(resolve))
      : Promise.resolve(),
  );
  const paths = ["/a.md"];
  const view = renderHook(
    ({ query }) => useDocumentSearch(paths, undefined, query),
    { initialProps: { query: "old" } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(230);
  });
  view.rerender({ query: "next" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(230);
  });
  view.rerender({ query: "last" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(230);
  });
  expect(
    mock.invoke.mock.calls.filter(([c]) => c === "search_documents"),
  ).toHaveLength(1);
  expect(
    mock.invoke.mock.calls.some(([c]) => c === "cancel_document_search"),
  ).toBe(true);
  await act(async () => resolves[0](result("old")));
  expect(view.result.current.result.hits).toHaveLength(0);
  expect(
    mock.invoke.mock.calls.filter(([c]) => c === "search_documents").at(-1)?.[1]
      .query,
  ).toBe("last");
  await act(async () => resolves[1](result("last")));
  expect(view.result.current.result.hits[0].matched).toBe("last");
  expect(view.result.current.loading).toBe(false);
});
it("改变当前缓冲区会重新搜索，卸载后取消未完成工作", async () => {
  const paths = ["/a.md"];
  const view = renderHook(
    ({ text }) =>
      useDocumentSearch(
        paths,
        { path: "/a.md", text, version: "v1" },
        "needle",
      ),
    { initialProps: { text: "needle draft" } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(230);
  });
  expect(mock.invoke).toHaveBeenCalledWith(
    "search_documents",
    expect.objectContaining({
      buffer: expect.objectContaining({ text: "needle draft" }),
    }),
  );
  mock.invoke.mockImplementation((cmd: string) =>
    cmd === "search_documents" ? new Promise(() => {}) : Promise.resolve(),
  );
  view.rerender({ text: "changed needle" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(230);
  });
  view.unmount();
  expect(mock.invoke.mock.calls.at(-1)?.[0]).toBe("cancel_document_search");
});
it("组字Enter/Esc与尾随提交不选择结果，普通Enter可定位，关闭按钮不误选", async () => {
  const choose = vi.fn(),
    close = vi.fn();
  render(
    <DocumentSearch paths={["/a.md"]} onClose={close} onChoose={choose} />,
  );
  const input = screen.getByLabelText("搜索已打开文档的内容");
  fireEvent.change(input, { target: { value: "needle" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(230);
  });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
  expect(choose).not.toHaveBeenCalled();
  fireEvent.compositionStart(input);
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(choose).not.toHaveBeenCalled();
  fireEvent.keyUp(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(choose).toHaveBeenCalledOnce();
  choose.mockClear();
  const button = screen.getByLabelText("关闭文档搜索");
  button.focus();
  fireEvent.keyDown(button, { key: "Enter" });
  expect(choose).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});

it("过大缓冲区在传给原生层之前拦截，避免无界复制并保留输入", async () => {
  const text = "x".repeat(16 * 1024 * 1024 + 1);
  const view = renderHook(() =>
    useDocumentSearch(
      ["/a.md"],
      { path: "/a.md", text, version: "v1" },
      "needle",
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(230);
  });
  expect(view.result.current.error).toContain("当前内容超过16 MB");
  expect(
    mock.invoke.mock.calls.some(([cmd]) => cmd === "search_documents"),
  ).toBe(false);
});
