export interface ScrollPoint {
  line: number;
  top: number;
}
/** Piecewise source-line mapping works for paragraphs, code, lists and image blocks. */
export function interpolate(
  points: ScrollPoint[],
  value: number,
  from: "line" | "top",
): number {
  if (!points.length) return 0;
  const to = from === "line" ? "top" : "line";
  const first = points[0];
  if (value <= first[from]) return first[to];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (value <= b[from]) {
      const width = b[from] - a[from];
      return width > 0
        ? a[to] +
            (b[to] - a[to]) *
              Math.max(0, Math.min(1, (value - a[from]) / width))
        : b[to];
    }
  }
  return points.at(-1)![to];
}
export function previewPoints(
  article: HTMLElement,
  viewport: HTMLElement,
  lines: number,
): ScrollPoint[] {
  const origin = viewport.getBoundingClientRect().top - viewport.scrollTop;
  const points: ScrollPoint[] = [{ line: 0, top: 0 }];
  for (const node of article.querySelectorAll<HTMLElement>(
    "[data-argus-line]",
  )) {
    if (node.parentElement?.closest("[data-argus-line]")) continue;
    const line = Number(node.dataset.argusLine);
    const top = node.getBoundingClientRect().top - origin;
    const previous = points.at(-1)!;
    if (
      Number.isFinite(line) &&
      line < lines &&
      line > previous.line &&
      top >= previous.top
    )
      points.push({ line, top });
  }
  const last = points.at(-1)!;
  points.push({
    line: Math.max(lines, last.line + 1),
    top: Math.max(viewport.scrollHeight, last.top),
  });
  return points;
}
