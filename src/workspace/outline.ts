import type { Heading } from "../markdown";
export function outlineStructure(headings: Heading[]) {
  const parents = new Map<string, string>();
  const branches = new Set<string>();
  const stack: Heading[] = [];
  for (const heading of headings) {
    while (stack.length && stack.at(-1)!.level >= heading.level) stack.pop();
    if (stack.length) {
      const parent = stack.at(-1)!.id;
      parents.set(heading.id, parent);
      branches.add(parent);
    }
    stack.push(heading);
  }
  return { parents, branches };
}
export function visibleOutline(
  headings: Heading[],
  collapsed: Set<string>,
  parents: Map<string, string>,
) {
  const hidden = new Set<string>();
  return headings.filter((h) => {
    const parent = parents.get(h.id);
    if (parent && (collapsed.has(parent) || hidden.has(parent))) {
      hidden.add(h.id);
      return false;
    }
    return true;
  });
}

export function minimumHeadingLevel(headings: Heading[]) {
  let level = 6;
  for (const heading of headings) level = Math.min(level, heading.level);
  return level;
}
