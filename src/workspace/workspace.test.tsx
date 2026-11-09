// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationTrail } from "./navigation";
import {
  outlineStructure,
  visibleOutline,
  minimumHeadingLevel,
} from "./outline";
import OutlineNavigation from "./OutlineNavigation";
import ImageViewer from "./ImageViewer";
import FileContextMenu from "./FileContextMenu";
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [
            { contentRect: { width: 600, height: 400 } },
          ] as ResizeObserverEntry[],
          {} as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("阅读工作区组件", () => {
  it("返回位置独立保存，失败时保留栈顶，长期导航有上限", () => {
    const trail = new NavigationTrail();
    const location = {
      path: "/a.md",
      view: "render" as const,
      position: { top: 320, ratio: 0.4 },
    };
    trail.push(location);
    location.position.top = 999;
    expect(trail.peek()?.position.top).toBe(320);
    const first = trail.peek()!;
    trail.push({
      path: "/b.md",
      view: "source",
      position: { top: 40, ratio: 0.1 },
    });
    trail.remove(first);
    expect(trail.length).toBe(2);
    trail.remove(trail.peek()!);
    expect(trail.peek()).toBe(first);
    for (let i = 0; i < 80; i++)
      trail.push({
        path: `/${i}.md`,
        view: "render",
        position: { top: i, ratio: 0 },
      });
    expect(trail.length).toBe(50);
  });
  it("标题级别跳跃仍正确折叠，折叠活动章节不抢焦点，换文档后不串状态", () => {
    const headings = [
      { id: "a", text: "章节A", level: 1, line: 0 },
      { id: "b", text: "子节B", level: 3, line: 2 },
      { id: "c", text: "章节C", level: 1, line: 4 },
    ];
    const structure = outlineStructure(headings);
    expect(
      visibleOutline(headings, new Set(["a"]), structure.parents).map(
        (h) => h.id,
      ),
    ).toEqual(["a", "c"]);
    const jump = vi.fn();
    const view = render(
      <OutlineNavigation
        key="first"
        headings={headings}
        name="first"
        active="b"
        onJump={jump}
      />,
    );
    const fold = screen.getByRole("button", { name: "折叠章节A" });
    fold.focus();
    fireEvent.click(fold);
    expect(screen.queryByRole("button", { name: "子节B" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "章节A" })
        .getAttribute("aria-current"),
    ).toBe("location");
    expect(document.activeElement).toBe(fold);
    expect(jump).not.toHaveBeenCalled();
    view.rerender(
      <OutlineNavigation
        key="second"
        headings={headings}
        name="second"
        active="b"
        onJump={jump}
      />,
    );
    expect(screen.getByRole("button", { name: "子节B" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "子节B" }));
    expect(jump).toHaveBeenCalledWith("b", 2);
  });
  it("图片适应窗口、原始尺寸和缩放正确，Esc可关闭", () => {
    const close = vi.fn();
    render(
      <ImageViewer
        image={{ src: "https://example.test/a.png", alt: "架构图" }}
        onClose={close}
      />,
    );
    const img = screen.getByAltText("架构图");
    Object.defineProperties(img, {
      naturalWidth: { value: 1200 },
      naturalHeight: { value: 800 },
    });
    fireEvent.load(img);
    expect(screen.getByText("50%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "图片原始尺寸" }));
    expect(screen.getByText("100%", { selector: "span" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
    expect(screen.getByText("125%")).toBeTruthy();
    expect(
      (document.querySelector(".image-zoom-content") as HTMLElement).style
        .width,
    ).toBe("1500px");
    // A pointer click in macOS WebView can return keyboard focus to body.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
  it("图片失败可重试，不改变资源地址或关闭背景阅读", () => {
    const close = vi.fn();
    render(
      <ImageViewer
        image={{ src: "asset://localhost/中文 空格.png", alt: "图" }}
        onClose={close}
      />,
    );
    fireEvent.error(screen.getByAltText("图"));
    expect(screen.getByRole("alert").textContent).toContain("图片无法加载");
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(screen.getByAltText("图").getAttribute("src")).toBe(
      "asset://localhost/中文 空格.png",
    );
    expect(close).not.toHaveBeenCalled();
  });
  it("文件菜单执行指定目标操作，所有项禁用时仍能Esc退出", () => {
    const close = vi.fn(),
      copy = vi.fn(),
      reveal = vi.fn(),
      others = vi.fn();
    const view = render(
      <FileContextMenu
        target={{ path: "/中文 空格.md", name: "中文 空格.md", x: 10, y: 10 }}
        onClose={close}
        onReveal={reveal}
        onCopy={copy}
        onCloseOthers={others}
        canCloseOthers={true}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "复制绝对路径" }));
    expect(copy).toHaveBeenCalledOnce();
    expect(reveal).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    view.unmount();
    close.mockClear();
    render(
      <FileContextMenu
        target={{ path: "argus:guide", name: "指南", x: 10, y: 10 }}
        onClose={close}
        onReveal={reveal}
        onCopy={copy}
        onCloseOthers={others}
        canCloseOthers={false}
      />,
    );
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});

it("大纲最小层级计算不受函数参数数量限制", () => {
  const headings = Array.from({ length: 200000 }, (_, i) => ({
    id: String(i),
    text: "标题",
    level: i === 199999 ? 2 : 4,
    line: i,
  }));
  expect(minimumHeadingLevel(headings)).toBe(2);
  expect(minimumHeadingLevel([])).toBe(6);
});
