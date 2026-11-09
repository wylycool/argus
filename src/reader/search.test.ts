// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { highlightMatches, clearMatches } from "./search";
describe("阅读内容查找", () => {
  it("跨粗体与链接匹配，清理后结构、地址和源码保持原样", () => {
    const root = document.createElement("article");
    root.innerHTML =
      '<p>查找<strong>中文</strong><a href="guide.md">内容</a>，再查找中文内容。</p><pre><code>&lt;script&gt;</code></pre>';
    const original = root.innerHTML;
    const result = highlightMatches(root, "中文内容");
    expect(result.count).toBe(2);
    expect(result.groups[0].map((e) => e.textContent).join("")).toBe(
      "中文内容",
    );
    expect(root.querySelector("a")?.getAttribute("href")).toBe("guide.md");
    clearMatches(root);
    expect(root.innerHTML).toBe(original);
  });
  it("不把不同段落连成命中，不搜索按钮、SVG和折叠源码", () => {
    const root = document.createElement("article");
    root.innerHTML =
      '<p>上文</p><p>下文</p><button>秘密</button><svg><text>秘密</text></svg><details class="mermaid-source"><pre>秘密</pre></details>';
    expect(highlightMatches(root, "上文下文").count).toBe(0);
    expect(highlightMatches(root, "秘密").count).toBe(0);
    root.querySelector("details")!.setAttribute("open", "");
    expect(highlightMatches(root, "秘密").count).toBe(1);
  });
  it("特殊字符按普通文字查找，大小写转换不会偏移Unicode位置", () => {
    const root = document.createElement("article");
    root.textContent = "İ prefix A+B [x] a+b";
    const result = highlightMatches(root, "a+b");
    expect(result.count).toBe(2);
    expect(result.groups.map((g) => g[0].textContent)).toEqual(["A+B", "a+b"]);
    expect(highlightMatches(root, "[x]").count).toBe(1);
  });
  it("大量重复命中有上限，重复查找不会堆叠标记", () => {
    const root = document.createElement("article");
    root.textContent = "命中 ".repeat(1200);
    let result = highlightMatches(root, "命中");
    expect(result.count).toBe(1000);
    expect(result.truncated).toBe(true);
    result = highlightMatches(root, "命中", 10);
    expect(root.querySelectorAll("mark").length).toBe(10);
    clearMatches(root);
    expect(root.textContent).toBe("命中 ".repeat(1200));
  });
});
