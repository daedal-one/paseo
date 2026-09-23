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
  prepareDshPromptFileSources,
  snapshotDshPromptFile,
  type DshFileSubmission,
  type DshPromptFileSource,
  type DshSelectedPromptFile,
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
  selectedFiles: readonly DshSelectedPromptFile[];
  fileSubmission: DshFileSubmission;
  fileSelectionEpoch: number;
  draftLocked: boolean;
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
let selectionEpochSequence = 0;
function nextSelectionEpoch(): number {
  return ++selectionEpochSequence;
}

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
  readonly generation: ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
  dispatched: boolean;
  accepted: boolean;
  unsubscribe(): void;
}

interface FileSlot {
  readonly metadata: DshPromptFile;
  readonly receiptId?: DshFileReceiptId;
}
interface SelectedFile {
  readonly metadata: DshSelectedPromptFile;
  readonly source: DshPromptFileSource | null;
}
interface FileIntent {
  readonly text: string;
  readonly images: readonly DshPromptImage[];
  readonly generation: ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
  readonly controller: AbortController;
  sources: readonly DshPromptFileSource[];
  prepared: PreparedDshPromptFile[];
  active: boolean;
  dispatched: boolean;
  promptStarted: boolean;
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
    selectedFiles: [],
    fileSubmission: { kind: "idle" },
    fileSelectionEpoch: 0,
    draftLocked: false,
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
  private selected: readonly SelectedFile[] = [];
  private intent: FileIntent | null = null;
  private selectionEpoch = nextSelectionEpoch();
  private selectionSequence = 0;
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

  private retireSelection(): void {
    const previous = this.selected;
    this.selected = previous.map(({ metadata }) => ({
      metadata: Object.freeze({ ...metadata, status: "retired" as const }),
      source: null,
    }));
    for (const file of previous) file.source?.dispose?.();
  }

  private invalidateIntent(): void {
    const intent = this.intent;
    if (intent === null || !intent.active || intent.promptStarted) return;
    intent.active = false;
    intent.prepared = [];
    intent.sources = [];
    intent.controller.abort();
    if (intent.dispatched) this.retireSelection();
    const fileSubmission: DshFileSubmission = intent.dispatched
      ? { kind: "blocked", code: "generation-changed" }
      : { kind: "error", code: "generation-changed" };
    this.snapshot = { ...this.snapshot, fileSubmission };
  }

