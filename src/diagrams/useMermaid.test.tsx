// @vitest-environment jsdom
import { useMemo, useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "../markdown";
const mock = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("./engine", async (original) => ({
  ...(await original<typeof import("./engine")>()),
  renderDiagram: mock.render,
}));
import { useMermaid } from "./useMermaid";
const expand = vi.fn(),
  layout = vi.fn();
const source = "```mermaid\nflowchart TD\nA[中文入口]-->B[成功]\n```";
function Harness({
  text = source,
  theme = "light",
  enabled = true,
}: {
  text?: string;
  theme?: "light" | "dark";
  enabled?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const doc = useMemo(() => renderMarkdown(text), [text]);
  useMermaid(root, doc.diagrams, theme, enabled, expand, layout);
  return <article ref={root} dangerouslySetInnerHTML={{ __html: doc.html }} />;
}
beforeEach(() => {
  mock.render.mockReset();
  mock.render.mockResolvedValue(
    '<svg viewBox="0 0 600 400" role="img"><text>图已生成</text></svg>',
  );
  expand.mockReset();
  layout.mockReset();
});
afterEach(cleanup);
describe("图表阅读流程", () => {
  it("绘制成功后可通过按钮和键盘放大，源码仍可查阅", async () => {
    render(<Harness />);
    await screen.findByText("图已生成");
    const stage = screen.getByRole("button", { name: "点击放大 Mermaid 图表" });
    fireEvent.keyDown(stage, { key: "Enter" });
    expect(expand).toHaveBeenCalledWith(expect.stringContaining("中文入口"));
    fireEvent.click(screen.getByRole("button", { name: "放大 Mermaid 图表" }));
    expect(expand).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector(".mermaid-source code")?.textContent,
    ).toContain("flowchart TD");
  });
  it("解析失败明确提示并展开原始源码", async () => {
    mock.render.mockRejectedValue(new Error("Parse error on line 2"));
    render(<Harness />);
    expect((await screen.findByRole("alert")).textContent).toContain("line 2");
    expect(document.querySelector<HTMLDetailsElement>("details")?.open).toBe(
      true,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "放大 Mermaid 图表",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("切换文档后迟到的旧SVG不会污染新正文", async () => {
    let resolve!: (svg: string) => void;
    mock.render
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue("<svg><text>新图</text></svg>");
    const view = render(<Harness />);
    await waitFor(() => expect(mock.render).toHaveBeenCalled());
    view.rerender(<Harness text={"```mermaid\nflowchart TD\nX-->Y\n```"} />);
    await screen.findByText("新图");
    await act(async () => resolve("<svg><text>旧图</text></svg>"));
    expect(screen.queryByText("旧图")).toBeNull();
    expect(screen.getByText("新图")).toBeTruthy();
  });
  it("主题变化会重绘；普通文档和非阅读状态不启动绘图", async () => {
    const view = render(<Harness />);
    await screen.findByText("图已生成");
    view.rerender(<Harness theme="dark" />);
    await waitFor(() =>
      expect(mock.render).toHaveBeenCalledWith(
        expect.any(String),
        "dark",
        expect.any(Function),
      ),
    );
    cleanup();
    mock.render.mockClear();
    render(<Harness text="# 普通文章" />);
    expect(mock.render).not.toHaveBeenCalled();
    cleanup();
    render(<Harness enabled={false} />);
    expect(mock.render).not.toHaveBeenCalled();
  });
});
