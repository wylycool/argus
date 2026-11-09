/** Keep a heading and its first content block together in WebKit pagination. */
export function groupPrintHeadings(root: HTMLElement) {
  const selector = "h1,h2,h3,h4,h5,h6";
  for (const heading of Array.from(root.children).filter((e) =>
    e.matches(selector),
  )) {
    if (heading.parentElement !== root || !heading.nextSibling) continue;
    const group = document.createElement("div");
    group.className = "print-section-start";
    heading.before(group);
    let cursor: ChildNode | null = heading;
    while (cursor) {
      const next: ChildNode | null = cursor.nextSibling;
      group.append(cursor);
      if (
        cursor !== heading &&
        ((cursor instanceof Element && !cursor.matches(selector)) ||
          (cursor.nodeType === Node.TEXT_NODE && cursor.textContent?.trim()))
      )
        break;
      cursor = next;
    }
  }
}

/** Fit each vector diagram on an A4 page without clipping its final nodes. */
export function fitPrintDiagrams(root: HTMLElement) {
  for (const svg of root.querySelectorAll<SVGSVGElement>(
    ".mermaid-stage > svg",
  )) {
    const box = svg.getAttribute("viewBox")?.trim().split(/[ ,]+/).map(Number);
    if (
      !box ||
      box.length !== 4 ||
      !box.every(Number.isFinite) ||
      box[2] <= 0 ||
      box[3] <= 0
    )
      continue;
    const scale = Math.min(1, 600 / box[2], 720 / box[3]);
    svg.style.width = `${box[2] * scale}px`;
    svg.style.height = `${box[3] * scale}px`;
    svg.style.maxWidth = "100%";
  }
}
