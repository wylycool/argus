import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import sql from "highlight.js/lib/languages/sql";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import go from "highlight.js/lib/languages/go";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import DOMPurify from "dompurify";
import type Token from "markdown-it/lib/token.mjs";

for (const [name, language] of Object.entries({
  javascript,
  typescript,
  python,
  json,
  bash,
  css,
  xml,
  sql,
  rust,
  java,
  go,
  yaml,
  markdown,
  plaintext,
}))
  hljs.registerLanguage(name, language);
export interface Heading {
  id: string;
  text: string;
  level: number;
  line: number;
}
export interface RenderedDocument {
  html: string;
  headings: Heading[];
  words: number;
  minutes: number;
  diagrams: DiagramSource[];
}
export interface DiagramSource {
  id: string;
  source: string;
}
let renderSequence = 0;
const sourceAttributes = (token: Token) =>
  token.map
    ? ` data-argus-line="${token.map[0]}" data-argus-end="${token.map[1]}"`
    : "";
const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang): string {
    if (code.length <= 100_000 && lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true })
          .value;
      } catch {
        /* fallback to escaped text */
      }
    }
    return md.utils.escapeHtml(code);
  },
}).use(taskLists);
const fence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, renderer) => {
  const language = tokens[idx].info.trim().split(/\s+/)[0] || "text";
  if (language.toLowerCase() === "mermaid") {
    const context = env as { diagrams: DiagramSource[]; sequence: number };
    const id = `argus-mermaid-${context.sequence}-${context.diagrams.length}`;
    context.diagrams.push({ id, source: tokens[idx].content });
    return `<div class="code-block mermaid-block"${sourceAttributes(tokens[idx])} data-argus-diagram="${id}"><div class="code-toolbar"><span>Mermaid</span><div class="diagram-actions"><button type="button" class="diagram-expand" disabled aria-label="放大 Mermaid 图表">放大</button><button type="button" class="copy-code" aria-label="复制 Mermaid 源码">复制源码</button></div></div><div class="mermaid-stage" aria-busy="true"><span class="diagram-message" role="status">正在绘制图表…</span></div><details class="mermaid-source"><summary>查看源码</summary><pre><code>${md.utils.escapeHtml(tokens[idx].content)}</code></pre></details></div>`;
  }
  return `<div class="code-block"${sourceAttributes(tokens[idx])}><div class="code-toolbar"><span>${md.utils.escapeHtml(language)}</span><button type="button" class="copy-code" aria-label="复制代码">复制</button></div>${fence(tokens, idx, options, env, renderer)}</div>`;
};
const tableOpen = md.renderer.rules.table_open;
md.renderer.rules.table_open = (tokens, idx, options, env, renderer) =>
  `<div class="table-scroll" tabindex="0" role="region" aria-label="表格">${tableOpen ? tableOpen(tokens, idx, options, env, renderer) : renderer.renderToken(tokens, idx, options)}`;
md.renderer.rules.table_close = () => "</table></div>";
for (const type of ["th_open", "td_open"])
  md.renderer.rules[type] = (tokens, idx, options, _env, renderer) => {
    const alignment = tokens[idx]
      .attrGet("style")
      ?.match(/^text-align:(left|center|right)$/)?.[1];
    if (alignment) tokens[idx].attrSet("align", alignment);
    return renderer.renderToken(tokens, idx, options);
  };
function inlineText(token?: Token): string {
  return (
    token?.children
      ?.map((t) =>
        t.type === "image"
          ? t.content
          : ["text", "code_inline"].includes(t.type)
            ? t.content
            : t.type === "softbreak"
              ? " "
              : "",
      )
      .join("") ??
    token?.content ??
    ""
  );
}
export function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-") || "section"
  );
}
export function renderMarkdown(
  source: string,
  resolveImage: (src: string) => string = (s) => s,
): RenderedDocument {
  const tokens = md.parse(source, {});
  const context = {
    diagrams: [] as DiagramSource[],
    sequence: ++renderSequence,
  };
  const headings: Heading[] = [];
  const used = new Set<string>();
  const suffixes = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.nesting === 1 && t.map) {
      t.attrSet("data-argus-line", String(t.map[0]));
      t.attrSet("data-argus-end", String(t.map[1]));
    }
    if (t.type === "heading_open") {
      const text = inlineText(tokens[i + 1]);
      const root = `argus-heading-${slugify(text)}`;
      let id = root;
      let suffix = suffixes.get(root) ?? 1;
      while (used.has(id)) id = `${root}-${suffix++}`;
      suffixes.set(root, suffix);
      used.add(id);
      t.attrSet("id", id);
      headings.push({
        id,
        text,
        level: Number(t.tag.slice(1)),
        line: t.map?.[0] ?? 0,
      });
    }
    const visit = (token: Token) => {
      if (token.type === "image") {
        token.attrSet("loading", "lazy");
        token.attrSet("decoding", "async");
      }
      token.children?.forEach(visit);
    };
    visit(t);
  }
  const fragment = DOMPurify.sanitize(
    md.renderer.render(tokens, md.options, context),
    {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["loading", "decoding"],
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: [
        "style",
        "iframe",
        "form",
        "textarea",
        "video",
        "audio",
        "source",
      ],
      FORBID_ATTR: ["style", "srcset", "autofocus"],
    },
  );
  fragment.querySelectorAll("img[src]").forEach((image) => {
    image.setAttribute("src", resolveImage(image.getAttribute("src")!));
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    if (!image.closest("a")) {
      image.classList.add("reader-image");
      image.setAttribute("role", "button");
      image.setAttribute("tabindex", "0");
      image.setAttribute(
        "aria-label",
        `放大图片：${image.getAttribute("alt") || "未命名图片"}`,
      );
      image.setAttribute(
        "title",
        [image.getAttribute("title"), "点击放大图片"]
          .filter(Boolean)
          .join(" · "),
      );
    }
  });
  fragment.querySelectorAll("input").forEach((input) => {
    if (input.type !== "checkbox") input.remove();
    else input.disabled = true;
  });
  const container = document.createElement("div");
  container.append(fragment);
  const html = container.innerHTML;
  const text = tokens
    .filter((t) => t.type === "inline")
    .map(inlineText)
    .join(" ");
  const cjk =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)
      ?.length ?? 0;
  const words =
    cjk +
    (text
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " ")
      .match(/[\p{L}\p{N}]+/gu)?.length ?? 0);
  return {
    html,
    headings,
    words,
    minutes: Math.max(1, Math.ceil(words / 350)),
    diagrams: context.diagrams,
  };
}
