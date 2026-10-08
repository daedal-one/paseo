import type { Context } from "@deepseek-ai/cordis";
import {
  selectRemoteCapabilities,
  type ConnectionHandle,
  type HostCapabilities,
  type SessionId,
  type UserMessageNode,
} from "@deepseek-ai/dsh-client";
import { dshImageEndpoints } from "@getpaseo/protocol/dsh-access";
import { detectPromptImageMediaType } from "./ui/prompt-image-bytes";

export type ImageAttachmentRef = Extract<
  UserMessageNode["content"][number],
  { type: "image" }
>["attachment"];
type Reader = Pick<Context["remote"]["session"], "attachment">;
type ReadResult = Awaited<ReturnType<Reader["attachment"]>>;
type ReadRequest = Parameters<Reader["attachment"]>[0];
type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
type Availability = "available" | "offline" | "unavailable";
type Rejection = "failed" | "too-large";
const requirements = selectRemoteCapabilities(dshImageEndpoints);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SIDE = 4096;
const MAX_PIXELS = 4 * 1024 * 1024;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// Image keys remain distinct even when React reuses a row across view/Host replacements.
let imageSequence = 0;

interface ImageReadSnapshot {
  readonly busy: boolean;
  readonly closed: boolean;
}
type ImageRead =
  | { readonly status: "reading"; readonly result: Promise<ReadResult> }
  | { readonly status: "busy" | "closed" };

/** Host-owned physical concurrency gate, shared by every view of this runtime. */
export class DshImageReads {
  private snapshot: ImageReadSnapshot = { busy: false, closed: false };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly reader: Reader) {}

  getSnapshot = (): ImageReadSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: ImageReadSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  read(request: ReadRequest): ImageRead {
    if (this.snapshot.closed) return { status: "closed" };
    if (this.snapshot.busy) return { status: "busy" };
    this.publish({ ...this.snapshot, busy: true });
    const result = this.perform(request);
    return { status: "reading", result };
  }

  private async perform(request: ReadRequest): Promise<ReadResult> {
    try {
      // The generated RPC has no AbortSignal parameter. Only settlement frees this slot.
      return await this.reader.attachment(request);
    } finally {
      this.publish({ ...this.snapshot, busy: false });
    }
  }

  /** Forbid new reads synchronously; the transport owner disposes HTTP separately. */
  close(): void {
    if (this.snapshot.closed) return;
    this.publish({ ...this.snapshot, closed: true });
  }
}

interface ImageSelection {
  readonly owner: object;
  readonly id: ImageAttachmentRef["attachmentId"];
  readonly ref: ImageAttachmentRef;
}
export interface DshImageReady extends ImageSelection {
  readonly status: "ready";
  readonly uri: string;
  readonly sequence: number;
}
export type DshImagePreview =
  | { readonly status: "idle" }
  | (ImageSelection & { readonly status: "loading" | "busy" | Rejection })
  | DshImageReady;
export interface DshImagesSnapshot {
  readonly availability: Availability;
  readonly busy: boolean;
  readonly preview: DshImagePreview;
}

function validateRef(ref: ImageAttachmentRef): Rejection | undefined {
  const { width, height, bytes, mediaType } = ref;
  const positiveIntegers = [width, height, bytes].every(
    (value) => Number.isSafeInteger(value) && value > 0,
  );
  if (!positiveIntegers) return "failed";
  const raster = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mediaType);
  if (!raster) return "failed";
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS || bytes > MAX_BYTES)
    return "too-large";
  return undefined;
}

function validateData(data: string, ref: ImageAttachmentRef): Rejection | undefined {
  // This bounds retention/rendering, NOT RPC transport memory: RPC has parsed the body already.
  if (data.length > Math.ceil(MAX_BYTES / 3) * 4) return "too-large";
  if (data.length === 0 || data.length % 4 !== 0) return "failed";
  let padding = 0;
  if (data.endsWith("==")) padding = 2;
  else if (data.endsWith("=")) padding = 1;
  const end = data.length - padding;
  const bytes = (data.length / 4) * 3 - padding;
  if (bytes > MAX_BYTES) return "too-large";
  if (bytes !== ref.bytes) return "failed";
  // A bounded linear scan avoids whole-payload decoding and regex backtracking/stack limits.
  for (let index = 0; index < end; index += 1) {
    if (BASE64.indexOf(data[index]!) < 0) return "failed";
  }
  const last = BASE64.indexOf(data[end - 1]!);
  if (padding === 2 && (last & 15) !== 0) return "failed";
  if (padding === 1 && (last & 3) !== 0) return "failed";
  if (detectPromptImageMediaType(data) !== ref.mediaType) return "failed";
  return undefined;
}

