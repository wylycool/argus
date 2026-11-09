import DOMPurify from "dompurify";
import type { Mermaid } from "mermaid";
import { themePalette } from "../theme/themes";
import type { ThemeName } from "../theme/themes";
import { hasAuthorPresentation, refineDiagram } from "./presentation";
export type DiagramTheme = ThemeName;
let library: Promise<Mermaid> | undefined;
let renderQueue: Promise<unknown> = Promise.resolve();
let sequence = 0;
const fontFamily =
  '"PingFang SC", "Hiragino Sans GB", -apple-system, sans-serif';

export function sanitizeDiagram(svg: string): string {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "foreignObject", "iframe", "image", "a"],
  });
  const container = document.createElement("div");
  container.innerHTML = clean;
  const element = container.querySelector("svg");
  if (!element) throw new Error("没有生成有效的 SVG 图表。");
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", "Mermaid 图表");
  return element.outerHTML;
}
export function diagramError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error);
  return (
    message
      .replace(/<[^>]*>/g, "")
      .trim()
      .slice(0, 700) || "请检查 Mermaid 语法后重试。"
  );
}
/** Mermaid has shared configuration: serialize theme initialization and rendering. */
export function renderDiagram(
  source: string,
  theme: DiagramTheme,
  isCurrent: () => boolean = () => true,
): Promise<string | null> {
  const job = renderQueue
    .catch(() => {})
    .then(async () => {
      if (!isCurrent()) return null;
      if (source.length > 100_000)
        throw new Error("图表源码超过 100,000 字符，请拆分后查看。");
      const mermaid = await (library ??= import("mermaid").then(
        (module) => module.default,
      ));
      if (!isCurrent()) return null;
      const palette = themePalette(theme);
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        maxTextSize: 100_000,
        maxEdges: 500,
        htmlLabels: false,
        fontFamily,
        theme: "base",
        look: "classic",
        secure: [
          "secure",
          "securityLevel",
          "startOnLoad",
          "maxTextSize",
          "maxEdges",
          "suppressErrorRendering",
          "htmlLabels",
          "dompurifyConfig",
        ],
        flowchart: {
          htmlLabels: false,
          useMaxWidth: false,
          wrappingWidth: 200,
          nodeSpacing: 36,
          rankSpacing: 44,
          diagramPadding: 18,
          padding: 14,
          curve: "rounded",
        },
        themeVariables: {
          fontFamily,
          fontSize: "15px",
          background: palette.paper,
          primaryColor: palette.node,
          primaryTextColor: palette.text,
          primaryBorderColor: palette.border,
          lineColor: palette.line,
          textColor: palette.text,
          secondaryColor: palette.secondary,
          tertiaryColor: palette.secondary,
          edgeLabelBackground: palette.paper,
          actorBkg: palette.node,
          actorBorder: palette.border,
          actorTextColor: palette.text,
          signalColor: palette.line,
          signalTextColor: palette.text,
        },
      });
      const parsed = await mermaid.parse(source);
      if (!isCurrent()) return null;
      const authored = hasAuthorPresentation(source, parsed.config);
      const host = document.createElement("div");
      host.className = "mermaid-measure";
      host.setAttribute("aria-hidden", "true");
      document.body.append(host);
      try {
        const result = await mermaid.render(
          `argus-svg-${++sequence}`,
          source,
          host,
        );
        if (!isCurrent()) return null;
        const clean = sanitizeDiagram(result.svg);
        if (authored) return clean;
        host.innerHTML = clean;
        const svg = host.querySelector("svg")!;
        refineDiagram(svg, palette);
        return svg.outerHTML;
      } finally {
        host.remove();
      }
    });
  renderQueue = job.catch(() => {});
  return job;
}
