import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DshAccessError,
  parseStoredDshHost,
  type StoredDshHost,
  type DesktopDshHost,
} from "@getpaseo/protocol/dsh-access";
import type { ConnectionHostId } from "@deepseek-ai/dsh-client";

export interface DshProtectedStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

/** One main-process writer. Device grants never appear in unencrypted files or descriptors. */
export class DesktopDshDeviceStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly file: string,
    private readonly storage: DshProtectedStorage,
    private readonly platform: NodeJS.Platform,
  ) {}

  private checkStorage(): void {
    if (
      !this.storage.isEncryptionAvailable() ||
      (this.platform === "linux" && this.storage.getSelectedStorageBackend() === "basic_text")
    ) {
      throw new DshAccessError("storage-unavailable");
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation).catch((error: unknown) => {
      if (error instanceof DshAccessError) throw error;
      throw new DshAccessError("storage-unavailable");
    });
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(): Promise<StoredDshHost[]> {
    this.checkStorage();
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    try {
      const value: unknown = JSON.parse(this.storage.decryptString(encrypted));
      if (!Array.isArray(value)) throw new DshAccessError("invalid-record");
      const records = value.map(parseStoredDshHost);
      if (new Set(records.map((record) => record.grant.hostId)).size !== records.length)
        throw new DshAccessError("invalid-record");
      return records;
    } catch {
      throw new DshAccessError("invalid-record");
    }
  }

  private async write(records: StoredDshHost[]): Promise<void> {
    this.checkStorage();
    const bytes = this.storage.encryptString(JSON.stringify(records));
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  list(): Promise<DesktopDshHost[]> {
    return this.serialize(async () =>
      (await this.read()).map((record) => ({
        hostId: record.grant.hostId,
        origin: record.origin,
        label: record.grant.device.label,
      })),
    );
  }

  load(hostId: ConnectionHostId): Promise<StoredDshHost | null> {
    return this.serialize(
      async () => (await this.read()).find((record) => record.grant.hostId === hostId) ?? null,
    );
  }

  save(value: StoredDshHost): Promise<void> {
    return this.serialize(async () => {
      const record = parseStoredDshHost(value);
      const records = await this.read();
      if (records.some((item) => item.grant.hostId === record.grant.hostId))
        throw new DshAccessError("already-paired");
      await this.write([...records, record]);
    });
  }

  forget(hostId: ConnectionHostId): Promise<void> {
    return this.serialize(async () =>
      this.write((await this.read()).filter((record) => record.grant.hostId !== hostId)),
    );
  }
}
