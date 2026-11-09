// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FindBar from "./FindBar";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("查找组字的Enter和Esc交给输入法，普通Enter继续定位", async () => {
  vi.useFakeTimers();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const root = document.createElement("article");
  root.textContent = "中文 中文";
  document.body.append(root);
  const close = vi.fn();
  render(
    <FindBar rootRef={{ current: root }} contentKey="one" onClose={close} />,
  );
  const input = screen.getByLabelText("查找内容");
  fireEvent.change(input, { target: { value: "中文" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(screen.getByRole("status").textContent).toBe("1 / 2");
  fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
  expect(screen.getByRole("status").textContent).toBe("1 / 2");
  fireEvent.keyDown(input, { key: "Escape", isComposing: true, keyCode: 229 });
  expect(close).not.toHaveBeenCalled();
  fireEvent.compositionStart(input);
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("status").textContent).toBe("1 / 2");
  fireEvent.keyUp(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("status").textContent).toBe("2 / 2");
  root.remove();
});

it("查找折叠内容时展开命中所在的每层details，下一个匹配同样可见", async () => {
  vi.useFakeTimers();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const root = document.createElement("article");
  root.innerHTML =
    '<details id="outer"><summary>外层</summary><details id="inner"><summary>内层</summary><p>命中内容</p></details></details><details id="next"><summary>下一处</summary><p>命中内容</p></details>';
  document.body.append(root);
  const view = render(
    <FindBar
      rootRef={{ current: root }}
      contentKey="folded"
      onClose={vi.fn()}
    />,
  );
  try {
    fireEvent.change(screen.getByLabelText("查找内容"), {
      target: { value: "命中" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(screen.getByRole("status").textContent).toBe("1 / 2");
    expect(root.querySelector<HTMLDetailsElement>("#outer")!.open).toBe(true);
    expect(root.querySelector<HTMLDetailsElement>("#inner")!.open).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "下一个匹配" }));
    expect(root.querySelector<HTMLDetailsElement>("#next")!.open).toBe(true);
  } finally {
    view.unmount();
    root.remove();
  }
});
