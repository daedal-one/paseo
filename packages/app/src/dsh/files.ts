import type { Context } from "@deepseek-ai/cordis";
import { selectRemoteCapabilities, type HostCapabilities } from "@deepseek-ai/dsh-client";
import { dshFileUploadEndpoints } from "@getpaseo/protocol/dsh-access";
import { createDshAbortController } from "../runtime/dsh-abort-controller";

type FileUploadRemote = Context["remote"]["fileUploads"]["upload"];
type FileUploadResult = Awaited<ReturnType<FileUploadRemote>>;
type FileUploadValue = Extract<FileUploadResult, { readonly ok: true }>["value"];
type FileUploadRequest = Parameters<FileUploadRemote>[1];
type FileUploadSessionId = Parameters<FileUploadRemote>[0];
type FileAttachment = FileUploadValue["file"];
type FileReceiptId = FileUploadValue["receiptId"];

const FILE_UPLOAD_REQUIREMENTS = selectRemoteCapabilities(dshFileUploadEndpoints);
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const RECEIPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ATTACHMENT_ID = /^sha256:[0-9a-f]{64}$/;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

/** Conservative in-memory limits for the JSON/base64 fallback; the Host advertises no file limits. */
export const DSH_PROMPT_FILE_LIMITS = Object.freeze({
  maxFiles: 4,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxNameBytes: 255,
});

export interface DshPromptFileInput {
  /** Canonical base64 for the exact file bytes; an empty string represents an empty file. */
  readonly data: string;
  /** Optional display name. The Host owns sanitization and may return a different name. */
  readonly name?: string;
}

/** Local picker handle only. Reading/encoding is deferred until an explicit Send. */
export interface DshPromptFileSource {
  readonly name: string;
  readonly bytes: number;
  read(signal: AbortSignal): Promise<string>;
  /** Release only resources owned by this handle; implementations defer cleanup until active reads settle. */
  dispose?(): void;
}

export interface DshSelectedPromptFile {
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
  readonly status: "selected" | "retired";
}

export type DshFileSubmission =
  | { readonly kind: "idle" | "preparing" | "uploading" | "sending" }
  | {
      readonly kind: "error";
      readonly code: "read-failed" | "invalid-data" | "generation-changed" | "staging-unavailable";
    }
  | {
      readonly kind: "blocked";
      readonly code: "upload-unknown" | "generation-changed" | "prompt-rejected" | "prompt-unknown";
    };

export function prepareDshPromptFileSources(
  sources: readonly DshPromptFileSource[],
  currentCount: number,
  currentBytes: number,
): readonly DshPromptFileSource[] | undefined {
  if (!Array.isArray(sources) || currentCount + sources.length > DSH_PROMPT_FILE_LIMITS.maxFiles)
    return undefined;
  const prepared: DshPromptFileSource[] = [];
  let total = currentBytes;
  for (const source of sources) {
    if (typeof source !== "object" || source === null) return undefined;
    const { name, bytes, read, dispose } = source;
    if (typeof name !== "string" || !boundedInputName(name) || typeof read !== "function")
      return undefined;
    if (dispose !== undefined && typeof dispose !== "function") return undefined;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > DSH_PROMPT_FILE_LIMITS.maxFileBytes)
      return undefined;
    total += bytes;
    if (total > DSH_PROMPT_FILE_LIMITS.maxTotalBytes) return undefined;
    let disposed = false;
    const release = () => {
      if (disposed) return;
      disposed = true;
      // Cleanup is best effort and never changes mutation admission or retry authority.
      try {
        void Promise.resolve(dispose?.call(source)).catch(() => undefined);
      } catch {
        /* The resource owner retains its cleanup diagnostics. */
      }
    };
    prepared.push(Object.freeze({ name, bytes, read: read.bind(source), dispose: release }));
  }
  return prepared;
}

export interface DshPromptFile {
  readonly attachmentId: FileAttachment["attachmentId"];
  readonly name: string;
  readonly bytes: number;
  readonly status: "ready" | "retired";
}

export interface DshPromptFileInputMetadata {
  readonly bytes: number;
  readonly name?: string;
}

export type DshPromptFileUploadState =
  | { readonly kind: "idle" }
  | ({ readonly kind: "uploading" } & DshPromptFileInputMetadata)
  | ({ readonly kind: "unknown" } & DshPromptFileInputMetadata);

export type DshPromptFileAvailability = "ready" | "offline" | "unavailable" | "subagent";

export interface PreparedDshPromptFile {
  readonly request: FileUploadRequest;
  readonly metadata: DshPromptFileInputMetadata;
}

export interface DshPromptFilePort {
  capabilities(): HostCapabilities | undefined;
  start(request: FileUploadRequest): DshFileUploadOperation | null;
}

export interface DshFileUploadOperation {
  readonly signal: AbortSignal;
  readonly result: Promise<FileUploadResult>;
  abort(): void;
}

interface OwnedUploadOperation extends DshFileUploadOperation {
  readonly controller: AbortController;
  result: Promise<FileUploadResult>;
}

