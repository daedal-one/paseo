import { z } from "zod";
import type { Branded } from "@deepseek-ai/dsh-brand";
import type { ConnectionHostId, WorkspaceView } from "@deepseek-ai/dsh-client";
import type { DshCreationStorage } from "./creation-journal";

export type RegistrationAttemptId = Branded<"RegistrationAttemptId">;
export interface RegistrationRequest {
  readonly attemptId: RegistrationAttemptId;
  readonly path: string;
}
export type RegistrationWorkspace = Pick<WorkspaceView, "workspaceId" | "path" | "title">;
export type StoredRegistrationOutcome =
  | { readonly kind: "unknown" | "not-dispatched"; readonly request: RegistrationRequest }
  | {
      readonly kind: "confirmed" | "adopted";
      readonly request: RegistrationRequest;
      readonly workspace: RegistrationWorkspace;
    };
const requestSchema = z.object({ attemptId: z.string().min(1), path: z.string().min(1) }).strict();
const workspaceSchema = z
  .object({ workspaceId: z.string().min(1), path: z.string().min(1), title: z.string() })
  .strict();
const recordSchema = z
  .object({
    version: z.literal(1),
    hostId: z.string().min(1),
    outcome: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("unknown"), request: requestSchema }).strict(),
      z.object({ kind: z.literal("not-dispatched"), request: requestSchema }).strict(),
      z
        .object({
          kind: z.literal("confirmed"),
          request: requestSchema,
          workspace: workspaceSchema,
        })
        .strict(),
      z
        .object({ kind: z.literal("adopted"), request: requestSchema, workspace: workspaceSchema })
        .strict(),
    ]),
  })
  .strict();

/** Uses a dedicated registration database, never the Session creation database. */
export class DshRegistrationJournal {
  constructor(
    private readonly hostId: ConnectionHostId,
    private readonly storage: DshCreationStorage,
  ) {}
  private decode(text: string | null): StoredRegistrationOutcome | null {
    if (text === null) return null;
    const record = recordSchema.parse(JSON.parse(text));
    if (record.hostId !== this.hostId)
      throw new Error("Registration record belongs to another Host");
    // Durable parsing validates the opaque identifiers; their nominal types come from the owners.
    return record.outcome as StoredRegistrationOutcome;
  }
  private encode(outcome: StoredRegistrationOutcome): string {
    return JSON.stringify({ version: 1, hostId: this.hostId, outcome });
  }
  async read(): Promise<StoredRegistrationOutcome | null> {
    const { after } = await this.storage.transact(this.hostId, (text) => {
      this.decode(text);
      return text;
    });
    return this.decode(after);
  }
  async claim(request: RegistrationRequest) {
    const { before, after } = await this.storage.transact(this.hostId, (text) => {
      this.decode(text);
      return text ?? this.encode({ kind: "unknown", request });
    });
    return { claimed: before === null, outcome: this.decode(after)! };
  }
  async settle(outcome: StoredRegistrationOutcome): Promise<StoredRegistrationOutcome | null> {
    const { after } = await this.storage.transact(this.hostId, (text) => {
      const current = this.decode(text);
      if (
        current === null ||
        current.request.attemptId !== outcome.request.attemptId ||
        current.kind !== "unknown"
      )
        return text;
      return this.encode(outcome);
    });
    return this.decode(after);
  }
  async clear(attemptId: RegistrationAttemptId): Promise<StoredRegistrationOutcome | null> {
    const { after } = await this.storage.transact(this.hostId, (text) => {
      const current = this.decode(text);
      return current !== null &&
        current.request.attemptId === attemptId &&
        current.kind !== "unknown"
        ? null
        : text;
    });
    return this.decode(after);
  }
}
