import { expect, it } from "vitest";
import { collectReferences } from "./references";
it("成熟语法树定位行内/引用式图片、链接与HTML，不改代码块或注释", () => {
  const text =
    '😀\n![a](<assets/a b.png> "t") [b](other.md#节)\n\n![引用][ID]\n\n[id]: ../图.png\n[id]: missing.png\n\n<img SRC="assets/图.png?x=1&amp;y=2" alt="x">\n\n`![不是图](missing.png)`\n\n```md\n![代码](missing.png)\n```\n\n<!-- <img src="missing.png"> -->';
  const refs = collectReferences(text, "/notes/100%25 中文/note.md");
  expect(refs.map((r) => r.image)).toEqual([true, false, true, true]);
  expect(refs.map((r) => r.path)).toEqual([
    "/notes/100%25 中文/assets/a b.png",
    "/notes/100%25 中文/other.md",
    "/notes/图.png",
    "/notes/100%25 中文/assets/图.png",
  ]);
  expect(refs[3].suffix).toBe("?x=1&y=2");
  expect(text.slice(refs[0].from, refs[0].to)).toBe("assets/a b.png");
  expect(text.slice(refs[3].from, refs[3].to)).toMatch(/^SRC=/);
});
it("折叠及快捷引用图片引用正确标记，网页/data/锚点保持原样", () => {
  const refs = collectReferences(
    '![图][] ![另图] ![web](https://example.test/x.png)\n\n[图]: x.png\n[另图]: y.png\n\n<a href="next.md#x">link</a> [here](#x)',
    "/a/note.md",
  );
  expect(refs.map((r) => [r.path, r.image])).toEqual([
    ["/a/x.png", true],
    ["/a/y.png", true],
    ["/a/next.md", false],
  ]);
});
it("图片替代文字中的嵌套链接不是额外资源，链接中的图片仍需携带", () => {
  const refs = collectReferences(
    "![alt [hidden](bad.md)](a.png) [![图](b.png)](b.png)",
    "/a/note.md",
  );
  expect(refs.map((r) => r.path)).toEqual(["/a/a.png", "/a/b.png", "/a/b.png"]);
});