function decodedBase64Bytes(data: string): number | undefined {
  if (data.length === 0) return 0;
  if (data.length % 4 !== 0) return undefined;
  if (data.length > Math.ceil(DSH_PROMPT_FILE_LIMITS.maxFileBytes / 3) * 4) return undefined;
  let padding = 0;
  if (data.endsWith("==")) padding = 2;
  else if (data.endsWith("=")) padding = 1;
  const end = data.length - padding;
  for (let index = 0; index < end; index += 1) {
    if (BASE64.indexOf(data[index]!) < 0) return undefined;
  }
  const last = BASE64.indexOf(data[end - 1]!);
  if (last < 0 || (padding === 2 && (last & 15) !== 0) || (padding === 1 && (last & 3) !== 0)) {
    return undefined;
  }
  const bytes = (data.length / 4) * 3 - padding;
  return bytes <= DSH_PROMPT_FILE_LIMITS.maxFileBytes ? bytes : undefined;
}

function boundedInputName(name: unknown): name is string | undefined {
  if (name === undefined) return true;
  if (typeof name !== "string" || name.length > DSH_PROMPT_FILE_LIMITS.maxNameBytes) return false;
  return new TextEncoder().encode(name).byteLength <= DSH_PROMPT_FILE_LIMITS.maxNameBytes;
}

function canonicalStoredName(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) return false;
  if (new TextEncoder().encode(name).byteLength > 255 || name.trim() !== name) return false;
  for (const character of name) {
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  if (
    name === "." ||
    name === ".." ||
    /[\\/<>:"|?*]/u.test(name) ||
    /[. ]$/u.test(name) ||
    WINDOWS_DEVICE_NAME.test(name.split(".")[0]!.replace(/[. ]+$/u, ""))
  ) {
    return false;
  }
  return true;
}

export function prepareDshPromptFile(
  input: DshPromptFileInput,
  currentCount: number,
  currentBytes: number,
): PreparedDshPromptFile | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const { data, name } = input;
  if (typeof data !== "string" || !boundedInputName(name)) return undefined;
  const bytes = decodedBase64Bytes(data);
  if (
    bytes === undefined ||
    currentCount >= DSH_PROMPT_FILE_LIMITS.maxFiles ||
    currentBytes + bytes > DSH_PROMPT_FILE_LIMITS.maxTotalBytes
  ) {
    return undefined;
  }
  const metadata = Object.freeze({
    bytes,
    ...(name === undefined ? {} : { name }),
  });
  return {
    request: Object.freeze({
      data,
      ...(name === undefined ? {} : { name }),
    }),
    metadata,
  };
}

export function dshFileUploadAvailable(capabilities: HostCapabilities | undefined): boolean {
  return FILE_UPLOAD_REQUIREMENTS.every((expected) => {
    const actual = capabilities?.capabilities.find((value) => value.endpoint === expected.endpoint);
    return (
      actual !== undefined &&
      actual.availability !== "unavailable" &&
      actual.mode === expected.mode &&
      actual.wireFingerprint === expected.wireFingerprint &&
      actual.semanticRevision === expected.semanticRevision
    );
  });
}

export function validateDshFileUploadValue(
  value: unknown,
  expectedBytes: number,
): FileUploadValue | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as { readonly receiptId?: unknown; readonly file?: unknown };
  if (typeof candidate.receiptId !== "string" || !RECEIPT_ID.test(candidate.receiptId)) {
    return undefined;
  }
  if (typeof candidate.file !== "object" || candidate.file === null) return undefined;
  const file = candidate.file as {
    readonly attachmentId?: unknown;
    readonly name?: unknown;
    readonly bytes?: unknown;
  };
  if (
    typeof file.attachmentId !== "string" ||
    !ATTACHMENT_ID.test(file.attachmentId) ||
    !canonicalStoredName(file.name) ||
    !Number.isSafeInteger(file.bytes) ||
    typeof file.bytes !== "number" ||
    file.bytes < 0 ||
    file.bytes !== expectedBytes
  ) {
    return undefined;
  }
  return value as FileUploadValue;
}

export function snapshotDshPromptFile(
  file: FileAttachment,
  status: DshPromptFile["status"],
): DshPromptFile {
  return Object.freeze({
    attachmentId: file.attachmentId,
    name: file.name,
    bytes: file.bytes,
    status,
  });
}

/** One physical generated upload at a time for all active and retiring views of a Host runtime. */
export class DshFileUploads {
  private current: OwnedUploadOperation | null = null;
  private closed = false;
  private closing: Promise<void> | null = null;

  constructor(private readonly remote: Pick<Context["remote"]["fileUploads"], "upload">) {}

  start(sessionId: FileUploadSessionId, request: FileUploadRequest): DshFileUploadOperation | null {
    if (this.closed || this.current !== null) return null;
    const controller = createDshAbortController();
    let resolve!: (result: FileUploadResult | PromiseLike<FileUploadResult>) => void;
    let reject!: (reason?: unknown) => void;
    const carrier = new Promise<FileUploadResult>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const operation: OwnedUploadOperation = {
      controller,
      signal: controller.signal,
      result: carrier,
      abort: () => controller.abort(),
    };
    operation.result = carrier.finally(() => {
      if (this.current === operation) this.current = null;
    });
    this.current = operation;
    try {
      void this.remote.upload(sessionId, request, controller.signal).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    return operation;
  }

  /** Abort publication/transport best-effort and join the physical carrier before disposal resolves. */
  close(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closed = true;
    const current = this.current;
    current?.controller.abort();
    this.closing =
      current === null
        ? Promise.resolve()
        : current.result.then(
            () => undefined,
            () => undefined,
          );
    return this.closing;
  }
}

export type DshFileReceiptId = FileReceiptId;
export type DshFileUploadValue = FileUploadValue;
