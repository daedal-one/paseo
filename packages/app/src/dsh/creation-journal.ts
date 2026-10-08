import { z } from "zod";
import type { ConnectionHostId, SessionId } from "@deepseek-ai/dsh-client";
import type { DshCreationOutcome } from "./creation";

export type StoredCreationOutcome = Exclude<DshCreationOutcome, { kind: "idle" | "sending" }>;
export type CreationAttempt = Exclude<DshCreationOutcome, { kind: "idle" }>["request"];
/** The callback runs atomically with the read and committed write, across store owners. */
export interface DshCreationStorage {
  transact(
    hostId: ConnectionHostId,
    update: (current: string | null) => string | null,
  ): Promise<{ before: string | null; after: string | null }>;
}
const requestSchema = z
  .object({
    sessionId: z.string().min(1),
    cwd: z.string().optional(),
    workspaceId: z.string().min(1).optional(),
    agentPreset: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => value.cwd === undefined || value.workspaceId === undefined);
const recordSchema = z
  .object({
    version: z.literal(1),
    hostId: z.string().min(1),
    outcome: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("unknown"), request: requestSchema, published: z.boolean() })
        .strict(),
      z.object({ kind: z.literal("accepted"), request: requestSchema }).strict(),
      z
        .object({ kind: z.literal("rejected"), request: requestSchema, code: z.string().min(1) })
        .strict(),
      z.object({ kind: z.literal("attachment-failed"), request: requestSchema }).strict(),
    ]),
  })
  .strict();
const terminal = (outcome: StoredCreationOutcome) =>
  outcome.kind === "accepted" || outcome.kind === "rejected";

/** One durable outstanding attempt per Host. Records contain no pairing credential. */
export class DshCreationJournal {
  constructor(
    private readonly hostId: ConnectionHostId,
    private readonly storage: DshCreationStorage,
  ) {}
  private decode = (text: string | null): StoredCreationOutcome | null => {
    if (text === null) return null;
    const record = recordSchema.parse(JSON.parse(text));
    if (record.hostId !== this.hostId) throw new Error("Creation record belongs to another Host");
    // The durable parser validates opaque identifiers; the shared API owns their nominal types.
    return record.outcome as StoredCreationOutcome;
  };
  private encode = (outcome: StoredCreationOutcome): string =>
    JSON.stringify({ version: 1, hostId: this.hostId, outcome });
  async read(): Promise<StoredCreationOutcome | null> {
    const { after } = await this.storage.transact(this.hostId, (text) => {
      this.decode(text);
      return text;
    });
    return this.decode(after);
  }
  async claim(
    request: CreationAttempt,
  ): Promise<{ claimed: boolean; outcome: StoredCreationOutcome }> {
    const { before, after } = await this.storage.transact(this.hostId, (text) => {
      this.decode(text);
      return text ?? this.encode({ kind: "unknown", request, published: false });
    });
    return { claimed: before === null, outcome: this.decode(after)! };
  }
  async settle(outcome: StoredCreationOutcome): Promise<StoredCreationOutcome | null> {
    const { after } = await this.storage.transact(this.hostId, (text) => {
      const current = this.decode(text);
      if (
        current === null ||
        current.request.sessionId !== outcome.request.sessionId ||
        terminal(current)
      )
        return text;
      if (
        outcome.kind === "unknown" &&
        (current.kind === "attachment-failed" ||
          (current.kind === "unknown" && current.published && !outcome.published))
      )
        return text;
      return this.encode(outcome);
    });
    return this.decode(after);
  }
  async clear(sessionId: SessionId): Promise<StoredCreationOutcome | null> {
    const { after } = await this.storage.transact(this.hostId, (text) => {
      const current = this.decode(text);
      return current !== null && current.request.sessionId === sessionId && terminal(current)
        ? null
        : text;
    });
    return this.decode(after);
  }
}
