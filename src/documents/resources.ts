/** Resolve a resource URI against a filesystem path, encoding the base exactly once. */
export function resolveLocalResource(
  src: string,
  documentPath: string,
): { path: string; suffix: string } | null {
  if (!documentPath.startsWith("/")) return null;
  try {
    const base = `file://${documentPath.split("/").map(encodeURIComponent).join("/")}`;
    const resolved = new URL(src, base);
    if (resolved.protocol !== "file:" || resolved.hostname) return null;
    return {
      path: decodeURIComponent(resolved.pathname),
      suffix: resolved.search + resolved.hash,
    };
  } catch {
    return null;
  }
}

export function localImagePath(
  src: string,
  documentPath: string,
): string | null {
  return resolveLocalResource(src, documentPath)?.path ?? null;
}
