// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MermaidViewer from "./MermaidViewer";
vi.mock("./engine", () => ({
  renderDiagram: async () =>
    '<svg viewBox="0 0 800 600"><rect width="80" height="40" /></svg>',
  diagramError: String,
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("图表操作后焦点退回页面时Esc仍关闭，关闭后恢复焦点且清理监听", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const focus = vi.spyOn(trigger, "focus");
  const close = vi.fn();
  const view = render(
    <MermaidViewer
      source="flowchart TD; A-->B"
      theme="light"
      onClose={close}
    />,
  );
  await waitFor(() =>
    expect(
      (screen.getByLabelText("放大图表") as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByLabelText("放大图表"));
  (document.activeElement as HTMLElement)?.blur();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  trigger.remove();
});
it("图表重渲染保留焦点并使用最新关闭回调", async () => {
  const oldClose = vi.fn(),
    newClose = vi.fn();
  const view = render(
    <MermaidViewer
      source="flowchart TD; A-->B"
      theme="light"
      onClose={oldClose}
    />,
  );
  await waitFor(() =>
    expect(
      (screen.getByLabelText("图表适应窗口") as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  const fit = screen.getByLabelText("图表适应窗口");
  fit.focus();
  view.rerender(
    <MermaidViewer
      source="flowchart TD; A-->B"
      theme="light"
      onClose={newClose}
    />,
  );
  expect(document.activeElement).toBe(fit);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(newClose).toHaveBeenCalledOnce();
  expect(oldClose).not.toHaveBeenCalled();
});
