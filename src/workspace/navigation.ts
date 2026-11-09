import type { Position } from "../storage";
export interface ReadingLocation {
  path: string;
  view: "render" | "source";
  position: Position;
}
export class NavigationTrail {
  private entries: ReadingLocation[] = [];
  push(entry: ReadingLocation | null) {
    if (!entry) return;
    const last = this.peek();
    if (
      last?.path === entry.path &&
      last.view === entry.view &&
      Math.abs(last.position.top - entry.position.top) < 1
    )
      return;
    this.entries.push({ ...entry, position: { ...entry.position } });
    if (this.entries.length > 50) this.entries.shift();
  }
  peek() {
    return this.entries.at(-1);
  }
  remove(entry: ReadingLocation) {
    if (this.peek() === entry) this.entries.pop();
  }
  retarget(from: string, to: string) {
    for (const entry of this.entries) {
      if (entry.path === from) entry.path = to;
    }
  }
  get length() {
    return this.entries.length;
  }
}
