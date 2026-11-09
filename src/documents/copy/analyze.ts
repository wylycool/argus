import type { ResourceReference } from "./references";

export function analyzeCopy(
  content: string,
  path: string,
): Promise<ResourceReference[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./analyze.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("资源分析耗时过长，文档尚未另存，请拆分后重试。"));
    }, 15000);
    worker.onmessage = (
      event: MessageEvent<{ references?: ResourceReference[]; error?: string }>,
    ) => {
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.references ?? []);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("资源分析失败，当前文档和输入仍保留。"));
    };
    worker.postMessage({ content, path });
  });
}
