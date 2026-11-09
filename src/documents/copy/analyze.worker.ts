import { collectReferences } from "./references";
self.onmessage = (event: MessageEvent<{ content: string; path: string }>) => {
  try {
    self.postMessage({
      references: collectReferences(event.data.content, event.data.path),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
