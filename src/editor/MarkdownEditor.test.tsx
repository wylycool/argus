// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { undoDepth } from "@codemirror/commands";
import MarkdownEditor from "./MarkdownEditor";
import type { MarkdownEditorHandle } from "./MarkdownEditor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("首次保存重建真实编辑器后保留光标与撤销记录，并绑定新的输入回调", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  let handle: MarkdownEditorHandle | null = null;
  const oldChange = vi.fn(),
    newChange = vi.fn();
  const first = render(
    <MarkdownEditor
      content={"# 标题\n\n"}
      onChange={oldChange}
      onSave={vi.fn()}
      onReady={(value) => {
        handle = value;
      }}
    />,
  );
  act(() => {
    handle!.jumpToLine(3);
    handle!.insert("原有输入");
  });
  const saved = handle!.capture!();
  const oldDepth = undoDepth(saved.state);
  expect(oldDepth).toBeGreaterThan(0);
  first.unmount();
  render(
    <MarkdownEditor
      content={saved.state.doc.toString()}
      resume={saved}
      onChange={newChange}
      onSave={vi.fn()}
      onReady={(value) => {
        handle = value;
      }}
    />,
  );
  expect(handle!.capture!().state.selection.main).toEqual(
    saved.state.selection.main,
  );
  expect(undoDepth(handle!.capture!().state)).toBe(oldDepth);
  act(() => handle!.insert("继续输入"));
  expect(handle!.capture!().state.doc.toString()).toBe(
    "# 标题\n\n原有输入继续输入",
  );
  expect(newChange).toHaveBeenLastCalledWith("# 标题\n\n原有输入继续输入");
  expect(oldChange).toHaveBeenCalledTimes(1);
});
