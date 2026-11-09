// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PreviewDocument from "./PreviewDocument";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: api.invoke,
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));
vi.mock("../../diagrams/useMermaid", () => ({ useMermaid: vi.fn() }));
beforeEach(() => {
  api.invoke.mockReset();
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
function Document() {
  const ref = useRef<HTMLElement>(null);
  return (
    <PreviewDocument
      text="![本地图片](assets/新图.svg)"
      path="/notes/文档.md"
      theme="light"
      active
      articleRef={ref}
      onExpand={vi.fn()}
      onLayout={vi.fn()}
      onArticleClick={vi.fn()}
    />
  );
}
it("未保存的新图片先申请系统授权，完成前不发出asset请求，完成后自动显示真实地址", async () => {
  let finish: () => void = () => {};
  api.invoke.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<Document />);
  const image = document.querySelector("img")!;
  expect(image.getAttribute("src")).toMatch(/^data:image\/svg/);
  expect(api.invoke).toHaveBeenCalledWith("authorize_images", {
    paths: ["/notes/assets/新图.svg"],
  });
  await act(async () => finish());
  await waitFor(() =>
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "asset://localhost/notes/assets/新图.svg",
    ),
  );
});
it("授权失败给出提示，预览内容仍在，迟到结果不更新已卸载页面", async () => {
  api.invoke.mockRejectedValueOnce(new Error("permission"));
  const first = render(<Document />);
  await screen.findByText("部分本地图片无法加载，请检查路径或访问权限。");
  expect(document.querySelector("img")?.getAttribute("src")).toMatch(
    /^data:image\/svg/,
  );
  first.unmount();
  let finish: () => void = () => {};
  api.invoke.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const second = render(<Document />);
  second.unmount();
  await act(async () => finish());
  expect(document.querySelector("article")).toBeNull();
});
