// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExternalChanges } from "./useExternalChanges";
import { AutoSaveSession } from "../editor/autoSave";
const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  changed: null as null | ((e: { payload: string }) => void),
  focus: null as null | ((e: { payload: boolean }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (e: { payload: string }) => void) => {
    if (name === "document-changed") mock.changed = handler;
    return () => {
      mock.changed = null;
    };
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async (handler: (e: { payload: boolean }) => void) => {
      mock.focus = handler;
      return () => {
        mock.focus = null;
      };
    },
  }),
}));
function Harness({
  path = "/note.md",
  session = null,
}: {
  path?: string;
  session?: AutoSaveSession | null;
}) {
  const { notice, dismiss } = useExternalChanges({
    enabled: true,
    path,
    version: "v1",
    getSession: () => session,
  });
  return (
    <>
      <p>{notice?.status ?? "clear"}</p>
      <button onClick={dismiss}>稍后</button>
    </>
  );
}
beforeEach(() => {
  mock.invoke.mockReset();
  mock.invoke.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("外部文件变化", () => {
  it("切回窗口检查，显示变化并允许稍后处理", async () => {
    mock.invoke.mockResolvedValue({
      status: "changed",
      version: "v2",
      writable: true,
    });
    render(<Harness />);
    act(() => mock.focus?.({ payload: true }));
    await screen.findByText("changed");
    expect(mock.invoke).toHaveBeenCalledWith("probe_document", {
      path: "/note.md",
      version: "v1",
    });
    screen.getByText("稍后").click();
    await screen.findByText("clear");
  });
  it("迟到的旧文件检查不污染新文档", async () => {
    let resolve!: (v: unknown) => void;
    mock.invoke.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = render(<Harness />);
    act(() => window.dispatchEvent(new Event("focus")));
    view.rerender(<Harness path="/next.md" />);
    await act(async () =>
      resolve({ status: "missing", version: null, writable: false }),
    );
    expect(screen.getByText("clear")).toBeTruthy();
  });
  it("编辑期间检测到外部内容，保留输入并停止自动写入", async () => {
    const save = vi.fn(async () => ({ version: "saved" }));
    const session = new AutoSaveSession("/note.md", "原文", "v1", {
      save,
      writeDraft: async () => {},
      clearDraft: async () => {},
    });
    session.update("本地未保存文字");
    mock.invoke.mockResolvedValue({
      status: "changed",
      version: "external",
      writable: true,
    });
    render(<Harness session={session} />);
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(session.snapshot.status).toBe("conflict"));
    expect(session.snapshot.text).toBe("本地未保存文字");
    expect(save).not.toHaveBeenCalled();
    session.stop();
  });
});

it("保持前台也能通过文件事件检测变化，切换文件后停止旧监听", async () => {
  let changed = false;
  mock.invoke.mockImplementation(async (cmd: string) =>
    cmd === "probe_document"
      ? {
          status: changed ? "changed" : "unchanged",
          version: changed ? "v2" : "v1",
          writable: true,
        }
      : null,
  );
  const view = render(<Harness />);
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith(
      "watch_document",
      expect.objectContaining({ path: "/note.md" }),
    ),
  );
  await waitFor(() => expect(mock.changed).toBeTypeOf("function"));
  changed = true;
  act(() => mock.changed?.({ payload: "/note.md" }));
  await screen.findByText("changed");
  view.rerender(<Harness path="/next.md" />);
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith(
      "watch_document",
      expect.objectContaining({ path: "/next.md" }),
    ),
  );
  expect(
    mock.invoke.mock.calls.some(
      ([cmd, args]) =>
        cmd === "watch_document" && args.path === null && args.watchId,
    ),
  ).toBe(true);
});