/** One retained preview per active view; no implicit reads, retries, or transport cancellation. */
export class DshImages {
  private snapshot: DshImagesSnapshot = {
    availability: "offline",
    busy: false,
    preview: { status: "idle" },
  };
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeGeneration: () => void;
  private readonly unsubscribeReads: () => void;
  private generation: Generation;
  private token = Symbol();
  private pending: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly sessionId: SessionId,
    private readonly reads: DshImageReads,
    private readonly connection: Pick<ConnectionHandle, "generation">,
    private readonly readCapabilities: () => HostCapabilities | undefined,
  ) {
    this.unsubscribeGeneration = connection.generation.subscribe(this.sync);
    this.unsubscribeReads = reads.subscribe(this.syncReads);
    this.sync();
  }

  getSnapshot = (): DshImagesSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: DshImagesSnapshot): void {
    if (this.closed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private availability(): Availability {
    if (this.generation === undefined || this.reads.getSnapshot().closed) return "offline";
    const capabilities = this.readCapabilities()?.capabilities;
    const admitted = requirements.every((expected) => {
      const actual = capabilities?.find((value) => value.endpoint === expected.endpoint);
      return (
        actual !== undefined &&
        actual.availability !== "unavailable" &&
        actual.mode === expected.mode &&
        actual.wireFingerprint === expected.wireFingerprint &&
        actual.semanticRevision === expected.semanticRevision
      );
    });
    return admitted ? "available" : "unavailable";
  }

  private sync = (): void => {
    if (this.closed) return;
    const generation = this.connection.generation.getSnapshot();
    if (generation !== this.generation) {
      this.generation = generation;
      this.token = Symbol();
      this.pending = null;
      this.snapshot = { ...this.snapshot, preview: { status: "idle" } };
    }
    this.publish({
      ...this.snapshot,
      availability: this.availability(),
      busy: this.reads.getSnapshot().busy,
    });
  };

  private syncReads = (): void => {
    if (this.closed) return;
    if (this.reads.getSnapshot().closed) {
      this.token = Symbol();
      this.pending = null;
      this.snapshot = { ...this.snapshot, preview: { status: "idle" } };
    }
    this.sync();
  };

  load = (ref: ImageAttachmentRef, owner: object = ref): Promise<void> => {
    if (this.closed || this.snapshot.availability !== "available") return Promise.resolve();
    const preview = this.snapshot.preview;
    const repeated =
      preview.status === "loading" && preview.owner === owner && preview.id === ref.attachmentId;
    if (repeated && this.pending !== null) return this.pending;
    const token = Symbol();
    this.token = token;
    this.pending = null;
    const selection = { id: ref.attachmentId, ref, owner };
    const rejection = validateRef(ref);
    if (rejection !== undefined) {
      this.publish({ ...this.snapshot, preview: { ...selection, status: rejection } });
      return Promise.resolve();
    }
    const read = this.reads.read({ sessionId: this.sessionId, attachmentId: ref.attachmentId });
    if (read.status !== "reading") {
      this.publish({ ...this.snapshot, preview: { ...selection, status: "busy" } });
      return Promise.resolve();
    }
    const sequence = ++imageSequence;
    const current = () => !this.closed && this.token === token;
    this.publish({ ...this.snapshot, preview: { ...selection, status: "loading" } });
    const task = read.result
      .then((result) => {
        if (!current()) return undefined;
        if (!result.ok) {
          this.publish({ ...this.snapshot, preview: { ...selection, status: "failed" } });
          return undefined;
        }
        const { attachment, data } = result.value;
        const same =
          attachment.attachmentId === ref.attachmentId &&
          attachment.mediaType === ref.mediaType &&
          attachment.width === ref.width &&
          attachment.height === ref.height &&
          attachment.bytes === ref.bytes;
        const failure = same ? validateData(data, ref) : "failed";
        if (failure !== undefined) {
          this.publish({ ...this.snapshot, preview: { ...selection, status: failure } });
          return undefined;
        }
        this.publish({
          ...this.snapshot,
          preview: {
            ...selection,
            status: "ready",
            sequence,
            uri: `data:${ref.mediaType};base64,${data}`,
          },
        });
        return undefined;
      })
      .catch(() => {
        if (current())
          this.publish({ ...this.snapshot, preview: { ...selection, status: "failed" } });
      })
      .finally(() => {
        if (current()) this.pending = null;
      });
    this.pending = task;
    return task;
  };

  decodeFailed = (ready: DshImageReady): void => {
    if (this.closed || this.snapshot.preview !== ready) return;
    this.publish({
      ...this.snapshot,
      preview: { status: "failed", id: ready.id, ref: ready.ref, owner: ready.owner },
    });
  };

  hide = (owner?: object): void => {
    if (this.closed) return;
    const preview = this.snapshot.preview;
    if (owner !== undefined && (preview.status === "idle" || preview.owner !== owner)) return;
    this.token = Symbol();
    this.pending = null;
    this.publish({ ...this.snapshot, preview: { status: "idle" } });
  };

  /** Synchronous publication cancellation; never wait for an uncancellable RPC. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.token = Symbol();
    this.pending = null;
    this.unsubscribeGeneration();
    this.unsubscribeReads();
    this.listeners.clear();
    this.snapshot = {
      availability: "offline",
      busy: this.reads.getSnapshot().busy,
      preview: { status: "idle" },
    };
  }
}