  private currentIntent(intent: FileIntent): boolean {
    return (
      !this.closed &&
      this.intent === intent &&
      intent.active &&
      this.connection.generation.getSnapshot() === intent.generation &&
      this.snapshot.availability === "ready"
    );
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
    const changed = generation !== this.generation;
    if (changed) this.selectionEpoch = nextSelectionEpoch();
    const lost = changed || availability !== "ready";
    if (lost) {
      this.retireFiles();
      this.invalidateIntent();
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
      selectedFiles: Object.freeze(this.selected.map(({ metadata }) => metadata)),
      fileSelectionEpoch: this.selectionEpoch,
      fileSubmission: Object.freeze(next.fileSubmission),
      draftLocked: this.frozen(next),
      fileUpload: Object.freeze(next.fileUpload),
      submission: Object.freeze(next.submission),
      canSend:
        this.pending === null &&
        next.availability === "ready" &&
        next.fileUpload.kind === "idle" &&
        this.files.every((file) => file.receiptId !== undefined) &&
        this.selected.every((file) => file.source !== null) &&
        (this.selected.length === 0 || next.fileAvailability === "ready") &&
        next.fileSubmission.kind !== "blocked" &&
        (next.text.trim() !== "" ||
          next.images.length > 0 ||
          this.files.length > 0 ||
          this.selected.length > 0) &&
        next.submission.kind !== "sending" &&
        next.submission.kind !== "unknown",
    });
    for (const listener of this.listeners) listener();
  }

  private frozen(snapshot = this.snapshot): boolean {
    return (
      this.closed ||
      this.intent?.active === true ||
      snapshot.fileSubmission.kind === "blocked" ||
      snapshot.submission.kind === "unknown" ||
      (this.attempt?.hasFiles === true && snapshot.submission.kind === "sending")
    );
  }

  /** Atomically append metadata/local handles only; a stale picker cannot mutate another epoch. */
  selectFiles(sources: readonly DshPromptFileSource[], expectedEpoch: number): boolean {
    if (
      this.frozen() ||
      this.attempt !== null ||
      expectedEpoch !== this.selectionEpoch ||
      this.pending !== null ||
      this.files.length > 0 ||
      this.selected.some((file) => file.source === null) ||
      this.snapshot.fileUpload.kind !== "idle" ||
      this.snapshot.fileAvailability !== "ready"
    )
      return false;
    const prepared = prepareDshPromptFileSources(
      sources,
      this.selected.length,
      this.selected.reduce((sum, file) => sum + file.metadata.bytes, 0),
    );
    if (prepared === undefined) return false;
    if (prepared.length === 0) return true;
    const added = prepared.map((source) => ({
      metadata: Object.freeze({
        id: `file-${this.selectionEpoch}-${++this.selectionSequence}`,
        name: source.name,
        bytes: source.bytes,
        status: "selected" as const,
      }),
      source,
    }));
    this.selected = [...this.selected, ...added];
    this.selectionEpoch = nextSelectionEpoch();
    this.publish({ fileSubmission: { kind: "idle" } });
    return true;
  }

  removeFile(id: string): boolean {
    if (
      this.frozen() ||
      this.pending !== null ||
      !this.selected.some((file) => file.metadata.id === id)
    )
      return false;
    const removed = this.selected.filter((file) => file.metadata.id === id);
    this.selected = this.selected.filter((file) => file.metadata.id !== id);
    this.selectionEpoch = nextSelectionEpoch();
    this.publish({ fileSubmission: { kind: "idle" } });
    for (const file of removed) file.source?.dispose?.();
    return true;
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
    if (this.frozen() || this.attempt !== null || this.selected.length > 0)
      return Promise.resolve(false);
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
    return this.startFileUpload(prepared);
  }

  private startFileUpload(prepared: PreparedDshPromptFile, intent?: FileIntent): Promise<boolean> {
    if (this.filePort === undefined) return Promise.resolve(false);
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
    const previouslyDispatched = intent?.dispatched ?? false;
    if (intent !== undefined) intent.dispatched = true;
    const operation = this.filePort.start(prepared.request);
    upload.operation = operation;
    if (operation === null) {
      if (intent !== undefined) intent.dispatched = previouslyDispatched;
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

  /** Retire local intent, not Host bytes. Prompt dispatch/uncertainty cannot be abandoned. */
  abandonFiles(): boolean {
    if (
      this.closed ||
      this.snapshot.submission.kind === "unknown" ||
      this.snapshot.submission.kind === "sending" ||
      this.intent?.promptStarted === true
    )
      return false;
    const intent = this.intent;
    if (intent !== null) {
      intent.active = false;
      intent.prepared = [];
      intent.sources = [];
      intent.controller.abort();
      this.intent = null;
      // The caller's old Promise still joins its physical read/upload; its completion cannot clear a new intent.
      this.pending = null;
    } else if (this.pending !== null) return false;
    this.invalidateUpload();
    this.upload = null;
    this.files = [];
    const removed = this.selected;
    this.selected = [];
    this.selectionEpoch = nextSelectionEpoch();
    this.publish({ fileUpload: { kind: "idle" }, fileSubmission: { kind: "idle" } });
    for (const file of removed) file.source?.dispose?.();
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
    this.selectionEpoch = nextSelectionEpoch();
    let intent: FileIntent | null = null;
    if (this.selected.length > 0) {
      intent = {
        text: this.snapshot.text,
        images: this.snapshot.images,
        generation: this.generation,
        controller: createDshAbortController(),
        sources: this.selected.flatMap((file) => (file.source === null ? [] : [file.source])),
        prepared: [],
        active: true,
        dispatched: false,
        promptStarted: false,
      };
      this.intent = intent;
      this.publish({ fileSubmission: { kind: "preparing" } });
    }
    const running = intent === null ? this.dispatchPrompt() : this.runFileIntent(intent);
    void running.then((accepted) => {
      if (this.pending === done) {
        if (this.intent === intent) this.intent = null;
        this.controller = null;
        this.pending = null;
        this.publish({});
      }
      resolve(accepted);
      return undefined;
    });
    return done;
  }

  private failIntent(intent: FileIntent, fileSubmission: DshFileSubmission): false {
    intent.active = false;
    intent.prepared = [];
    intent.sources = [];
    if (this.intent !== intent || this.closed) return false;
    if (intent.dispatched) {
      this.retireFiles();
      this.retireSelection();
    }
    this.publish({ fileSubmission });
    return false;
  }

  private async prepareIntent(intent: FileIntent): Promise<boolean> {
    let total = 0;
    for (const source of intent.sources) {
      if (!this.currentIntent(intent)) return false;
      let data: string;
      try {
        data = await source.read(intent.controller.signal);
      } catch {
        if (!this.currentIntent(intent)) return false;
        return this.failIntent(intent, { kind: "error", code: "read-failed" });
      }
      if (!this.currentIntent(intent)) return false;
      const prepared = prepareDshPromptFile(
        { data, name: source.name },
        intent.prepared.length,
        total,
      );
      if (prepared === undefined || prepared.metadata.bytes !== source.bytes) {
        return this.failIntent(intent, { kind: "error", code: "invalid-data" });
      }
      total += source.bytes;
      intent.prepared.push(prepared);
    }
    intent.sources = [];
    // Every file has passed validation. Release picker resources before mutation; never reread after staging.
    this.retireSelection();
    return this.currentIntent(intent);
  }

  private uploadNext(intent: FileIntent): Promise<boolean> {
    const prepared = intent.prepared.shift();
    return prepared === undefined ? Promise.resolve(false) : this.startFileUpload(prepared, intent);
  }

  private async runFileIntent(intent: FileIntent): Promise<boolean> {
    if (!(await this.prepareIntent(intent))) return false;
    while (intent.prepared.length > 0) {
      if (!this.currentIntent(intent)) return false;
      this.publish({ fileSubmission: { kind: "uploading" } });
      if (!this.currentIntent(intent)) return false;
      const uploaded = await this.uploadNext(intent);
      if (!this.currentIntent(intent)) return false;
      if (!uploaded) {
        return this.failIntent(
          intent,
          intent.dispatched
            ? { kind: "blocked", code: "upload-unknown" }
            : { kind: "error", code: "staging-unavailable" },
        );
      }
    }
    if (!this.currentIntent(intent)) return false;
    return this.dispatchPrompt(intent);
  }

  private dispatchPrompt(intent?: FileIntent): Promise<boolean> {
    const generation = intent?.generation ?? this.connection.generation.getSnapshot();
    const requestId = this.createRequestId();
    const admission = new PromptAdmission(this.binding, requestId);
    const attempt: PromptAttempt = {
      requestId,
      text: intent?.text ?? this.snapshot.text,
      images: intent?.images ?? this.snapshot.images,
      hasFiles: this.files.length > 0,
      draftRevision: this.draftRevision,
      admission,
      generation,
      dispatched: false,
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
    this.publish({
      submission: { kind: "sending", text: attempt.text, images: attempt.images },
      ...(intent === undefined ? {} : { fileSubmission: { kind: "sending" as const } }),
    });
    return this.submit(attempt, content, controller.signal, intent);
  }

  private ownsFilePrompt(
    attempt: PromptAttempt,
    signal: AbortSignal,
    intent?: FileIntent,
  ): boolean {
    return (
      !this.closed &&
      this.attempt === attempt &&
      !signal.aborted &&
      this.connection.generation.getSnapshot() === attempt.generation &&
      this.snapshot.availability === "ready" &&
      (intent === undefined || this.currentIntent(intent))
    );
  }

  private refuseBeforePrompt(attempt: PromptAttempt, intent?: FileIntent): false {
    if (this.closed || this.attempt !== attempt) return false;
    if (intent !== undefined && this.intent === intent) intent.active = false;
    this.retireFiles();
    this.retireSelection();
    this.releaseAttempt();
    this.publish({
      submission: { kind: "idle" },
      fileSubmission: { kind: "blocked", code: "generation-changed" },
    });
    return false;
  }

  private accept(attempt: PromptAttempt): boolean {
    if (this.closed || this.attempt !== attempt) return false;
    attempt.accepted = true;
    this.releaseAttempt();
    const unchanged = attempt.hasFiles || this.draftRevision === attempt.draftRevision;
    if (attempt.hasFiles) {
      this.files = [];
      this.retireSelection();
      this.selected = [];
      if (this.intent !== null) this.intent.active = false;
    }
    this.publish({
      text: unchanged ? "" : this.snapshot.text,
      images: unchanged ? [] : this.snapshot.images,
      fileSubmission: { kind: "idle" },
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
    this.publish({
      submission: { kind: "unknown", text: attempt.text, images: attempt.images },
      ...(this.selected.length === 0
        ? {}
        : { fileSubmission: { kind: "blocked" as const, code: "prompt-unknown" as const } }),
    });
    // Publication can synchronously deliver the exact admission; never lose that race.
    return attempt.accepted || this.acceptObserved(attempt);
  }

  private async submit(
    attempt: PromptAttempt,
    content: PromptContent,
    signal: AbortSignal,
    intent?: FileIntent,
  ): Promise<boolean> {
    // Sending publication is reentrant. Recheck file authority at the actual invocation boundary.
    if (attempt.hasFiles && !this.ownsFilePrompt(attempt, signal, intent))
      return this.refuseBeforePrompt(attempt, intent);
    let result: Awaited<ReturnType<SessionFace["prompt"]>>;
    try {
      if (this.closed) return false;
      attempt.dispatched = true;
      if (intent !== undefined) intent.promptStarted = true;
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
        if (this.intent !== null) this.intent.active = false;
        this.publish({
          submission: { kind: "rejected", code: result.error.code },
          ...(this.selected.length === 0
            ? {}
            : { fileSubmission: { kind: "blocked" as const, code: "prompt-rejected" as const } }),
        });
        return false;
      default:
        return this.markUnknown(attempt);
    }
  }

  /** Abort is best effort; the Host-wide upload gate joins the physical carrier. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.selectionEpoch = nextSelectionEpoch();
    if (this.intent !== null) {
      this.intent.active = false;
      this.intent.prepared = [];
      this.intent.sources = [];
      this.intent.controller.abort();
    }
    this.retireSelection();
    this.retireFiles();
    this.invalidateUpload();
    const undispatchedFiles = this.attempt?.hasFiles === true && !this.attempt.dispatched;
    this.releaseAttempt();
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.listeners.clear();
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...(undispatchedFiles
        ? {
            submission: Object.freeze({ kind: "idle" as const }),
            fileSubmission: Object.freeze({
              kind: "blocked" as const,
              code: "generation-changed" as const,
            }),
          }
        : {}),
      files: Object.freeze(this.files.map(({ metadata }) => metadata)),
      selectedFiles: Object.freeze(this.selected.map(({ metadata }) => metadata)),
      fileSelectionEpoch: this.selectionEpoch,
      draftLocked: true,
      availability: "unavailable",
      fileAvailability: "unavailable",
      canSend: false,
    });
    this.controller?.abort();
  }
}
