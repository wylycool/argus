export const isUntitledPath = (path: string) =>
  /\/app\.argus\.reader\/untitled\/未命名 \d+\.md$/.test(path);
export const locationLabel = (path: string) =>
  isUntitledPath(path)
    ? "未命名草稿 · 保存在本机"
    : path.slice(0, path.lastIndexOf("/"));
