export interface Match {
  start: number;
  end: number;
}
interface TextPart {
  node: Text;
  start: number;
  end: number;
}
/** Text-only ranges keep links, code, SVGs and the Markdown DOM intact. */
export function highlightMatches(
  root: HTMLElement,
  query: string,
  limit = 1000,
) {
  clearMatches(root);
  if (!query.trim())
    return {
      count: 0,
      truncated: false,
      groups: [] as HTMLElement[][],
      clear: () => {},
    };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: TextPart[] = [];
  let text = "";
  let block: Element | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest(
        'button,svg,style,script,[aria-hidden="true"],.code-toolbar,.mermaid-source:not([open])',
      ) ||
      !node.data
    )
      continue;
    const nextBlock = parent.closest(
      "p,li,pre,h1,h2,h3,h4,h5,h6,td,th,blockquote",
    );
    if (parts.length && nextBlock !== block) text += "\n";
    block = nextBlock;
    parts.push({
      node,
      start: text.length,
      end: text.length + node.data.length,
    });
    text += node.data;
  }
  const needle = query.slice(0, 200);
  const expression = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "gi",
  );
  const matches: Match[] = [];
  let truncated = false;
  for (;;) {
    const found = expression.exec(text);
    if (!found) break;
    const start = found.index;
    if (matches.length === limit) {
      truncated = true;
      break;
    }
    matches.push({ start, end: start + needle.length });
  }
  const groups: HTMLElement[][] = matches.map(() => []);
  // Work backwards so splitting a text node cannot invalidate earlier offsets.
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    let low = 0,
      high = parts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (parts[middle].end <= match.start) low = middle + 1;
      else high = middle;
    }
    let last = low;
    while (last < parts.length && parts[last].start < match.end) last++;
    for (let j = last - 1; j >= low; j--) {
      const part = parts[j];
      if (part.start >= match.end || part.end <= match.start) continue;
      const start = Math.max(0, match.start - part.start),
        end = Math.min(part.end - part.start, match.end - part.start);
      if (end < part.node.length) part.node.splitText(end);
      const hit = start ? part.node.splitText(start) : part.node;
      const mark = document.createElement("mark");
      mark.className = "reader-match";
      mark.dataset.match = String(i);
      hit.replaceWith(mark);
      mark.append(hit);
      groups[i].unshift(mark);
    }
  }
  return {
    count: groups.length,
    truncated,
    groups,
    clear: () => clearMatches(root),
  };
}
export function clearMatches(root: HTMLElement) {
  const parents = new Set<Node>();
  for (const mark of root.querySelectorAll("mark.reader-match")) {
    const parent = mark.parentNode;
    if (parent) {
      parents.add(parent);
      mark.replaceWith(...mark.childNodes);
    }
  }
  for (const parent of parents) parent.normalize();
}

/** A match inside collapsed document content must be visible before scrolling. */
export function revealSearchMatch(mark?: HTMLElement) {
  if (!mark) return;
  for (
    let details = mark.closest("details");
    details;
    details = details.parentElement?.closest("details") ?? null
  )
    details.open = true;
  mark.scrollIntoView({ block: "center" });
}
