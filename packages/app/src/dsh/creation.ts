import type { Context } from "@deepseek-ai/cordis";
import {
  SessionCreateError,
  selectRemoteCapabilities,
  type ConnectionHandle,
  type HostCapabilities,
  type ISessions,
  type IWorkspaces,
  type SessionId,
} from "@deepseek-ai/dsh-client";
import type { DshCreationJournal, StoredCreationOutcome } from "./creation-journal";
import { dshCreationEndpoints } from "@getpaseo/protocol/dsh-access";

type Request = NonNullable<Parameters<ISessions["create"]>[0]>;
export type DshCreationSelection = Omit<Request, "sessionId">;
type Attempt = DshCreationSelection & { readonly sessionId: SessionId };
type RosterResult = Awaited<ReturnType<Context["remote"]["agentPresets"]["list"]>>;
type Roster = Extract<RosterResult, { ok: true }>["value"];
type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
type Availability = "available" | "offline" | "unavailable";
export type DshCreationOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "sending"; readonly request: Attempt }
  | { readonly kind: "accepted"; readonly request: Attempt }
  | {
      readonly kind: "rejected";
      readonly request: Attempt;
      readonly code: string;
    }
  | {
      readonly kind: "unknown";
      readonly request: Attempt;
      readonly published: boolean;
    }
  | { readonly kind: "attachment-failed"; readonly request: Attempt };
export interface DshCreationSnapshot {
  readonly storage: "loading" | "ready" | "failed" | "unavailable";
  readonly availability: Availability;
  readonly catalog: Availability;
  readonly roster: "idle" | "loading" | "ready" | "failed";
  readonly profiles: Roster["presets"];
  readonly outcome: DshCreationOutcome;
  readonly selectionError:
    | "profile-unavailable"
    | "workspace-unavailable"
    | "ambiguous-target"
    | null;
}
const requirements = selectRemoteCapabilities(dshCreationEndpoints);
const rejections = new Set([
  "gateway/bad-request",
  "gateway/invocation-unavailable",
  "workspace/not-found",
  "agent-preset/not-found",
  "agent-preset/conflict",
  "session/conflict",
]);

