import { safeDecode } from "../storage";
import { createSessionId } from "../editor/autoSave";

/** Share exact/custom IDs and Markdown heading fallback with reading and printing. */
export function createAnchorResolver(root: ParentNode) {
  const ids = new Map<string, HTMLElement>();
  for (const node of root.querySelectorAll<HTMLElement>("[id]")) {
    if (!ids.has(node.id)) ids.set(node.id, node);
  }
  return (fragment: string) => {
    const id = safeDecode(fragment);
    return id ? (ids.get(id) ?? ids.get(`argus-heading-${id}`) ?? null) : null;
  };
}

export function prefixPrintAnchors(root: HTMLElement) {
  const resolve = createAnchorResolver(root);
  const mapped = new Map<HTMLElement, string>();
  // Quartz exports Unicode fragments as URI actions; ASCII targets keep PDF GoTo links.
  const prefix = `argus-print-${createSessionId()}-`;
  let sequence = 0;
  for (const node of root.querySelectorAll<HTMLElement>("[id]")) {
    if (!node.closest("svg")) mapped.set(node, `${prefix}${sequence++}`);
  }
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const target = resolve(link.getAttribute("href")!.slice(1));
    if (target)
      link.setAttribute(
        "href",
        `#${encodeURIComponent(mapped.get(target) ?? target.id)}`,
      );
  }
  for (const [node, id] of mapped) node.id = id;
}
