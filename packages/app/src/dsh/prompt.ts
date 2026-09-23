import {
  PromptAdmission,
  type ConnectionHandle,
  type SessionBinding,
  type SessionFace,
  type SessionRequestId,
} from "@deepseek-ai/dsh-client";
import { createDshAbortController } from "../runtime/dsh-abort-controller";
import {
  dshFileUploadAvailable,
  prepareDshPromptFile,
  snapshotDshPromptFile,
  validateDshFileUploadValue,
  type DshFileReceiptId,
  type DshFileUploadOperation,
  type DshFileUploadValue,
  type DshPromptFile,
  type DshPromptFileAvailability,
  type DshPromptFileInput,
  type DshPromptFilePort,
  type DshPromptFileUploadState,
  type PreparedDshPromptFile,
} from "./files";

export type DshPromptSubmission =
  | { kind: "idle" }
  | { kind: "sending"; text: string; images: readonly DshPromptImage[] }
  | { kind: "accepted" }
  | { kind: "rejected"; code: string }
  | { kind: "unknown"; text: string; images: readonly DshPromptImage[] };
export interface DshPromptSnapshot {
  text: string;
  images: readonly DshPromptImage[];
  files: readonly DshPromptFile[];
  fileUpload: DshPromptFileUploadState;
  fileAvailability: DshPromptFileAvailability;
  availability: "ready" | "offline" | "unavailable" | "subagent";
  submission: DshPromptSubmission;
  canSend: boolean;
}

export type DshPromptImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** Inline image bytes are promoted by the Host during prompt admission. */
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
  readonly hasFiles: boolean;
  readonly draftRevision: number;
  readonly admission: PromptAdmission;
  accepted: boolean;
  unsubscribe(): void;
}

interface FileSlot {
  readonly metadata: DshPromptFile;
  readonly receiptId?: DshFileReceiptId;
}
interface UploadAttempt {
  input: DshPromptFileInput | null;
  readonly metadata: PreparedDshPromptFile["metadata"];
  readonly done: Promise<boolean>;
  operation: DshFileUploadOperation | null;
  active: boolean;
}

function promptContent(
  attempt: PromptAttempt,
  receipts: readonly DshFileReceiptId[],
): PromptContent {
  const content: PromptContentPart[] = [];
  if (attempt.text.trim() !== "") content.push({ type: "text", text: attempt.text });
  for (const image of attempt.images)
    content.push({
      type: "image",
      mediaType: image.mediaType,
      data: image.data,
      ...(image.name === undefined ? {} : { name: image.name }),
    });
  for (const receiptId of receipts) content.push({ type: "file", receiptId });
  return content;
}

