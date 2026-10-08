import {
  selectRemoteCapabilities,
  SessionForkError,
  type ConnectionHandle,
  type HostCapabilities,
  type ISessions,
  type IWorkspaces,
  type SessionId,
  type WorkspaceId,
} from "@deepseek-ai/dsh-client";
import { dshForkEndpoints } from "@getpaseo/protocol/dsh-access";
import { createDshAbortController } from "../runtime/dsh-abort-controller";
import type { DshForkJournal, ForkRequest, ForkChild, StoredForkOutcome } from "./fork-journal";
type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
type Outcome =
  | StoredForkOutcome
  | { readonly kind: "idle" }
  | { readonly kind: "sending"; readonly request: ForkRequest };
type Lookup =
  | { readonly kind: "idle" | "loading" | "absent" | "mismatch" | "failed" }
  | { readonly kind: "found"; readonly child: ForkChild };
export interface DshForkSnapshot {
  readonly storage: "loading" | "ready" | "failed" | "unavailable";
  readonly availability: "available" | "offline" | "unavailable";
  readonly lookupAvailability: "available" | "offline";
  readonly outcome: Outcome;
  readonly lookup: Lookup;
}
const [requirement] = selectRemoteCapabilities(dshForkEndpoints);
function failedOutcome(error: unknown, request: ForkRequest): StoredForkOutcome {
  if (
    error instanceof SessionForkError &&
    error.sourceSessionId === request.sessionId &&
    error.requestedSessionId === request.childSessionId &&
    error.rpcError.code === "session/workspace-attach-failed"
  ) {
    if (error.rpcError.details.sessionId === request.childSessionId)
      return {
        kind: "attachment-failed",
        request,
        workspaceId: error.rpcError.details.workspaceId as WorkspaceId,
      };
  }
  return { kind: "unknown", request };
}
/** One durable fork attempt per Host; explicit reads observe a child without confirming the mutation. */
export class DshFork {
  private snapshot: DshForkSnapshot = {
    storage: "loading",
    availability: "offline",
    lookupAvailability: "offline",
    outcome: { kind: "idle" },
    lookup: { kind: "idle" },
  };
  private readonly listeners = new Set<() => void>();
  private readonly owned = new Set<Promise<void>>();
  private readonly unsubscribe: () => void;
  private generation: Generation;
  private view: object | null = null;
  private local: Promise<void> | null = null;
  private mutation: Promise<void> | null = null;
  private read: { controller: AbortController; task: Promise<void> } | null = null;
  private closed = false;
  constructor(
    private readonly sessions: Pick<ISessions, "forkTo" | "loadSummary" | "list">,
    private readonly workspaces: Pick<IWorkspaces, "list">,
    private readonly connection: Pick<ConnectionHandle, "generation">,
    private readonly capabilities: () => HostCapabilities | undefined,
    private readonly createId: () => SessionId,
    private readonly journal?: DshForkJournal,
  ) {
    if (journal === undefined) this.snapshot = { ...this.snapshot, storage: "unavailable" };
    this.unsubscribe = connection.generation.subscribe(this.sync);
    this.sync();
  }
  getSnapshot = (): DshForkSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<DshForkSnapshot>): void {
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
  private cancelRead(): void {
    const read = this.read;
    this.read = null;
    read?.controller.abort();
  }
  private sync = (): void => {
    const generation = this.connection.generation.getSnapshot();
    if (this.closed || this.generation === generation) return;
    this.generation = generation;
    this.cancelRead();
    const actual = this.capabilities()?.capabilities.find(
      (value) => value.endpoint === requirement.endpoint,
    );
    const admitted =
      actual !== undefined &&
      actual.availability !== "unavailable" &&
      actual.mode === requirement.mode &&
      actual.wireFingerprint === requirement.wireFingerprint &&
      actual.semanticRevision === requirement.semanticRevision;
    const onlineAvailability = admitted ? "available" : "unavailable";
    this.publish({
      availability: generation === undefined ? "offline" : onlineAvailability,
      lookupAvailability: generation === undefined ? "offline" : "available",
      lookup: { kind: "idle" },
    });
  };
  /** Replace the review view. Closing it cancels reads, while dispatched mutations keep their durable owner. */
  begin = (): (() => void) => {
    if (this.closed) return () => {};
    const view = {};
    this.view = view;
    this.cancelRead();
    this.publish({ lookup: { kind: "idle" } });
    return () => {
      if (this.view !== view) return;
      this.view = null;
      this.cancelRead();
      this.publish({ lookup: { kind: "idle" } });
    };
  };
  fork = (sessionId: SessionId, atSeq?: number): Promise<void> => {
    if (this.mutation !== null) return this.mutation;
    if (
      this.closed ||
      this.view === null ||
      this.local !== null ||
      this.snapshot.storage !== "ready" ||
      this.snapshot.availability !== "available" ||
      this.snapshot.outcome.kind !== "idle"
    )
      return Promise.resolve();
    const request: ForkRequest = Object.freeze({
      sessionId,
      childSessionId: this.createId(),
      ...(atSeq === undefined ? {} : { atSeq }),
    });
    const generation = this.generation;
    const view = this.view;
    const task = Promise.resolve()
      .then(async () => {
        let claim;
        try {
          claim = await this.journal!.claim(request);
        } catch {
          // A failed local commit cannot authorize dispatch.
          this.publish({ storage: "failed", outcome: { kind: "unknown", request } });
          return;
        }
        if (!claim.claimed) {
          this.publish({ outcome: claim.outcome });
          return;
        }
        if (
          this.closed ||
          this.view !== view ||
          this.generation === undefined ||
          this.generation !== generation
        ) {
          await this.save({ kind: "not-dispatched", request });
          return;
        }
        let child;
        try {
          child = await this.sessions.forkTo(request);
        } catch (error) {
          await this.save(failedOutcome(error, request));
          return;
        }
        await this.save({
          kind: child === request.childSessionId ? "confirmed" : "unknown",
          request,
        });
        return undefined;
      })
      .finally(() => {
        this.mutation = null;
      });
    this.mutation = this.own(task);
    this.publish({ outcome: { kind: "sending", request }, lookup: { kind: "idle" } });
    return task;
  };
  /** Read the exact retained identity and parent; absence never authorizes another fork. */
  checkCurrent = (): Promise<void> => {
    if (this.read !== null) return this.read.task;
    const outcome = this.snapshot.outcome;
    if (
      this.closed ||
      this.view === null ||
      this.local !== null ||
      this.mutation !== null ||
      this.snapshot.storage !== "ready" ||
      (outcome.kind !== "unknown" && outcome.kind !== "attachment-failed") ||
      this.snapshot.lookupAvailability !== "available"
    )
      return Promise.resolve();
    const controller = createDshAbortController();
    const generation = this.generation;
    const view = this.view;
    const current = () =>
      !this.closed &&
      !controller.signal.aborted &&
      this.view === view &&
      this.generation === generation &&
      this.snapshot.outcome === outcome;
    const task = Promise.resolve()
      .then(async () => {
        if (!current()) return;
        try {
          const result = await this.sessions.loadSummary(
            outcome.request.childSessionId,
            controller.signal,
          );
          if (!current()) return;
          if (!result.ok) {
            this.publish({ lookup: { kind: "failed" } });
            return;
          }
          if (!result.value) {
            this.publish({ lookup: { kind: "absent" } });
            return;
          }
          this.publish({ lookup: this.observe(outcome.request) });
        } catch {
          // Failed or canceled reads provide no child observation.
          if (current()) this.publish({ lookup: { kind: "failed" } });
        }
        return undefined;
      })
      .finally(() => {
        if (this.read?.task === task) this.read = null;
      });
    this.read = { controller, task: this.own(task) };
    this.publish({ lookup: { kind: "loading" } });
    return task;
  };
  private observe(request: ForkRequest): Lookup {
    const row = this.sessions.list.getSnapshot().byId[request.childSessionId];
    if (
      row === undefined ||
      row.id !== request.childSessionId ||
      row.parentId !== request.sessionId
    )
      return { kind: "mismatch" };
    const baseline = this.workspaces.list.getSnapshot();
    const workspaceIds =
      baseline.phase === "ready"
        ? baseline.items
            .filter((item) => item.sessionIds.includes(row.id))
            .map((item) => item.workspaceId)
        : null;
    return {
      kind: "found",
      child: {
        id: row.id,
        parentId: request.sessionId,
        displayTitle: row.displayTitle,
        workspaceIds,
      },
    };
  }
  /** Adopt a current child explicitly, without retrying attachment or renaming it. */
  adoptCurrent = (): Promise<void> => {
    const { outcome, lookup } = this.snapshot;
    if (
      this.closed ||
      this.view === null ||
      this.local !== null ||
      this.mutation !== null ||
      this.read !== null ||
      this.snapshot.storage !== "ready" ||
      this.snapshot.lookupAvailability !== "available" ||
      (outcome.kind !== "unknown" && outcome.kind !== "attachment-failed") ||
      lookup.kind !== "found"
    )
      return Promise.resolve();
    const observation = this.observe(outcome.request);
    if (observation.kind !== "found") {
      this.publish({ lookup: observation });
      return Promise.resolve();
    }
    return this.persistLocal(() =>
      this.journal!.settle({ kind: "adopted", request: outcome.request, child: observation.child }),
    );
  };
  restore = (): Promise<void> => {
    if (this.local !== null) return this.local;
    if (this.closed || this.journal === undefined || this.mutation !== null)
      return Promise.resolve();
    return this.persistLocal(() => this.journal!.read());
  };
  reset = (): Promise<void> => {
    const outcome = this.snapshot.outcome;
    if (
      this.closed ||
      this.local !== null ||
      this.mutation !== null ||
      this.snapshot.storage !== "ready" ||
      (outcome.kind !== "confirmed" &&
        outcome.kind !== "adopted" &&
        outcome.kind !== "not-dispatched")
    )
      return Promise.resolve();
    return this.persistLocal(() => this.journal!.clear(outcome.request.childSessionId));
  };
  private persistLocal(operation: () => Promise<StoredForkOutcome | null>): Promise<void> {
    this.cancelRead();
    const task = Promise.resolve()
      .then(async () => {
        try {
          const outcome = await operation();
          this.publish({ storage: "ready", outcome: outcome ?? { kind: "idle" } });
        } catch {
          this.publish({ storage: "failed" });
        }
        return undefined;
      })
      .finally(() => {
        this.local = null;
      });
    this.local = this.own(task);
    this.publish({ storage: "loading", lookup: { kind: "idle" } });
    return task;
  }
  private async save(outcome: StoredForkOutcome): Promise<void> {
    try {
      const retained = await this.journal!.settle(outcome);
      this.publish({ outcome: retained ?? { kind: "idle" } });
    } catch {
      this.publish({ storage: "failed", outcome });
    }
  }
  /** Join dispatched work and local persistence; runtime disposal closes its transport separately. */
  async dispose(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.view = null;
      this.unsubscribe();
      this.cancelRead();
      this.listeners.clear();
    }
    while (this.owned.size > 0) await Promise.allSettled(this.owned);
  }
}
