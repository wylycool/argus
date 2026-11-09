import type { AutoSaveSession } from "../editor/autoSave";

export interface DocumentOperation {
  path: string;
  session: AutoSaveSession | null;
  request: number;
}
export type CopyResult =
  | { status: "cancelled" | "blocked" | "failed" }
  | { status: "written"; path: string }
  | { status: "switched"; path: string; context: DocumentOperation };

export function isCurrentOperation(
  operation: DocumentOperation,
  path: string | undefined,
  session: AutoSaveSession | null,
  request: number,
) {
  return (
    operation.path === path &&
    operation.session === session &&
    operation.request === request
  );
}
