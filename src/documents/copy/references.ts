import { parser, GFM } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import MarkdownIt from "markdown-it";
import { resolveLocalResource } from "../resources";

export interface ResourceReference {
  from: number;
  to: number;
  path: string;
  suffix: string;
  image: boolean;
  attribute?: string;
}
const markdown = parser.configure(GFM);
const renderer = new MarkdownIt();
const utils = renderer.utils;
const normalizeLabel = (s: string) => utils.normalizeReference(s);

/** Source locations come from mature parsers; the remaining Markdown stays byte-for-byte intact. */
export function collectReferences(
  source: string,
  documentPath: string,
): ResourceReference[] {
  const tree = markdown.parse(source);
  const references: ResourceReference[] = [];
  const imageLabels = new Set<string>();
  const definitions: SyntaxNode[] = [];
  const add = (
    from: number,
    to: number,
    href: string,
    image: boolean,
    attribute?: string,
  ) => {
    if (!href || href.startsWith("#") || !renderer.validateLink(href)) return;
    const resolved = resolveLocalResource(href, documentPath);
    if (!resolved) return;
    if (references.length >= 4000)
      throw new Error("文档包含超过4000个本地引用，请拆分后另存。");
    references.push({
      from,
      to,
      ...resolved,
      image,
      ...(attribute ? { attribute } : {}),
    });
  };
  const url = (node: SyntaxNode, image: boolean) => {
    let from = node.from,
      to = node.to;
    if (source[from] === "<" && source[to - 1] === ">") {
      from++;
      to--;
    }
    add(from, to, utils.unescapeAll(source.slice(from, to)), image);
  };
  const html = (node: SyntaxNode) => {
    const fragment = parseFragment(source.slice(node.from, node.to), {
      sourceCodeLocationInfo: true,
    });
    const visit = (n: DefaultTreeAdapterMap["node"]) => {
      if ("tagName" in n && (n.tagName === "img" || n.tagName === "a")) {
        const attribute = n.tagName === "img" ? "src" : "href";
        const value = n.attrs.find((a) => a.name === attribute)?.value;
        const location = n.sourceCodeLocation?.attrs?.[attribute];
        if (value && location)
          add(
            node.from + location.startOffset,
            node.from + location.endOffset,
            value,
            n.tagName === "img",
            attribute,
          );
      }
      if ("childNodes" in n) n.childNodes.forEach(visit);
    };
    visit(fragment);
  };
  tree.iterate({
    enter(cursor) {
      const node = cursor.node;
      if (node.name === "LinkReference") {
        definitions.push(node);
        return false;
      }
      if (node.name === "HTMLBlock" || node.name === "HTMLTag") {
        html(node);
        return false;
      }
      if (node.name !== "Image" && node.name !== "Link") return;
      const target = node.getChild("URL");
      if (target) {
        url(target, node.name === "Image");
        return node.name === "Image" ? false : undefined;
      }
      if (node.name === "Image") {
        const explicit = node.getChild("LinkLabel");
        const marks = node.getChildren("LinkMark");
        const label = explicit
          ? source.slice(explicit.from + 1, explicit.to - 1)
          : "";
        if (marks.length >= 2)
          imageLabels.add(
            normalizeLabel(label || source.slice(marks[0].to, marks[1].from)),
          );
        return false;
      }
    },
  });
  const seen = new Set<string>();
  for (const definition of definitions) {
    const label = definition.getChild("LinkLabel"),
      target = definition.getChild("URL");
    if (label && target) {
      const key = normalizeLabel(source.slice(label.from + 1, label.to - 1));
      if (!seen.has(key)) url(target, imageLabels.has(key));
      seen.add(key);
    }
  }
  references.sort((a, b) => a.from - b.from);
  return references;
}
