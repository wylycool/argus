import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoSaveSession } from "./autoSave";
import type { Draft, SaveAdapter } from "./autoSave";
function adapter(initial = "A") {
  const disk = { text: initial, version: "v1" };
  const drafts = new Map<string, Draft>();
  const api: SaveAdapter = {
    writeDraft: vi.fn(async (draft) => {
      const old = drafts.get(draft.path);
      if (
        !old ||
        old.sessionId !== draft.sessionId ||
        old.revision <= draft.revision
      )
        drafts.set(draft.path, { ...draft });
    }),
    save: vi.fn(async (draft) => {
      if (draft.baseVersion !== disk.version)
        throw { code: "conflict", message: "磁盘文件已变化" };
      disk.text = draft.text;
      disk.version = `v${Number(disk.version.slice(1)) + 1}`;
      return { version: disk.version };
    }),
    clearDraft: vi.fn(async (draft) => {
      const old = drafts.get(draft.path);
      if (
        old &&
        old.sessionId === draft.sessionId &&
        old.revision <= draft.revision
      )
        drafts.delete(draft.path);
    }),
  };
  return { disk, drafts, api };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("自动保存与数据保护", () => {
  it("停顿500ms后实际保存，保存前有本机草稿", async () => {
    const { api, disk, drafts } = adapter();
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    session.update("B");
    await vi.advanceTimersByTimeAsync(499);
    expect(disk.text).toBe("A");
    expect(drafts.get("/note.md")?.text).toBe("B");
    await vi.advanceTimersByTimeAsync(1);
    expect(disk.text).toBe("B");
    expect(session.snapshot.status).toBe("saved");
    expect(drafts.size).toBe(0);
    session.stop();
  });
  it("持续输入也不超过2秒未保存", async () => {
    const { api, disk } = adapter();
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    for (let i = 0; i < 7; i++) {
      session.update(`输入${i}`);
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(api.save).toHaveBeenCalled();
    expect(disk.text).not.toBe("A");
    await session.flush();
    expect(disk.text).toBe("输入6");
    session.stop();
  });
  it("手动保存立即写入，未修改则不重写文件", async () => {
    const { api, disk } = adapter();
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    await session.flush();
    expect(api.save).not.toHaveBeenCalled();
    session.update("B");
    expect(await session.flush()).toBe(true);
    expect(disk.text).toBe("B");
    session.stop();
  });
  it("慢保存期间继续输入，写入严格串行且最终保留最后内容", async () => {
    const { api, disk } = adapter();
    const first = deferred<{ version: string }>();
    const regular = api.save;
    api.save = vi
      .fn()
      .mockImplementationOnce(async (draft) => {
        const reply = await first.promise;
        disk.text = draft.text;
        disk.version = reply.version;
        return reply;
      })
      .mockImplementation(regular);
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    session.update("B");
    await vi.advanceTimersByTimeAsync(500);
    session.update("C");
    const complete = session.flush();
    expect(api.save).toHaveBeenCalledTimes(1);
    first.resolve({ version: "v2" });
    expect(await complete).toBe(true);
    expect(disk.text).toBe("C");
    expect(vi.mocked(api.save).mock.calls[1][0].baseVersion).toBe("v2");
    session.stop();
  });
  it("保存期间撤销回原文，不会让已开始的旧写入覆盖撤销", async () => {
    const { api, disk } = adapter();
    const first = deferred<{ version: string }>();
    const regular = api.save;
    api.save = vi
      .fn()
      .mockImplementationOnce(async (draft) => {
        const reply = await first.promise;
        disk.text = draft.text;
        disk.version = reply.version;
        return reply;
      })
      .mockImplementation(regular);
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    session.update("B");
    await vi.advanceTimersByTimeAsync(500);
    session.update("A");
    const complete = session.flush();
    first.resolve({ version: "v2" });
    await complete;
    expect(disk.text).toBe("A");
    expect(session.dirty).toBe(false);
    session.stop();
  });
  it("保存失败保留最新内容与草稿，主动重试可恢复", async () => {
    const { api, disk, drafts } = adapter();
    const regular = api.save;
    api.save = vi
      .fn()
      .mockRejectedValueOnce({ code: "permission", message: "只读文件" })
      .mockImplementation(regular);
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    session.update("B");
    expect(await session.flush()).toBe(false);
    expect(session.snapshot.status).toBe("error");
    expect(session.snapshot.text).toBe("B");
    expect(drafts.get("/note.md")?.text).toBe("B");
    expect(disk.text).toBe("A");
    session.update("C");
    await vi.advanceTimersByTimeAsync(2500);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(drafts.get("/note.md")?.text).toBe("C");
    expect(await session.flush()).toBe(true);
    expect(disk.text).toBe("C");
    session.stop();
  });
  it("冲突时不覆盖外部修改，新的输入仍进入草稿", async () => {
    const { api, disk, drafts } = adapter();
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    disk.text = "外部修改";
    disk.version = "v2";
    session.update("我的修改");
    await vi.advanceTimersByTimeAsync(500);
    expect(session.snapshot.status).toBe("conflict");
    expect(disk.text).toBe("外部修改");
    session.update("继续修改");
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(drafts.get("/note.md")?.text).toBe("继续修改");
    session.stop();
  });
  it("恢复草稿继承原文件版本，磁盘已变时仍拒绝覆盖", async () => {
    const { api, disk, drafts } = adapter("外部修改");
    disk.version = "v2";
    const recovered: Draft = {
      path: "/note.md",
      text: "未保存草稿",
      baseVersion: "v1",
      sessionId: "old",
      revision: 4,
    };
    const session = new AutoSaveSession(
      "/note.md",
      disk.text,
      disk.version,
      api,
      recovered,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(session.snapshot.status).toBe("conflict");
    expect(disk.text).toBe("外部修改");
    expect(drafts.get("/note.md")?.text).toBe("未保存草稿");
    session.stop();
  });
  it("草稿目录不可写但原文件可写时，仍正常保存到原文件", async () => {
    const { api, disk } = adapter();
    api.writeDraft = vi.fn().mockRejectedValue(new Error("draft disk full"));
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    session.update("B");
    expect(await session.flush()).toBe(true);
    expect(disk.text).toBe("B");
    expect(session.snapshot.status).toBe("saved");
    session.stop();
  });
  it("完成会话后清除定时器，后续不会再自动写回", async () => {
    const { api, disk } = adapter();
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    session.update("B");
    await session.flush();
    session.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(disk.text).toBe("B");
  });
  it("慢草稿存储只合并保留最新一份，不阻止原文件自动保存", async () => {
    const { api, disk } = adapter();
    const slow = deferred<void>();
    const original = api.writeDraft;
    api.writeDraft = vi
      .fn()
      .mockImplementationOnce(async (draft) => {
        await slow.promise;
        return original(draft);
      })
      .mockImplementation(original);
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    for (let i = 0; i < 12; i++) {
      session.update(`内容${i}`);
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(api.save).toHaveBeenCalled();
    expect(disk.text).not.toBe("A");
    slow.resolve();
    await session.flush();
    expect(disk.text).toBe("内容11");
    expect(vi.mocked(api.writeDraft).mock.calls.length).toBeLessThan(6);
    session.stop();
  });
  it("写入失败时取消此前排队的自动重试，保留可操作的错误状态", async () => {
    const { api } = adapter();
    const slow = deferred<{ version: string }>();
    api.save = vi.fn(() => slow.promise);
    const session = new AutoSaveSession("/note.md", "A", "v1", api);
    session.update("B");
    await vi.advanceTimersByTimeAsync(500);
    session.update("C");
    slow.reject({ code: "conflict", message: "外部修改" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(session.snapshot.status).toBe("conflict");
    expect(session.snapshot.text).toBe("C");
    session.stop();
  });
});

it("原本无修改的慢保存确认期间又输入，完成前必须写入新内容", async () => {
  const { api, disk } = adapter();
  const clearing = deferred<void>();
  const original = api.clearDraft;
  api.clearDraft = vi
    .fn()
    .mockImplementationOnce(() => clearing.promise)
    .mockImplementation(original);
  const session = new AutoSaveSession("/note.md", "A", "v1", api);
  const saving = session.flush();
  await vi.advanceTimersByTimeAsync(0);
  expect(api.clearDraft).toHaveBeenCalledOnce();
  session.update("最后输入B");
  clearing.resolve();
  expect(await saving).toBe(true);
  expect(disk.text).toBe("最后输入B");
  expect(session.dirty).toBe(false);
  session.stop();
});
it("慢保存确认后出现新输入并写入失败，不能报告保存完成", async () => {
  const { api, disk } = adapter();
  const clearing = deferred<void>();
  const original = api.clearDraft;
  api.clearDraft = vi
    .fn()
    .mockImplementationOnce(() => clearing.promise)
    .mockImplementation(original);
  api.save = vi
    .fn()
    .mockRejectedValue({ code: "permission", message: "文件不可写" });
  const session = new AutoSaveSession("/note.md", "A", "v1", api);
  const saving = session.flush();
  await vi.advanceTimersByTimeAsync(0);
  session.update("新输入仍需保存");
  clearing.resolve();
  expect(await saving).toBe(false);
  expect(disk.text).toBe("A");
  expect(session.snapshot.status).toBe("error");
  expect(session.snapshot.text).toBe("新输入仍需保存");
  session.stop();
});

it("放弃编辑只等待已开始的写入，不再追加用户要放弃的新输入", async () => {
  const { api, disk } = adapter();
  const first = deferred<{ version: string }>();
  const regular = api.save;
  api.save = vi
    .fn()
    .mockImplementationOnce(async (draft: Draft) => {
      const reply = await first.promise;
      disk.text = draft.text;
      disk.version = reply.version;
      return reply;
    })
    .mockImplementation(regular);
  const session = new AutoSaveSession("/note.md", "A", "v1", api);
  session.update("B已开始写入");
  await vi.advanceTimersByTimeAsync(500);
  session.update("C明确放弃的输入");
  const discarded = session.discard();
  first.resolve({ version: "v2" });
  await discarded;
  expect(disk.text).toBe("B已开始写入");
  expect(api.save).toHaveBeenCalledOnce();
});
it("结束的编辑会话不能再通过备份恢复已经放弃的内容", async () => {
  const { api, drafts } = adapter();
  const session = new AutoSaveSession("/note.md", "A", "v1", api);
  session.update("明确放弃的草稿");
  await session.discard();
  vi.mocked(api.writeDraft).mockClear();
  await session.protect();
  expect(api.writeDraft).not.toHaveBeenCalled();
  expect(drafts.size).toBe(0);
});
it("放弃草稿清理失败后仍可继续输入并主动保存", async () => {
  const { api, disk } = adapter();
  const regular = api.clearDraft;
  api.clearDraft = vi
    .fn()
    .mockRejectedValueOnce(new Error("草稿暂时无法清理"))
    .mockImplementation(regular);
  const session = new AutoSaveSession("/note.md", "A", "v1", api);
  session.update("B");
  await expect(session.discard()).rejects.toThrow("草稿暂时无法清理");
  session.update("C继续输入");
  expect(session.snapshot.text).toBe("C继续输入");
  expect(await session.flush()).toBe(true);
  expect(disk.text).toBe("C继续输入");
  session.stop();
});
