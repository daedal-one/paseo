import type { ConnectionHandle, SessionFace } from "@deepseek-ai/dsh-client";
import { createDshAbortController } from "../runtime/dsh-abort-controller";

export type DshPromptSubmission =
  | { kind: "idle" }
  | { kind: "sending"; text: string }
  | { kind: "accepted" }
  | { kind: "rejected"; code: string }
  | { kind: "unknown"; text: string };
export interface DshPromptSnapshot {
  text: string;
  availability: "ready" | "offline" | "unavailable" | "subagent";
  submission: DshPromptSubmission;
  canSend: boolean;
}

/** A transient draft with one Host admission attempt; an unknown outcome cannot be resent. */
export class DshPrompt {
  private snapshot: DshPromptSnapshot = {
    text: "",
    availability: "unavailable",
    submission: { kind: "idle" },
    canSend: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: (() => void)[];
  private closed = false;
  private draftRevision = 0;
  private controller: AbortController | null = null;
  private pending: Promise<boolean> | null = null;

  constructor(
    private readonly session: SessionFace,
    private readonly connection: ConnectionHandle,
  ) {
    this.unsubscribe = [
      session.subscribe(this.refresh),
      connection.generation.subscribe(this.refresh),
    ];
    this.refresh();
  }

  getSnapshot = (): DshPromptSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private refresh = (): void => {
    if (this.closed) return;
    const session = this.session.getSnapshot();
    let availability: DshPromptSnapshot["availability"];
    if (session.subagent !== null) availability = "subagent";
    else if (session.removed || session.openState !== "open") availability = "unavailable";
    else if (this.connection.generation.getSnapshot() === undefined) availability = "offline";
    else availability = "ready";
    if (availability !== this.snapshot.availability) this.publish({ availability });
  };

  private publish(patch: Partial<DshPromptSnapshot>): void {
    if (this.closed) return;
    const next = { ...this.snapshot, ...patch };
    this.snapshot = {
      ...next,
      canSend:
        next.availability === "ready" &&
        next.text.trim() !== "" &&
        next.submission.kind !== "sending" &&
        next.submission.kind !== "unknown",
    };
    for (const listener of this.listeners) listener();
  }

  setText = (text: string): void => {
    if (this.closed || this.snapshot.submission.kind === "unknown") return;
    if (text !== this.snapshot.text) this.draftRevision += 1;
    this.publish({
      text,
      ...(this.snapshot.submission.kind === "accepted"
        ? { submission: { kind: "idle" as const } }
        : {}),
    });
  };

  send(): Promise<boolean> {
    if (this.pending !== null) return this.pending;
    if (this.closed || !this.snapshot.canSend) return Promise.resolve(false);
    const text = this.snapshot.text;
    const controller = createDshAbortController();
    this.controller = controller;
    this.publish({ submission: { kind: "sending", text } });
    this.pending = this.submit(text, this.draftRevision, controller.signal).finally(() => {
      this.controller = null;
      this.pending = null;
    });
    return this.pending;
  }

  private async submit(text: string, draftRevision: number, signal: AbortSignal): Promise<boolean> {
    let result: Awaited<ReturnType<SessionFace["prompt"]>>;
    try {
      result = await this.session.prompt([{ type: "text", text }], "queue", signal);
    } catch {
      // A lost or malformed reply cannot establish whether the Host accepted the text.
      this.publish({ submission: { kind: "unknown", text } });
      return false;
    }
    if (this.closed) return false;
    if (result.ok) {
      this.publish({
        text: this.draftRevision === draftRevision ? "" : this.snapshot.text,
        submission: { kind: "accepted" },
      });
      return true;
    }
    // These Host checks precede prompt admission. Other errors may follow acceptance.
    switch (result.error.code) {
      case "gateway/bad-request":
      case "gateway/api-incompatible":
      case "session/invalid-time-zone":
      case "session/model-unavailable":
      case "session/not-found":
        this.publish({ submission: { kind: "rejected", code: result.error.code } });
        break;
      default:
        this.publish({ submission: { kind: "unknown", text } });
    }
    return false;
  }

  /** Release observers and abort only this request; Host execution is never cancelled. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.listeners.clear();
    this.snapshot = { ...this.snapshot, availability: "unavailable", canSend: false };
    this.controller?.abort();
  }
}
