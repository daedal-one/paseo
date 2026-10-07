import { z } from "zod";
import { brandString } from "@deepseek-ai/dsh-brand";
import type {
  ConnectionHostId,
  SessionId,
  SessionSelection,
  SessionSelectionStore,
} from "@deepseek-ai/dsh-client";

const row = z.object({
  id: z.string(),
  title: z.string().max(512),
  text: z.string().max(128_000),
  draft: z.string().max(64_000),
  savedAt: z.number(),
});
const record = z.object({
  version: z.literal(1),
  selected: z.string().nullable(),
  address: z
    .object({
      parentSessionId: z.string(),
      childSessionId: z.string(),
      mode: z.enum(["one-shot", "continuable"]),
    })
    .optional(),
  rows: z.array(row).max(8),
});
export type CachedConversation = z.infer<typeof row>;
type CacheRecord = z.infer<typeof record>;
export interface ContinuumStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
const keyOf = (hostId: ConnectionHostId) => `daedal-dsh:continuum:v1:${hostId}`;
const empty = (): CacheRecord => ({ version: 1, selected: null, rows: [] });

/** Disposable readable previews and navigation, scoped to a durable Host identity. */
export class DshContinuum {
  private record = empty();
  private writes: Promise<void> = Promise.resolve();
  private failed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private payload: string | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(
    readonly hostId: ConnectionHostId,
    private readonly storage: ContinuumStorage,
  ) {}
  getSnapshot = () => this.record;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  async restore(): Promise<void> {
    const raw = await this.storage.getItem(keyOf(this.hostId));
    if (raw === null) return;
    try {
      this.record = record.parse(JSON.parse(raw));
    } catch {
      await this.storage.removeItem(keyOf(this.hostId));
    }
  }
  readonly selection: SessionSelectionStore = {
    getSnapshot: (): SessionSelection =>
      this.record.selected === null
        ? {}
        : {
            sessionId: brandString<SessionId>(this.record.selected),
            ...(this.record.address === undefined
              ? {}
              : {
                  subagentAddress: {
                    ...this.record.address,
                    parentSessionId: brandString<SessionId>(this.record.address.parentSessionId),
                    childSessionId: brandString<SessionId>(this.record.address.childSessionId),
                  },
                }),
          },
    set: (value) =>
      this.update({
        ...this.record,
        selected: value.sessionId ?? null,
        address: value.subagentAddress,
      }),
  };
  private update(value: CacheRecord): void {
    this.record = value;
    for (const listener of this.listeners) listener();
    this.payload = JSON.stringify(value);
    if (this.timer === null) this.timer = setTimeout(() => this.enqueue(), 250);
  }
  save(id: SessionId, title: string, text: string, draft: string, savedAt: number): void {
    const preview = {
      id,
      title: title.slice(0, 512),
      text: text.slice(-128_000),
      draft: draft.slice(0, 64_000),
      savedAt,
    };
    const rows = [preview, ...this.record.rows.filter((item) => item.id !== id)].slice(0, 8);
    this.update({ ...this.record, rows });
  }
  private enqueue(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const payload = this.payload;
    this.payload = null;
    if (payload !== null)
      this.writes = this.writes
        .then(async () => {
          await this.storage.setItem(keyOf(this.hostId), payload);
          this.failed = false;
          return undefined;
        })
        .catch(() => {
          this.failed = true;
        });
  }
  async flush(): Promise<void> {
    this.enqueue();
    await this.writes;
    if (this.failed) throw new Error("Continuum storage unavailable");
  }
  async forget(): Promise<void> {
    this.enqueue();
    await this.writes;
    await this.storage.removeItem(keyOf(this.hostId));
    this.record = empty();
  }
}
