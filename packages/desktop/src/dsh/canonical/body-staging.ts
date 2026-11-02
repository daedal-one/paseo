import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_BODY_CHUNK_BYTES } from "@getpaseo/protocol/dsh-canonical";

/** A private native temporary file, consumed once by one authenticated request. */
export class CanonicalBodyStage {
  readonly ready: Promise<void>;
  private pending: Promise<unknown>;
  private directory: string | null = null;
  private handle: FileHandle | null = null;
  private closed = false;
  private sealed = false;
  private sequence = 0;
  private closing: Promise<void> | null = null;
  private filename: string | null = null;
  constructor() {
    this.ready = this.create();
    this.pending = this.ready;
  }
  private async create(): Promise<void> {
    this.directory = await mkdtemp(join(tmpdir(), "dsh-body-"));
    try {
      this.filename = join(this.directory, "body");
      this.handle = await open(this.filename, "wx", 0o600);
      if (this.closed) throw new Error("Body staging cancelled");
    } catch (error) {
      await this.handle?.close();
      this.handle = null;
      await rm(this.directory, { recursive: true, force: true });
      throw error;
    }
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.pending.then(operation);
    this.pending = task;
    return task;
  }
  write(sequence: number, encoded: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.closed || this.sealed || this.handle === null || sequence !== this.sequence)
        throw new Error("Body staging refused");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length > CANONICAL_BODY_CHUNK_BYTES || bytes.toString("base64") !== encoded)
        throw new Error("Malformed body chunk");
      let offset = 0;
      while (offset < bytes.length) {
        const result = await this.handle.write(bytes, offset, bytes.length - offset);
        if (result.bytesWritten === 0) throw new Error("Body staging write failed");
        offset += result.bytesWritten;
      }
      this.sequence++;
    });
  }
  seal(): Promise<void> {
    return this.enqueue(async () => {
      if (this.closed || this.sealed || this.handle === null)
        throw new Error("Body staging refused");
      await this.handle.close();
      this.handle = null;
      this.sealed = true;
    });
  }
  path(): string {
    if (this.closed || !this.sealed || this.filename === null)
      throw new Error("Body staging incomplete");
    return this.filename;
  }
  dispose(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closed = true;
    this.closing = this.pending
      .catch(() => {})
      .then(async () => {
        await this.handle?.close();
        this.handle = null;
        if (this.directory !== null) await rm(this.directory, { recursive: true, force: true });
        return undefined;
      });
    return this.closing;
  }
}

/** Native staging identities never contain filesystem paths or Host request identities. */
export class CanonicalBodyStaging {
  private readonly stages = new Map<string, CanonicalBodyStage>();
  private closed = false;
  open(id: string): Promise<void> {
    if (this.closed || this.stages.has(id))
      return Promise.reject(new Error("Body identity refused"));
    const stage = new CanonicalBodyStage();
    this.stages.set(id, stage);
    return stage.ready;
  }
  write(id: string, sequence: number, data: string): Promise<void> {
    return this.get(id).write(sequence, data);
  }
  seal(id: string): Promise<void> {
    return this.get(id).seal();
  }
  private get(id: string): CanonicalBodyStage {
    const stage = this.stages.get(id);
    if (this.closed || stage === undefined) throw new Error("Body identity unavailable");
    return stage;
  }
  take(id: string): CanonicalBodyStage {
    const stage = this.get(id);
    stage.path();
    this.stages.delete(id);
    return stage;
  }
  async discard(id: string): Promise<void> {
    const stage = this.stages.get(id);
    this.stages.delete(id);
    await stage?.dispose();
  }
  async dispose(): Promise<void> {
    this.closed = true;
    const stages = [...this.stages.values()];
    this.stages.clear();
    await Promise.all(stages.map((stage) => stage.dispose()));
  }
}