/** Session-view-owned one-use receipts; no query, recovery, persistence or automatic replay. */
export class DshPrompt {
  private snapshot: DshPromptSnapshot = {
    text: "",
    images: [],
    files: [],
    fileUpload: { kind: "idle" },
    fileAvailability: "unavailable",
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
  private files: readonly FileSlot[] = [];
  private upload: UploadAttempt | null = null;
  private generation: ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;

  constructor(
    private readonly binding: Pick<SessionBinding, "session" | "eventSource">,
    private readonly connection: ConnectionHandle,
    private readonly createRequestId: () => SessionRequestId,
    private readonly filePort?: DshPromptFilePort,
  ) {
    this.generation = connection.generation.getSnapshot();
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

  private retireFiles(): void {
    this.files = this.files.map(({ metadata }) => ({
      metadata: snapshotDshPromptFile(metadata, "retired"),
    }));
  }

  private invalidateUpload(): void {
    const upload = this.upload;
    if (upload === null) return;
    upload.active = false;
    upload.input = null;
    upload.operation?.abort();
    this.snapshot = { ...this.snapshot, fileUpload: { kind: "unknown", ...upload.metadata } };
  }

  private refresh = (): void => {
    if (this.closed) return;
    const generation = this.connection.generation.getSnapshot();
    const session = this.binding.session.getSnapshot();
    let availability: DshPromptSnapshot["availability"];
    if (session.subagent !== null) availability = "subagent";
    else if (session.removed || session.openState !== "open") availability = "unavailable";
    else if (generation === undefined) availability = "offline";
    else availability = "ready";
    const lost = generation !== this.generation || availability !== "ready";
    if (lost) {
      this.retireFiles();
      this.invalidateUpload();
    }
    this.generation = generation;
    let fileAvailability: DshPromptFileAvailability = availability;
    if (
      availability === "ready" &&
      (this.filePort === undefined || !dshFileUploadAvailable(this.filePort.capabilities()))
    ) {
      fileAvailability = "unavailable";
    }
    this.publish({ availability, fileAvailability });
  };

  private publish(patch: Partial<DshPromptSnapshot>): void {
    if (this.closed) return;
    const next = { ...this.snapshot, ...patch };
    this.snapshot = Object.freeze({
      ...next,
      images: Object.freeze(next.images),
      files: Object.freeze(this.files.map(({ metadata }) => metadata)),
      fileUpload: Object.freeze(next.fileUpload),
      submission: Object.freeze(next.submission),
      canSend:
        this.pending === null &&
        next.availability === "ready" &&
        next.fileUpload.kind === "idle" &&
        this.files.every((file) => file.receiptId !== undefined) &&
        (next.text.trim() !== "" || next.images.length > 0 || this.files.length > 0) &&
        next.submission.kind !== "sending" &&
        next.submission.kind !== "unknown",
    });
    for (const listener of this.listeners) listener();
  }

  private frozen(): boolean {
    return (
      this.closed ||
      this.snapshot.submission.kind === "unknown" ||
      (this.attempt?.hasFiles === true && this.snapshot.submission.kind === "sending")
    );
  }

  setText = (text: string): void => {
    if (this.frozen()) return;
    if (text !== this.snapshot.text) this.draftRevision += 1;
    this.publish({
      text,
      ...(this.snapshot.submission.kind === "accepted"
        ? { submission: { kind: "idle" as const } }
        : {}),
    });
  };

  setImages = (images: readonly DshPromptImage[]): void => {
    if (this.frozen()) return;
    if (!sameImages(images, this.snapshot.images)) this.draftRevision += 1;
    this.publish({
      images: Object.freeze(images.map((image) => Object.freeze({ ...image }))),
      ...(this.snapshot.submission.kind === "accepted"
        ? { submission: { kind: "idle" as const } }
        : {}),
    });
  };

  /** Deliberate upload primitive for future Send orchestration, never selection or mount. */
  stageFile(input: DshPromptFileInput): Promise<boolean> {
    if (this.frozen()) return Promise.resolve(false);
    if (this.upload !== null) {
      const prior = this.upload.input;
      return prior !== null && prior.data === input?.data && prior.name === input?.name
        ? this.upload.done
        : Promise.resolve(false);
    }
    if (
      this.pending !== null ||
      this.snapshot.fileUpload.kind !== "idle" ||
      this.snapshot.fileAvailability !== "ready" ||
      this.filePort === undefined ||
      this.files.some((file) => file.receiptId === undefined)
    )
      return Promise.resolve(false);
    const prepared = prepareDshPromptFile(
      input,
      this.files.length,
      this.files.reduce((total, file) => total + file.metadata.bytes, 0),
    );
    if (prepared === undefined) return Promise.resolve(false);
    let resolve!: (value: boolean) => void;
    const done = new Promise<boolean>((finish) => {
      resolve = finish;
    });
    const upload: UploadAttempt = {
      input: prepared.request,
      metadata: prepared.metadata,
      done,
      operation: null,
      active: true,
    };
    // Reserve before the gate invokes the carrier, which can synchronously reenter or lose generation.
    this.upload = upload;
    const operation = this.filePort.start(prepared.request);
    upload.operation = operation;
    if (operation === null) {
      this.upload = null;
      upload.input = null;
      resolve(false);
      return done;
    }
    if (!upload.active || this.closed) operation.abort();
    else this.publish({ fileUpload: { kind: "uploading", ...upload.metadata } });
    void this.finishUpload(upload, operation).then(resolve);
    return done;
  }

  private async finishUpload(
    upload: UploadAttempt,
    operation: DshFileUploadOperation,
  ): Promise<boolean> {
    let value: DshFileUploadValue | undefined;
    try {
      const result = await operation.result;
      if (result.ok) value = validateDshFileUploadValue(result.value, upload.metadata.bytes);
    } catch {
      // Every dispatched failure can follow a Host save; none is retry-safe.
    }
    upload.input = null;
    if (this.closed || this.upload !== upload) return false;
    this.upload = null;
    const receiptId = value?.receiptId;
    const duplicate =
      receiptId !== undefined && this.files.some((file) => file.receiptId === receiptId);
    if (!upload.active || operation.signal.aborted || value === undefined || duplicate) {
      this.publish({ fileUpload: { kind: "unknown", ...upload.metadata } });
      return false;
    }
    this.files = [
      ...this.files,
      {
        metadata: snapshotDshPromptFile(value.file, "ready"),
        receiptId: value.receiptId,
      },
    ];
    this.publish({ fileUpload: { kind: "idle" } });
    return true;
  }

  /** Retire local intent, not Host bytes. A dispatched unknown prompt cannot be abandoned. */
  abandonFiles(): boolean {
    if (this.frozen() || this.pending !== null) return false;
    this.invalidateUpload();
    this.upload = null;
    this.files = [];
    this.publish({ fileUpload: { kind: "idle" } });
    return true;
  }

  send(): Promise<boolean> {
    if (this.pending !== null) return this.pending;
    if (this.closed || !this.snapshot.canSend || this.upload !== null)
      return Promise.resolve(false);
    let resolve!: (value: boolean) => void;
    const done = new Promise<boolean>((finish) => {
      resolve = finish;
    });
    this.pending = done;
    const requestId = this.createRequestId();
    const admission = new PromptAdmission(this.binding, requestId);
    const attempt: PromptAttempt = {
      requestId,
      text: this.snapshot.text,
      images: this.snapshot.images,
      hasFiles: this.files.length > 0,
      draftRevision: this.draftRevision,
      admission,
      accepted: false,
      unsubscribe: () => {},
    };
    this.attempt = attempt;
    attempt.unsubscribe = admission.subscribe(() => {
      if (this.snapshot.submission.kind === "unknown") this.acceptObserved(attempt);
    });
    const receipts = this.files.flatMap((file) =>
      file.receiptId === undefined ? [] : [file.receiptId],
    );
    const content = promptContent(attempt, receipts);
    this.retireFiles();
    const controller = createDshAbortController();
    this.controller = controller;
    this.publish({ submission: { kind: "sending", text: attempt.text, images: attempt.images } });
    void this.submit(attempt, content, controller.signal).then((accepted) => {
      this.controller = null;
      this.pending = null;
      this.publish({});
      resolve(accepted);
      return undefined;
    });
    return done;
  }

  private accept(attempt: PromptAttempt): boolean {
    if (this.closed || this.attempt !== attempt) return false;
    attempt.accepted = true;
    this.releaseAttempt();
    const unchanged = attempt.hasFiles || this.draftRevision === attempt.draftRevision;
    if (attempt.hasFiles) this.files = [];
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

  private markUnknown(attempt: PromptAttempt): boolean {
    if (this.closed || this.attempt !== attempt) return false;
    this.publish({ submission: { kind: "unknown", text: attempt.text, images: attempt.images } });
    // Publication can synchronously deliver the exact admission; never lose that race.
    return attempt.accepted || this.acceptObserved(attempt);
  }

  private async submit(
    attempt: PromptAttempt,
    content: PromptContent,
    signal: AbortSignal,
  ): Promise<boolean> {
    let result: Awaited<ReturnType<SessionFace["prompt"]>>;
    try {
      if (this.closed) return false;
      result = await this.binding.session.prompt(content, "queue", signal, attempt.requestId);
    } catch {
      if (this.acceptObserved(attempt)) return true;
      return this.markUnknown(attempt);
    }
    if (this.closed) return false;
    if (result.ok || attempt.admission.getSnapshot() === "observed") return this.accept(attempt);
    switch (result.error.code) {
      case "gateway/bad-request":
      case "gateway/api-incompatible":
      case "session/invalid-time-zone":
      case "session/model-unavailable":
      case "session/not-found":
        this.releaseAttempt();
        this.publish({ submission: { kind: "rejected", code: result.error.code } });
        return false;
      default:
        return this.markUnknown(attempt);
    }
  }

  /** Abort is best effort; the Host-wide upload gate joins the physical carrier. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.retireFiles();
    this.invalidateUpload();
    this.releaseAttempt();
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.listeners.clear();
    this.snapshot = Object.freeze({
      ...this.snapshot,
      files: Object.freeze(this.files.map(({ metadata }) => metadata)),
      availability: "unavailable",
      fileAvailability: "unavailable",
      canSend: false,
    });
    this.controller?.abort();
  }
}