/** One Host's creation attempt. Shared Session and Workspace state remain the publication authority. */
export class DshCreation {
  private snapshot: DshCreationSnapshot = {
    storage: "loading",
    availability: "offline",
    catalog: "offline",
    roster: "idle",
    profiles: [],
    outcome: { kind: "idle" },
    selectionError: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: (() => void)[];
  private readonly owned = new Set<Promise<void>>();
  private generation: Generation;
  private catalogRead: Promise<void> | null = null;
  private creation: Promise<void> | null = null;
  private closed = false;
  private recovery: Promise<void> | null = null;
  private persisting: Promise<void> | null = null;

  constructor(
    private readonly sessions: Pick<ISessions, "create" | "list" | "refresh">,
    private readonly workspaces: Pick<IWorkspaces, "list">,
    private readonly connection: Pick<ConnectionHandle, "generation">,
    private readonly capabilities: () => HostCapabilities | undefined,
    private readonly readRoster: Context["remote"]["agentPresets"]["list"],
    private readonly createId: () => SessionId,
    private readonly journal?: DshCreationJournal,
  ) {
    if (journal === undefined) this.snapshot = { ...this.snapshot, storage: "unavailable" };
    this.unsubscribe = [
      connection.generation.subscribe(this.sync),
      sessions.list.subscribe(this.reconcileObserved),
      workspaces.list.subscribe(this.reconcileObserved),
    ];
    this.sync();
  }

  getSnapshot = (): DshCreationSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<DshCreationSnapshot>): void {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private own(task: Promise<void>): Promise<void> {
    this.owned.add(task);
    void task.then(
      () => this.owned.delete(task),
      () => this.owned.delete(task),
    );
    return task;
  }
  private sync = (): void => {
    if (this.closed) return;
    const generation = this.connection.generation.getSnapshot();
    if (generation === this.generation) return;
    this.generation = generation;
    this.catalogRead = null;
    const advertised = this.capabilities()?.capabilities;
    const availability = (endpoint: (typeof dshCreationEndpoints)[number]): Availability => {
      if (generation === undefined) return "offline";
      const expected = requirements.find((value) => value.endpoint === endpoint)!;
      const actual = advertised?.find((value) => value.endpoint === endpoint);
      return actual !== undefined &&
        actual.availability !== "unavailable" &&
        actual.mode === expected.mode &&
        actual.wireFingerprint === expected.wireFingerprint &&
        actual.semanticRevision === expected.semanticRevision
        ? "available"
        : "unavailable";
    };
    this.publish({
      availability: availability("session/create"),
      catalog: availability("agentPresets/list"),
      roster: "idle",
      profiles: [],
    });
    this.reconcileObserved();
  };

  /** Explicit roster read; reconnect clears stale choices without starting another request. */
  refreshProfiles = (): Promise<void> => {
    if (this.closed || this.snapshot.catalog !== "available") return Promise.resolve();
    if (this.catalogRead !== null) return this.catalogRead;
    const generation = this.generation;
    const task = Promise.resolve()
      .then(() => {
        if (this.closed || this.generation !== generation) return undefined;
        return this.readRoster();
      })
      .then((result) => {
        if (this.closed || this.generation !== generation || result === undefined) return undefined;
        this.publish(
          result.ok
            ? {
                roster: "ready",
                profiles: result.value.presets.filter((value) => value.broken === undefined),
              }
            : { roster: "failed", profiles: [] },
        );
        return undefined;
      })
      .catch(() => {
        // Carrier exceptions contain no authoritative roster and must not replace a later generation.
        if (!this.closed && this.generation === generation)
          this.publish({ roster: "failed", profiles: [] });
      })
      .finally(() => {
        if (this.catalogRead === task) this.catalogRead = null;
      });
    this.catalogRead = task;
    this.own(task);
    this.publish({ roster: "loading", profiles: [] });
    return task;
  };

  /** Dispatch once with a caller-owned identity. A new attempt requires an explicit reset. */
  create = (selection: DshCreationSelection): Promise<void> => {
    if (this.creation !== null) return this.creation;
    if (
      this.closed ||
      this.snapshot.storage !== "ready" ||
      this.snapshot.availability !== "available" ||
      this.snapshot.outcome.kind !== "idle"
    )
      return Promise.resolve();
    const workspace = this.workspaces.list.getSnapshot();
    let selectionError: DshCreationSnapshot["selectionError"] = null;
    if (selection.cwd !== undefined && selection.workspaceId !== undefined)
      selectionError = "ambiguous-target";
    else if (
      selection.workspaceId !== undefined &&
      (workspace.phase !== "ready" ||
        workspace.error !== null ||
        !workspace.items.some((value) => value.workspaceId === selection.workspaceId))
    )
      selectionError = "workspace-unavailable";
    else if (
      selection.agentPreset !== undefined &&
      (this.snapshot.catalog !== "available" ||
        this.snapshot.roster !== "ready" ||
        !this.snapshot.profiles.some((value) => value.id === selection.agentPreset))
    )
      selectionError = "profile-unavailable";
    if (selectionError !== null) {
      this.publish({ selectionError });
      return Promise.resolve();
    }
    const generation = this.generation;
    const request: Attempt = Object.freeze({
      ...selection,
      sessionId: this.createId(),
    });
    // Defer dispatch so observers of sending cannot start a second request reentrantly.
    const task = Promise.resolve()
      .then(async () => {
        let claimed;
        try {
          claimed = await this.journal!.claim(request);
        } catch {
          // An uncertain local commit prohibits dispatch until an explicit storage recovery.
          this.publish({
            storage: "failed",
            outcome: { kind: "unknown", request, published: false },
          });
          return;
        }
        if (!claimed.claimed) {
          this.publish({ outcome: claimed.outcome });
          this.reconcileObserved();
          return;
        }
        if (this.closed || this.generation === undefined || this.generation !== generation) {
          await this.saveOutcome({ kind: "rejected", request, code: "client/not-dispatched" });
          return;
        }
        try {
          const id = await this.sessions.create(request);
          await this.saveOutcome(
            id === request.sessionId
              ? { kind: "accepted", request }
              : { kind: "unknown", request, published: false },
          );
        } catch (error: unknown) {
          if (
            error instanceof SessionCreateError &&
            error.rpcError.code === "session/workspace-attach-failed" &&
            error.rpcError.details.sessionId === request.sessionId &&
            error.rpcError.details.workspaceId === request.workspaceId
          ) {
            await this.saveOutcome({ kind: "attachment-failed", request });
          } else if (error instanceof SessionCreateError && rejections.has(error.rpcError.code)) {
            await this.saveOutcome({ kind: "rejected", request, code: error.rpcError.code });
          } else {
            await this.saveOutcome({ kind: "unknown", request, published: false });
          }
        }
        this.reconcileObserved();
        return undefined;
      })
      .finally(() => {
        this.creation = null;
      });
    this.creation = task;
    this.own(task);
    this.publish({
      outcome: { kind: "sending", request },
      selectionError: null,
    });
    return task;
  };

  private reconcileObserved = (): void => {
    if (
      this.closed ||
      this.generation === undefined ||
      this.snapshot.storage !== "ready" ||
      this.persisting !== null
    )
      return;
    const outcome = this.snapshot.outcome;
    if (outcome.kind !== "unknown" && outcome.kind !== "attachment-failed") return;
    const sessions = this.sessions.list.getSnapshot();
    const { request } = outcome;
    if (
      sessions.phase !== "ready" ||
      sessions.error !== null ||
      sessions.byId[request.sessionId] === undefined
    )
      return;
    const workspace = this.workspaces.list.getSnapshot();
    const attached =
      request.workspaceId === undefined ||
      (workspace.phase === "ready" &&
        workspace.error === null &&
        workspace.items.some(
          (value) =>
            value.workspaceId === request.workspaceId &&
            value.sessionIds.includes(request.sessionId),
        ));
    let next: StoredCreationOutcome | undefined;
    if (attached) next = { kind: "accepted", request };
    else if (outcome.kind === "unknown" && !outcome.published)
      next = { ...outcome, published: true };
    if (next !== undefined) {
      const task = this.saveOutcome(next).finally(() => {
        this.persisting = null;
        this.reconcileObserved();
      });
      this.persisting = this.own(task);
    }
  };

  /** Read-only reconciliation; absence from a bounded list never proves rejection. */
  reconcile = (): Promise<void> => {
    if (this.closed || this.generation === undefined) return Promise.resolve();
    const task = this.sessions
      .refresh()
      .then(async () => {
        this.reconcileObserved();
        await this.persisting;
        return undefined;
      })
      .catch(() => {
        // A failed baseline leaves the attempt unknown; the shared list retains its read error.
      });
    return this.own(task);
  };

  /** Reread local durable state without dispatching a mutation or fetching a catalog. */
  restore = (): Promise<void> => {
    if (this.closed || this.journal === undefined) return Promise.resolve();
    if (this.recovery !== null) return this.recovery;
    if (this.creation !== null || this.persisting !== null) return Promise.resolve();
    const task = Promise.resolve()
      .then(async () => {
        try {
          const outcome = await this.journal!.read();
          this.publish({ storage: "ready", outcome: outcome ?? { kind: "idle" } });
          this.reconcileObserved();
        } catch {
          this.publish({ storage: "failed" });
        }
        return undefined;
      })
      .finally(() => {
        this.recovery = null;
      });
    this.recovery = this.own(task);
    this.publish({ storage: "loading" });
    return task;
  };

  private async saveOutcome(outcome: StoredCreationOutcome): Promise<void> {
    try {
      const stored = await this.journal!.settle(outcome);
      this.publish({ outcome: stored ?? { kind: "idle" } });
    } catch {
      // The pre-dispatch record remains authoritative when recording the result fails.
      this.publish({ storage: "failed", outcome });
    }
  }

  /** Confirmed outcomes clear only after the identity-checked durable reset commits. */
  reset = (): Promise<void> => {
    const outcome = this.snapshot.outcome;
    if (
      this.closed ||
      this.creation !== null ||
      this.persisting !== null ||
      this.recovery !== null ||
      this.snapshot.storage !== "ready" ||
      (outcome.kind !== "accepted" && outcome.kind !== "rejected")
    )
      return Promise.resolve();
    const task = Promise.resolve()
      .then(async () => {
        try {
          const retained = await this.journal!.clear(outcome.request.sessionId);
          this.publish({
            storage: "ready",
            outcome: retained ?? { kind: "idle" },
            selectionError: null,
          });
        } catch {
          this.publish({ storage: "failed" });
        }
        return undefined;
      })
      .finally(() => {
        this.recovery = null;
      });
    this.recovery = this.own(task);
    this.publish({ storage: "loading" });
    return task;
  };

  /** Close publication immediately; the Host connection owner cancels carriers while these calls join. */
  async dispose(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      for (const unsubscribe of this.unsubscribe) unsubscribe();
      this.listeners.clear();
    }
    while (this.owned.size > 0) await Promise.allSettled(this.owned);
  }
}
