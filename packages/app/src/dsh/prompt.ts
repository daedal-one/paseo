import {
  PromptAdmission,
  type ConnectionHandle,
  type SessionBinding,
  type SessionFace,
  type SessionRequestId,
} from "@deepseek-ai/dsh-client";
import { createDshAbortController } from "../runtime/dsh-abort-controller";

export type DshPromptSubmission =
  | { kind: "idle" }
  | { kind: "sending"; text: string; images: readonly DshPromptImage[] }
  | { kind: "accepted" }
  | { kind: "rejected"; code: string }
  | { kind: "unknown"; text: string; images: readonly DshPromptImage[] };
export interface DshPromptSnapshot {
  text: string;
  images: readonly DshPromptImage[];
  availability: "ready" | "offline" | "unavailable" | "subagent";
  submission: DshPromptSubmission;
  canSend: boolean;
}

/** The attachment media types the Host's prompt contract admits for browser-owned uploads. */
export type DshPromptImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/**
 * One image the client sends as prompt content. The Host promotes these bytes to a durable
 * attachment reference; the client owns no attachment URL and stores no copy.
 */
export interface DshPromptImage {
  readonly mediaType: DshPromptImageMediaType;
  readonly data: string;
  readonly name?: string;
}

type PromptContent = Parameters<SessionFace["prompt"]>[0];
type PromptContentPart = PromptContent[number];

function sameImages(left: readonly DshPromptImage[], right: readonly DshPromptImage[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((image, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      image.mediaType === other.mediaType &&
      image.data === other.data &&
      image.name === other.name
    );
  });
}

interface PromptAttempt {
  readonly requestId: SessionRequestId;
  readonly text: string;
  readonly images: readonly DshPromptImage[];
  readonly draftRevision: number;
  readonly admission: PromptAdmission;
  unsubscribe(): void;
}

/**
 * Build the wire content for one attempt: the text part only when there is text, then the
 * images in draft order. A blank draft with images is a valid Host prompt.
 */
function promptContent(attempt: PromptAttempt): PromptContent {
  const content: PromptContentPart[] = [];
  if (attempt.text.trim() !== "") content.push({ type: "text", text: attempt.text });
  for (const image of attempt.images)
    content.push({
      type: "image",
      mediaType: image.mediaType,
      data: image.data,
      ...(image.name === undefined ? {} : { name: image.name }),
    });
  return content;
}

/** A transient draft with one Host admission attempt; an unknown outcome cannot be resent. */
export class DshPrompt {
  private snapshot: DshPromptSnapshot = {
    text: "",
    images: [],
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

  private attempt: PromptAttempt | null = null;

  constructor(
    private readonly binding: Pick<SessionBinding, "session" | "eventSource">,
    private readonly connection: ConnectionHandle,
    private readonly createRequestId: () => SessionRequestId,
  ) {
    this.unsubscribe = [
      binding.session.subscribe(this.refresh),
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
    const session = this.binding.session.getSnapshot();
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
        this.pending === null &&
        next.availability === "ready" &&
        (next.text.trim() !== "" || next.images.length > 0) &&
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

  /** Replace the ordered image attachments for the next send; an unknown outcome stays frozen. */
  setImages = (images: readonly DshPromptImage[]): void => {
    if (this.closed || this.snapshot.submission.kind === "unknown") return;
    if (!sameImages(images, this.snapshot.images)) this.draftRevision += 1;
    this.publish({
      images: [...images],
      ...(this.snapshot.submission.kind === "accepted"
        ? { submission: { kind: "idle" as const } }
        : {}),
    });
  };

  send(): Promise<boolean> {
    if (this.pending !== null) return this.pending;
    if (this.closed || !this.snapshot.canSend) return Promise.resolve(false);
    const requestId = this.createRequestId();
    const admission = new PromptAdmission(this.binding, requestId);
    const attempt: PromptAttempt = {
      requestId,
      text: this.snapshot.text,
      images: [...this.snapshot.images],
      draftRevision: this.draftRevision,
      admission,
      unsubscribe: admission.subscribe(() => {
        if (this.snapshot.submission.kind === "unknown") this.acceptObserved(attempt);
      }),
    };
    this.attempt = attempt;
    const controller = createDshAbortController();
    this.controller = controller;
    this.publish({ submission: { kind: "sending", text: attempt.text, images: attempt.images } });
    this.pending = this.submit(attempt, controller.signal).finally(() => {
      this.controller = null;
      this.pending = null;
      this.publish({});
    });
    return this.pending;
  }

  private accept(attempt: PromptAttempt): boolean {
    if (this.closed || this.attempt !== attempt) return false;
    this.releaseAttempt();
    const unchanged = this.draftRevision === attempt.draftRevision;
    this.publish({
      text: unchanged ? "" : this.snapshot.text,
      images: unchanged ? [] : this.snapshot.images,
      submission: { kind: "accepted" },
    });
    return true;
  }

  private acceptObserved(attempt: PromptAttempt): boolean {
    return attempt.admission.getSnapshot() === "observed" && this.accept(attempt);
  }

  private releaseAttempt(): void {
    if (this.attempt === null) return;
    this.attempt.unsubscribe();
    this.attempt.admission.dispose();
    this.attempt = null;
  }

  private async submit(attempt: PromptAttempt, signal: AbortSignal): Promise<boolean> {
    let result: Awaited<ReturnType<SessionFace["prompt"]>>;
    try {
      result = await this.binding.session.prompt(
        promptContent(attempt),
        "queue",
        signal,
        attempt.requestId,
      );
    } catch {
      // A lost or malformed reply leaves admission unknown until authoritative evidence arrives.
      if (this.acceptObserved(attempt)) return true;
      this.publish({ submission: { kind: "unknown", text: attempt.text, images: attempt.images } });
      return false;
    }
    if (this.closed) return false;
    if (result.ok || attempt.admission.getSnapshot() === "observed") return this.accept(attempt);
    // These Host checks precede prompt admission. Other errors may follow acceptance.
    switch (result.error.code) {
      case "gateway/bad-request":
      case "gateway/api-incompatible":
      case "session/invalid-time-zone":
      case "session/model-unavailable":
      case "session/not-found":
        this.releaseAttempt();
        this.publish({ submission: { kind: "rejected", code: result.error.code } });
        break;
      default:
        this.publish({
          submission: { kind: "unknown", text: attempt.text, images: attempt.images },
        });
    }
    return false;
  }

  /** Release observers and abort only this request; Host execution is never cancelled. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseAttempt();
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.listeners.clear();
    this.snapshot = { ...this.snapshot, availability: "unavailable", canSend: false };
    this.controller?.abort();
  }
}
