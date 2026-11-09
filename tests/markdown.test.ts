// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown";

describe("Markdown 阅读渲染", () => {
  it("支持常用格式、任务状态和代码高亮", () => {
    const { html, headings, words } = renderMarkdown(
      '# 中文标题\n\n**粗体** *斜体* ~~删除~~\n\n> 引用\n\n- [x] 已完成\n- [ ] 未完成\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```typescript\nconst x: string = "hello";\n```\n\n---\n\n[网页](https://example.com)\n\n![风景](图片.png)',
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(headings[0].text).toBe("中文标题");
    for (const tag of [
      "strong",
      "em",
      "s",
      "blockquote",
      "table",
      "hr",
      "a",
      "img",
    ])
      expect(root.querySelector(tag)).not.toBeNull();
    expect(root.querySelectorAll("input[type=checkbox]")).toHaveLength(2);
    expect(root.querySelector("input")?.disabled).toBe(true);
    expect(root.querySelector(".hljs-keyword")).not.toBeNull();
    expect(root.querySelector("code")?.textContent).toContain(
      'const x: string = "hello";',
    );
    expect(words).toBeGreaterThan(10);
  });
  it("重复标题与带编号标题不会产生重复 ID", () => {
    const { headings, html } = renderMarkdown(
      "# Hello\n## Hello\n## Hello-1\n## **Hello**\n## 中文 *世界*",
    );
    expect(new Set(headings.map((h) => h.id)).size).toBe(headings.length);
    expect(headings.at(-1)?.text).toBe("中文 世界");
    for (const h of headings) expect(html).toContain(`id="${h.id}"`);
  });
  it("清理脚本、事件、嵌入和危险链接", () => {
    const { html } = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n<a href="javascript:alert(1)">危险</a>\n\n<iframe src="https://evil.test"></iframe>\n\n<form><input autofocus></form>',
    );
    expect(html).not.toMatch(
      /<script|onerror|javascript:|<iframe|<form|autofocus/,
    );
  });
  it("未知语言代码转义 HTML，保留本地 asset 图片", () => {
    const { html } = renderMarkdown(
      "```unknown\n<script>x</script>\n```\n\n![图](image.png)",
      () => "asset://localhost/Users/test/image.png",
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('src="asset://localhost/Users/test/image.png"');
  });
  it("标题中的代码、图片替代文字与换行正确进入大纲", () => {
    expect(
      renderMarkdown("## 使用 `Argus` 和 ![图片](x.png)").headings[0].text,
    ).toBe("使用 Argus 和 图片");
  });
  it("特殊标题保留有效锚点，HTML 图片也解析相对路径", () => {
    const { html, headings } = renderMarkdown(
      '# location\n# forms\n# constructor\n\n<img src="../图片.png" alt="图">',
      (s) => `asset://localhost${s}`,
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    for (const heading of headings)
      expect(root.querySelectorAll(`[id="${heading.id}"]`)).toHaveLength(1);
    expect(root.querySelector("img")?.src).toContain("asset://localhost../");
  });
  it("保留含目录分隔符的图片路径，并让解析器收到原始地址", () => {
    const received: string[] = [];
    const { html } = renderMarkdown(
      "![风景](assets/landscape.svg)\n\n![中文](images/中文%20图片.png)",
      (src) => {
        received.push(src);
        return `asset://localhost/${encodeURIComponent(src)}`;
      },
    );
    expect(received).toEqual([
      "assets/landscape.svg",
      "images/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.png",
    ]);
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelectorAll("img[src]")).toHaveLength(2);
  });
  it("Mermaid单独提取源码，普通语言仍是原有代码块", () => {
    const result = renderMarkdown(
      "```mermaid\nflowchart TD\nA[中文]-->B\n```\n\n```js\nconst x=1;\n```",
    );
    expect(result.diagrams).toHaveLength(1);
    expect(result.diagrams[0].source).toContain("A[中文]");
    expect(result.html).toContain("data-argus-diagram");
    expect(result.html).toContain("查看源码");
    expect(result.html).toContain("hljs-keyword");
  });
  it("多张图表的定位标识唯一，图表源码中的HTML仍安全转义", () => {
    const result = renderMarkdown(
      "```MERMAID\nflowchart TD\nA[<script>alert(1)</script>]-->B\n```\n```mermaid\nsequenceDiagram\nA->>B: hi\n```",
    );
    expect(result.diagrams).toHaveLength(2);
    expect(new Set(result.diagrams.map((d) => d.id)).size).toBe(2);
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });
});

it("阅读定位元信息不包裹原始HTML，details与Markdown混排结构保持完整", () => {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(
    "<details>\n<summary>说明</summary>\n\n## 内部标题\n\n正文\n\n</details>",
  ).html;
  expect(root.querySelector("details")?.querySelector("h2")?.textContent).toBe(
    "内部标题",
  );
  expect(root.querySelector("h2")?.getAttribute("data-argus-line")).toBe("3");
});

it("大量重复标题保持唯一编号，带编号的原始标题仍按出现顺序避让", () => {
  const { headings } = renderMarkdown("# 重复标题\n\n".repeat(3000));
  expect(new Set(headings.map((h) => h.id)).size).toBe(3000);
  expect(headings.at(-1)!.id).toBe("argus-heading-重复标题-2999");
  expect(
    renderMarkdown("# A-1\n# A\n# A\n# A-2\n# A").headings.map((h) => h.id),
  ).toEqual([
    "argus-heading-a-1",
    "argus-heading-a",
    "argus-heading-a-2",
    "argus-heading-a-2-1",
    "argus-heading-a-3",
  ]);
});
