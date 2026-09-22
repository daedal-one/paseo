import { z } from "zod";
import type { ConnectionHostId, ISessions, SessionId, WorkspaceId } from "@deepseek-ai/dsh-client";
import type { DshCreationStorage } from "./creation-journal";
export type ForkRequest = Parameters<ISessions["forkTo"]>[0];
export interface ForkChild {
  readonly id: SessionId;
  readonly parentId: SessionId;
  readonly displayTitle: string;
  /** Null means no current Workspace baseline; [] means a ready baseline has no membership. */
  readonly workspaceIds: readonly WorkspaceId[] | null;
}
export type StoredForkOutcome =
  | { readonly kind: "unknown" | "confirmed" | "not-dispatched"; readonly request: ForkRequest }
  | {
      readonly kind: "attachment-failed";
      readonly request: ForkRequest;
      readonly workspaceId: WorkspaceId;
    }
  | { readonly kind: "adopted"; readonly request: ForkRequest; readonly child: ForkChild };
const requestSchema = z
  .object({
    sessionId: z.string().min(1),
    childSessionId: z.string().min(1),
    atSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
const childSchema = z
  .object({
    id: z.string().min(1),
    parentId: z.string().min(1),
    displayTitle: z.string(),
    workspaceIds: z.array(z.string().min(1)).nullable(),
  })
  .strict();
const recordSchema = z
  .object({
    version: z.literal(1),
    hostId: z.string().min(1),
    outcome: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("unknown"), request: requestSchema }).strict(),
      z.object({ kind: z.literal("confirmed"), request: requestSchema }).strict(),
      z.object({ kind: z.literal("not-dispatched"), request: requestSchema }).strict(),
      z
        .object({
          kind: z.literal("attachment-failed"),
          request: requestSchema,
          workspaceId: z.string().min(1),
        })
        .strict(),
      z.object({ kind: z.literal("adopted"), request: requestSchema, child: childSchema }).strict(),
    ]),
  })
  .strict();
const sameRequest = (a: ForkRequest, b: ForkRequest) =>
  a.childSessionId === b.childSessionId && a.sessionId === b.sessionId && a.atSeq === b.atSeq;
/** One attempt per Host in a dedicated fork database; unknown outcomes cannot be cleared. */
export class DshForkJournal {
  constructor(
    private readonly hostId: ConnectionHostId,
    private readonly storage: DshCreationStorage,
  ) {}
  private decode(text: string | null): StoredForkOutcome | null {
    if (text === null) return null;
    const record = recordSchema.parse(JSON.parse(text));
    if (record.hostId !== this.hostId) throw new Error("Fork record belongs to another Host");
    const outcome = record.outcome;
    if (
      outcome.kind === "adopted" &&
      (outcome.child.id !== outcome.request.childSessionId ||
        outcome.child.parentId !== outcome.request.sessionId)
    )
      throw new Error("Fork observation does not match its request");
    // The durable parser validates ids; the shared API owns their nominal types.
    return outcome as StoredForkOutcome;
  }
  private encode(outcome: StoredForkOutcome): string {
    const text = JSON.stringify({ version: 1, hostId: this.hostId, outcome });
    this.decode(text);
    return text;
  }
  async read(): Promise<StoredForkOutcome | null> {
    const { after } = await this.storage.transact(this.hostId, (text) => {
      this.decode(text);
      return text;
    });
    return this.decode(after);
  }
  async claim(request: ForkRequest) {
    const { before, after } = await this.storage.transact(this.hostId, (text) => {
      this.decode(text);
      return text ?? this.encode({ kind: "unknown", request });
    });
    return { claimed: before === null, outcome: this.decode(after)! };
  }
  async settle(outcome: StoredForkOutcome): Promise<StoredForkOutcome | null> {
    const { after } = await this.storage.transact(this.hostId, (text) => {
      const current = this.decode(text);
      if (current === null || !sameRequest(current.request, outcome.request)) return text;
      const maySettle =
        current.kind === "unknown" ||
        (current.kind === "attachment-failed" && outcome.kind === "adopted");
      return maySettle ? this.encode(outcome) : text;
    });
    return this.decode(after);
  }
  async clear(childId: SessionId): Promise<StoredForkOutcome | null> {
    const { after } = await this.storage.transact(this.hostId, (text) => {
      const current = this.decode(text);
      const resettable =
        current?.kind === "confirmed" ||
        current?.kind === "adopted" ||
        current?.kind === "not-dispatched";
      return resettable && current.request.childSessionId === childId ? null : text;
    });
    return this.decode(after);
  }
}
