export interface Draft {
  path: string;
  text: string;
  baseVersion: string;
  sessionId: string;
  revision: number;
}
export type SaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";
export interface SaveSnapshot {
  text: string;
  savedText: string;
  version: string;
  status: SaveStatus;
  message: string;
  draftWarning: string;
}
export interface SaveAdapter {
  writeDraft(draft: Draft): Promise<unknown>;
  save(draft: Draft): Promise<{ version: string }>;
  clearDraft(draft: Draft): Promise<unknown>;
}
export const normalizeText = (text: string) => text.replace(/\r\n?/g, "\n");
export const createSessionId = () =>
  crypto.randomUUID?.() ??
  Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
    n.toString(16),
  ).join("-");
export function saveError(error: unknown): { code: string; message: string } {
  if (error && typeof error === "object" && "message" in error)
    return {
      code: "code" in error ? String(error.code) : "io",
      message: String(error.message),
    };
  return { code: "io", message: String(error) };
}

/** One session owns one ordered write stream; navigation waits for flush(). */
export class AutoSaveSession {
  readonly path: string;
  readonly sessionId: string;
  private state: SaveSnapshot;
  private revision = 0;
  private listeners = new Set<() => void>();
  private pauseTimer?: ReturnType<typeof setTimeout>;
  private maxTimer?: ReturnType<typeof setTimeout>;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private draftMaxTimer?: ReturnType<typeof setTimeout>;
  private inFlight: Promise<boolean> | null = null;
  private draftQueue: Promise<unknown> = Promise.resolve();
  private draftPending: Draft | null = null;
  private draftRunning = false;
  private stopped = false;
  private discarding = false;
  private discardFlight: Promise<void> | null = null;
  constructor(
    path: string,
    content: string,
    version: string,
    private adapter: SaveAdapter,
    recovered?: Draft,
    sessionId?: string,
  ) {
    this.path = path;
    this.sessionId = sessionId ?? createSessionId();
    this.state = {
      text: normalizeText(recovered?.text ?? content),
      savedText: normalizeText(content),
      version: recovered?.baseVersion ?? version,
      status: "saved",
      message: "",
      draftWarning: "",
    };
    if (this.dirty) {
      this.revision++;
      this.patch({ status: "pending" });
      this.schedule();
    }
  }
  get snapshot() {
    return this.state;
  }
  get dirty() {
    return this.state.text !== this.state.savedText;
  }
  protect() {
    return this.backup();
  }
  pauseForExternalChange(message: string) {
    if (this.stopped) return;
    this.clearTimers();
    this.patch({ status: "conflict", message });
    if (this.dirty) void this.backup();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(change: Partial<SaveSnapshot>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private draft(): Draft {
    return {
      path: this.path,
      text: this.state.text,
      baseVersion: this.state.version,
      sessionId: this.sessionId,
      revision: this.revision,
    };
  }
  update(text: string) {
    if (this.stopped || this.discarding || text === this.state.text) return;
    this.revision++;
    const paused = ["error", "conflict"].includes(this.state.status);
    this.patch({
      text,
      ...(!paused
        ? {
            status: this.inFlight
              ? "saving"
              : text === this.state.savedText
                ? "saved"
                : "pending",
            message: "",
          }
        : {}),
    });
    this.schedule();
  }
  private schedule() {
    if (this.stopped) return;
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      void this.backup();
    }, 200);
    this.draftMaxTimer ??= setTimeout(() => {
      void this.backup();
    }, 1000);
    if (["error", "conflict"].includes(this.state.status)) return;
    clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => {
      void this.flush();
    }, 500);
    this.maxTimer ??= setTimeout(() => {
      void this.flush();
    }, 2000);
  }
  private backup(draft = this.draft()): Promise<unknown> {
    if (this.stopped || this.discarding) return this.draftQueue;
    clearTimeout(this.draftTimer);
    clearTimeout(this.draftMaxTimer);
    this.draftMaxTimer = undefined;
    if (!this.draftPending || draft.revision >= this.draftPending.revision)
      this.draftPending = draft;
    if (!this.draftRunning) {
      this.draftRunning = true;
      this.draftQueue = (async () => {
        try {
          while (this.draftPending) {
            const latest = this.draftPending;
            this.draftPending = null;
            try {
              await this.adapter.writeDraft(latest);
            } catch (error) {
              if (!this.stopped && this.dirty)
                this.patch({
                  draftWarning: `草稿备份失败：${saveError(error).message}`,
                });
            }
          }
        } finally {
          this.draftRunning = false;
        }
      })();
    }
    return this.draftQueue;
  }
  private clearTimers() {
    clearTimeout(this.pauseTimer);
    clearTimeout(this.maxTimer);
    this.maxTimer = undefined;
    clearTimeout(this.draftTimer);
    clearTimeout(this.draftMaxTimer);
    this.draftMaxTimer = undefined;
  }
  flush(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(!this.dirty);
    if (this.discarding) return Promise.resolve(false);
    this.clearTimers();
    if (this.inFlight)
      return this.inFlight.then((ok) => (ok ? this.flush() : false));
    this.inFlight = this.saveLatest().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  private async saveLatest(): Promise<boolean> {
    // Edits arriving during a slow write are captured by the next iteration.
    do {
      const draft = this.draft();
      if (!this.dirty) {
        await this.draftQueue;
        await this.adapter.clearDraft(draft).catch(() => {});
        if (this.dirty) continue;
        this.patch({ status: "saved", message: "", draftWarning: "" });
        return true;
      }
      this.patch({ status: "saving", message: "" });
      // The native save also backs up this revision. Don't let a slow backup stream starve file saves.
      void this.backup(draft);
      try {
        const result = await this.adapter.save(draft);
        this.patch({
          savedText: draft.text,
          version: result.version,
          status: this.state.text === draft.text ? "saved" : "pending",
          message: "",
          draftWarning: "",
        });
        await this.adapter.clearDraft(draft).catch(() => {});
        if (this.dirty) void this.backup();
      } catch (error) {
        const failure = saveError(error);
        this.clearTimers();
        this.patch({
          status: failure.code === "conflict" ? "conflict" : "error",
          message: failure.message,
        });
        // Persist the latest buffer, including typing that happened during the failed write.
        void this.backup();
        return false;
      }
    } while (this.dirty && !this.stopped && !this.discarding);
    return !this.dirty;
  }
  discard(): Promise<void> {
    if (this.discardFlight) return this.discardFlight;
    if (this.stopped) return Promise.resolve();
    this.discarding = true;
    this.clearTimers();
    this.discardFlight = (async () => {
      try {
        if (this.inFlight) await this.inFlight;
        await this.draftQueue;
        await this.adapter.clearDraft(this.draft());
        this.stop();
      } catch (error) {
        this.discarding = false;
        if (!this.stopped) {
          this.patch({
            status: "error",
            message: `结束编辑未完成：${saveError(error).message}。内容仍保留。`,
          });
          void this.backup();
        }
        throw error;
      } finally {
        this.discardFlight = null;
      }
    })();
    return this.discardFlight;
  }
  stop() {
    this.clearTimers();
    this.stopped = true;
    this.listeners.clear();
    if (!this.dirty)
      void this.draftQueue
        .then(() => this.adapter.clearDraft(this.draft()))
        .catch(() => {});
  }
}
