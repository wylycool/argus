import type { ThemePalette } from "../theme/themes";
export function hasAuthorPresentation(
  source: string,
  config: unknown,
): boolean {
  return (
    Boolean(
      config && typeof config === "object" && Object.keys(config).length,
    ) ||
    /(?:^|[\n;])\s*(?:classDef|style|linkStyle)\b/.test(source) ||
    /%%\s*\{\s*(?:init|initialize|config)\b/.test(source) ||
    /^\s*---(?:\r?\n)/.test(source)
  );
}
/** Cosmetic defaults only. Authored style/configuration bypasses this pass entirely. */
export function refineDiagram(svg: SVGSVGElement, palette: ThemePalette): void {
  for (const node of svg.querySelectorAll<SVGGElement>("g.node")) {
    for (const rect of node.querySelectorAll<SVGRectElement>(
      "rect.label-container",
    )) {
      if (!Number(rect.getAttribute("rx") ?? 0)) {
        rect.setAttribute("rx", "7");
        rect.setAttribute("ry", "7");
      }
      rect.style.strokeWidth = "1.15px";
    }
    for (const polygon of node.querySelectorAll<SVGPolygonElement>(
      "polygon.label-container",
    )) {
      const points = (polygon.getAttribute("points") ?? "")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number));
      if (
        points.length === 4 &&
        new Set(points.map((point) => point[0])).size === 3 &&
        new Set(points.map((point) => point[1])).size === 3
      ) {
        polygon.style.fill = palette.paper;
        polygon.style.stroke = palette.accent;
        polygon.style.strokeWidth = "1.15px";
        polygon.style.strokeDasharray = "4 4";
      }
    }
  }
  for (const label of svg.querySelectorAll<SVGGElement>("g.edgeLabel")) {
    if (!label.textContent?.trim() || !label.getBBox) continue;
    const box = label.getBBox();
    if (!box.width || !box.height) continue;
    label.querySelectorAll("rect").forEach((rect) => rect.remove());
    const background = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    );
    background.setAttribute("x", String(box.x - 7));
    background.setAttribute("y", String(box.y - 4));
    background.setAttribute("width", String(box.width + 14));
    background.setAttribute("height", String(box.height + 8));
    background.setAttribute("rx", String((box.height + 8) / 2));
    background.setAttribute("class", "argus-edge-pill");
    background.style.fill = palette.paper;
    background.style.stroke = palette.softBorder;
    background.style.strokeWidth = "1px";
    background.style.opacity = "1";
    label.insertBefore(background, label.firstChild);
  }
}
