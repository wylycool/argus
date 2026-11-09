import { describe, expect, it } from "vitest";
import { localImagePath } from "./resources";

describe("本地资源 URI 与实际文件名", () => {
  it.each([
    [
      "assets/图.png",
      "/notes/100%25 中文/note.md",
      "/notes/100%25 中文/assets/图.png",
    ],
    ["../图片%20一.png", "/notes/子目录/note.md", "/notes/图片 一.png"],
    ["图%2525.png", "/notes/note.md", "/notes/图%25.png"],
    ["x%23y%3F.png", "/notes/#?% 空间/note.md", "/notes/#?% 空间/x#y?.png"],
    ["/图片/图.png", "/notes/note.md", "/图片/图.png"],
    [
      "file:///notes/100%2525%20%E4%B8%AD%E6%96%87/x.png",
      "/a.md",
      "/notes/100%25 中文/x.png",
    ],
    ["x.png?version=1#preview", "/notes/note.md", "/notes/x.png"],
    ["https://example.test/x.png", "/notes/note.md", null],
    ["//example.test/x.png", "/notes/note.md", null],
    ["file://server/shared/x.png", "/notes/note.md", null],
    ["x.png", "argus:guide", null],
  ])("%s 基于 %s", (src, path, expected) => {
    expect(localImagePath(src, path)).toBe(expected);
  });
});
