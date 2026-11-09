// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePreviewScroll } from "../usePreviewScroll";
it("隐藏编辑器前记录位置，显示预览后用记录对齐，不读写隐藏布局", () => {
  const viewport = document.createElement("div"),
    article = document.createElement("article");
  viewport.append(article);
  document.body.append(viewport);
  Object.defineProperties(viewport, {
    clientHeight: { value: 500 },
    scrollHeight: { value: 3000 },
  });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 500, 500);
  for (const line of [10, 20]) {
    const heading = document.createElement("h2");
    heading.dataset.argusLine = String(line);
    heading.getBoundingClientRect = () =>
      new DOMRect(0, line * 100 - viewport.scrollTop, 500, 30);
    article.append(heading);
  }
  const getScrollPosition = vi.fn(() => ({ line: 10, fraction: 0 }));
  const scrollToSource = vi.fn();
  const e = {
    current: {
      getScrollPosition,
      scrollToSource,
      focus() {},
      jumpToLine() {},
      find() {},
      insert() {},
    },
  };
  const v = { current: viewport },
    a = { current: article };
  const hook = renderHook(
    ({ visible }) => usePreviewScroll(e, v, a, 30, true, visible),
    { initialProps: { visible: true } },
  );
  act(() => hook.result.current.captureEditor());
  hook.rerender({ visible: false });
  getScrollPosition.mockReturnValue({ line: 0, fraction: 0 });
  act(() => hook.result.current.alignPreview());
  expect(viewport.scrollTop).toBe(1000);
  expect(getScrollPosition).toHaveBeenCalledTimes(1);
  act(() => {
    hook.result.current.claimPreview();
    viewport.scrollTop = 1500;
    hook.result.current.previewScroll();
  });
  expect(scrollToSource).not.toHaveBeenCalled();
  expect(hook.result.current.takePreviewPosition()).toEqual({
    line: 15,
    fraction: 0,
  });
  expect(hook.result.current.takePreviewPosition()).toBeNull();
  expect(hook.result.current.capturePreview()).toEqual({
    line: 15,
    fraction: 0,
  });
  hook.rerender({ visible: true });
  act(() => hook.result.current.previewScroll());
  expect(scrollToSource).toHaveBeenLastCalledWith({ line: 15, fraction: 0 });
  hook.unmount();
  viewport.remove();
});
afterEach(cleanup);

it("新编辑位置取代旧预览记录，之后隐藏再显示编辑器不复活旧到达", () => {
  const viewport = document.createElement("div"),
    article = document.createElement("article");
  viewport.append(article);
  document.body.append(viewport);
  Object.defineProperties(viewport, {
    clientHeight: { value: 500 },
    scrollHeight: { value: 3000 },
  });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 500, 500);
  const e = {
    current: {
      getScrollPosition: () => ({ line: 5, fraction: 0 }),
      scrollToSource: vi.fn(),
      focus() {},
      jumpToLine() {},
      find() {},
      insert() {},
    },
  };
  const hook = renderHook(
    ({ visible }) =>
      usePreviewScroll(
        e,
        { current: viewport },
        { current: article },
        30,
        true,
        visible,
      ),
    { initialProps: { visible: true } },
  );
  act(() => {
    hook.result.current.claimPreview();
    viewport.scrollTop = 1500;
    hook.result.current.previewScroll();
  });
  expect(e.current.scrollToSource).toHaveBeenLastCalledWith({
    line: 15,
    fraction: 0,
  });
  act(() => {
    hook.result.current.claimEditor();
    hook.result.current.editorScroll({ line: 5, fraction: 0 });
  });
  expect(viewport.scrollTop).toBe(500);
  hook.rerender({ visible: false });
  hook.rerender({ visible: true });
  expect(hook.result.current.takePreviewPosition()).toBeNull();
  hook.unmount();
  viewport.remove();
});
