// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FileMenu } from "./DocumentMenus";
import AppearanceMenu from "../../theme/AppearanceMenu";
afterEach(cleanup);
const fileProps = () => ({
  hasCurrentDocument: true,
  hasCopy: true,
  hasPath: false,
  canPrint: true,
  canHistory: false,
  canSearchAll: true,
  recent: [{ path: "/notes/文章.md", name: "文章.md", location: "/notes" }],
  onOpen: vi.fn(),
  onNew: vi.fn(),
  onQuick: vi.fn(),
  onSearchAll: vi.fn(),
  onRecent: vi.fn(),
  onCopy: vi.fn(),
  onPrint: vi.fn(),
  onReveal: vi.fn(),
  onHistory: vi.fn(),
});
it("文件操作共用一个入口，键盘跳过禁用项，Esc还原焦点", () => {
  const props = fileProps();
  render(<FileMenu {...props} />);
  const trigger = screen.getByRole("button", { name: "文件" });
  trigger.focus();
  fireEvent.click(trigger);
  const menu = screen.getByRole("menu", { name: "文件菜单" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    within(menu).getByRole("menuitem", { name: /新建文档/ }),
  );
  fireEvent.keyDown(trigger, { key: "End" });
  expect(document.activeElement).toBe(
    within(menu).getByRole("menuitem", { name: /打印/ }),
  );
  fireEvent.keyDown(document.body, { key: "Escape", isComposing: true });
  expect(menu.isConnected).toBe(true);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: /另存副本/ }));
  expect(props.onCopy).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();
});
it("最近阅读在文件菜单内可返回并选择文件，不重复放置文档路径操作", () => {
  const props = fileProps();
  render(<FileMenu {...props} />);
  const trigger = screen.getByRole("button", { name: "文件" });
  fireEvent.click(trigger);
  expect(screen.queryByRole("menuitem", { name: /复制绝对路径/ })).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: "最近阅读" }));
  expect(screen.getByRole("region", { name: "最近阅读记录" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "返回文件菜单" }));
  expect(screen.getByRole("menuitem", { name: /打开文档/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "最近阅读" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /文章.md/ }));
  expect(props.onRecent).toHaveBeenCalledWith("/notes/文章.md");
  expect(screen.queryByRole("menu")).toBeNull();
});
it("最近阅读页面切换立即交接焦点，快速按左箭头仍能返回主菜单", () => {
  render(<FileMenu {...fileProps()} />);
  fireEvent.click(screen.getByRole("button", { name: "文件" }));
  const recent = screen.getByRole("menuitem", { name: "最近阅读" });
  recent.focus();
  fireEvent.click(recent);
  const back = screen.getByRole("menuitem", { name: "返回文件菜单" });
  expect(document.activeElement).toBe(back);
  fireEvent.keyDown(back, { key: "ArrowLeft" });
  expect(screen.queryByRole("region", { name: "最近阅读记录" })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "最近阅读" }),
  );
});
it("外观只管理八主题与排版，不再包含文档操作", () => {
  render(
    <AppearanceMenu
      theme="mist"
      onChange={vi.fn()}
      reading={{ fontSize: 17, lineHeight: 1.9, width: 800 }}
      onReadingChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText("外观设置"));
  const panel = screen.getByRole("region", { name: "阅读配色" });
  expect(
    within(panel)
      .getByRole("group", { name: "预置主题" })
      .querySelectorAll("button"),
  ).toHaveLength(8);
  expect(within(panel).queryByText("另存副本")).toBeNull();
  expect(within(panel).queryByText("历史版本")).toBeNull();
  expect(within(panel).queryByText("文内查找")).toBeNull();
  fireEvent.click(within(panel).getByRole("tab", { name: "排版" }));
  expect(within(panel).getByRole("slider", { name: "正文字号" })).toBeTruthy();
});
