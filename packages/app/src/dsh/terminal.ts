import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionId, SessionTerminalId } from "@deepseek-ai/dsh-client";
import type { DshHostRuntime } from "./runtime";
import { createDshAbortController } from "../runtime/dsh-abort-controller";
import { featureAvailable, remoteValue } from "./features";
export interface TerminalSnapshot {
  text: string;
  offset: number;
  status: "closed" | "connecting" | "open" | "failed";
}
/** One explicit user terminal; network recovery never opens a replacement shell or resends input. */
export class DshTerminal {
  private snapshot: TerminalSnapshot = { text: "", offset: 0, status: "closed" };
  private readonly listeners = new Set<() => void>();
  private live: {
    controller: AbortController;
    terminalId: SessionTerminalId;
    limit: number;
  } | null = null;
  private read: Promise<void> | null = null;
  private writes = Promise.resolve();
  private release: (() => void) | null = null;
  constructor(
    private readonly runtime: DshHostRuntime,
    private readonly sessionId: SessionId,
    private readonly randomId: () => string,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: TerminalSnapshot) {
    this.snapshot = value;
    for (const listener of this.listeners) listener();
  }
  start(rows: number, cols: number): void {
    if (
      this.live !== null ||
      !featureAvailable(this.runtime, [
        "session/terminal",
        "session/terminalInput",
        "session/terminalResize",
      ])
    )
      return;
    const generation = this.runtime.connection.generation.getSnapshot();
    const live = {
      controller: createDshAbortController(),
      terminalId: brandString<SessionTerminalId>(this.randomId()),
      limit: 0,
    };
    this.live = live;
    this.release = this.runtime.connection.generation.subscribe(() => {
      if (this.runtime.connection.generation.getSnapshot() !== generation) live.controller.abort();
    });
    this.publish({ text: "", offset: 0, status: "connecting" });
    this.read = this.consume(live, rows, cols);
  }
  private async consume(
    live: NonNullable<DshTerminal["live"]>,
    rows: number,
    cols: number,
  ): Promise<void> {
    try {
      for await (const frame of this.runtime.remote.session.terminal(
        { sessionId: this.sessionId, terminalId: live.terminalId, rows, cols },
        live.controller.signal,
      )) {
        if (live.controller.signal.aborted) break;
        if (frame.kind === "ready") {
          live.limit = frame.maxInputBytes;
          this.publish({ ...this.snapshot, status: "open" });
        } else if (frame.kind === "output") {
          const text = this.snapshot.text + frame.data;
          let cut = Math.max(0, text.length - 128_000);
          if (cut > 0 && /[\uDC00-\uDFFF]/u.test(text.charAt(cut))) cut++;
          this.publish({
            ...this.snapshot,
            text: text.slice(cut),
            offset: this.snapshot.offset + cut,
          });
        } else this.publish({ ...this.snapshot, status: "closed" });
      }
      if (this.snapshot.status !== "failed") this.publish({ ...this.snapshot, status: "closed" });
    } catch {
      this.publish({
        ...this.snapshot,
        status: live.controller.signal.aborted ? "closed" : "failed",
      });
    }
  }
  input = (data: string): void => {
    const live = this.live;
    if (live === null || this.snapshot.status !== "open") return;
    this.writes = this.writes
      .then(async () => {
        for (let offset = 0; offset < data.length; ) {
          if (live.controller.signal.aborted || this.snapshot.status !== "open") return undefined;
          let end = Math.min(data.length, offset + Math.max(1, Math.floor(live.limit / 4)));
          if (end < data.length && /[\uD800-\uDBFF]/u.test(data.charAt(end - 1))) end--;
          if (end === offset) end = Math.min(offset + 2, data.length);
          remoteValue(
            await this.runtime.remote.session.terminalInput(
              {
                sessionId: this.sessionId,
                terminalId: live.terminalId,
                data: data.slice(offset, end),
              },
              live.controller.signal,
            ),
          );
          offset = end;
        }
        return undefined;
      })
      .catch(() => {
        if (!live.controller.signal.aborted) {
          this.publish({ ...this.snapshot, status: "failed" });
          live.controller.abort();
        }
      });
  };
  resize = (rows: number, cols: number): void => {
    const live = this.live;
    if (live === null || this.snapshot.status !== "open") return;
    void this.runtime.remote.session
      .terminalResize(
        { sessionId: this.sessionId, terminalId: live.terminalId, rows, cols },
        live.controller.signal,
      )
      .then(
        (result) => {
          if (!result.ok && !live.controller.signal.aborted)
            this.publish({ ...this.snapshot, status: "failed" });
          return undefined;
        },
        () => {
          if (!live.controller.signal.aborted) this.publish({ ...this.snapshot, status: "failed" });
          return undefined;
        },
      );
  };
  async dispose(): Promise<void> {
    this.release?.();
    this.release = null;
    this.live?.controller.abort();
    await Promise.all([this.read, this.writes]);
    this.live = null;
    this.listeners.clear();
  }
}
