import {
  selectRemoteCapabilities,
  type ConnectionHandle,
  type HostCapabilities,
  type IWorkspaces,
} from "@deepseek-ai/dsh-client";
import { dshRegistrationEndpoints } from "@getpaseo/protocol/dsh-access";
import { createDshAbortController } from "../runtime/dsh-abort-controller";
import type {
  DshRegistrationJournal,
  RegistrationAttemptId,
  RegistrationRequest,
  RegistrationWorkspace,
  StoredRegistrationOutcome,
} from "./registration-journal";

type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
type Availability = "available" | "offline" | "unavailable";
type Outcome =
  | StoredRegistrationOutcome
  | { readonly kind: "idle" }
  | { readonly kind: "sending"; readonly request: RegistrationRequest };
type Lookup =
  | { readonly kind: "idle" | "loading" | "absent" | "failed" }
  | { readonly kind: "found"; readonly workspace: RegistrationWorkspace };
export interface DshRegistrationSnapshot {
  readonly storage: "loading" | "ready" | "failed" | "unavailable";
  readonly availability: Availability;
  readonly lookupAvailability: Availability;
  readonly outcome: Outcome;
  readonly lookup: Lookup;
}
const requirements = selectRemoteCapabilities(dshRegistrationEndpoints);
function reference(workspace: RegistrationWorkspace): RegistrationWorkspace {
  return { workspaceId: workspace.workspaceId, path: workspace.path, title: workspace.title };
}
/** Durable mutation ownership and explicit current-state reads for one Host. */
export class DshRegistration {
  private snapshot: DshRegistrationSnapshot = {
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
  private local: Promise<void> | null = null;
  private mutation: Promise<void> | null = null;
  private read: { controller: AbortController; task: Promise<void> } | null = null;
  private closed = false;
  constructor(
    private readonly workspaces: Pick<IWorkspaces, "create" | "resolveByPath">,
    private readonly connection: Pick<ConnectionHandle, "generation">,
    private readonly capabilities: () => HostCapabilities | undefined,
    private readonly createId: () => RegistrationAttemptId,
    private readonly journal?: DshRegistrationJournal,
  ) {
    if (journal === undefined) this.snapshot = { ...this.snapshot, storage: "unavailable" };
    this.unsubscribe = connection.generation.subscribe(this.sync);
    this.sync();
  }
  getSnapshot = (): DshRegistrationSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<DshRegistrationSnapshot>): void {
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
    const advertised = this.capabilities()?.capabilities;
    const available = (endpoint: (typeof dshRegistrationEndpoints)[number]): Availability => {
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
      availability: available("workspace/create"),
      lookupAvailability: available("workspace/resolveByPath"),
      lookup: { kind: "idle" },
    });
  };
  /** Commit local ownership before the only dispatch. Carrier and Host failures remain unknown. */
  register = (path: string): Promise<void> => {
    if (this.mutation !== null) return this.mutation;
    if (
      this.closed ||
      this.local !== null ||
      this.snapshot.storage !== "ready" ||
      this.snapshot.availability !== "available" ||
      this.snapshot.outcome.kind !== "idle" ||
      path.trim().length === 0
    )
      return Promise.resolve();
    const request: RegistrationRequest = Object.freeze({ attemptId: this.createId(), path });
    const generation = this.generation;
    const task = Promise.resolve()
      .then(async () => {
        let claim;
        try {
          claim = await this.journal!.claim(request);
        } catch {
          // An uncertain storage commit cannot authorize sending the Host mutation.
          this.publish({ storage: "failed", outcome: { kind: "unknown", request } });
          return;
        }
        if (!claim.claimed) {
          this.publish({ outcome: claim.outcome });
          return;
        }
        if (this.closed || this.generation === undefined || this.generation !== generation) {
          await this.save({ kind: "not-dispatched", request });
          return;
        }
        let workspace;
        try {
          workspace = await this.workspaces.create({ path });
        } catch {
          // workspace/invalid-path also covers storage failures; no dispatched error proves non-publication.
          await this.save({ kind: "unknown", request });
          return;
        }
        await this.save({ kind: "confirmed", request, workspace: reference(workspace) });
        return undefined;
      })
      .finally(() => {
        this.mutation = null;
      });
    this.mutation = this.own(task);
    this.publish({ outcome: { kind: "sending", request }, lookup: { kind: "idle" } });
    return task;
  };
  /** Read current canonical registration; never infer the earlier mutation's outcome. */
  checkCurrent = (): Promise<void> => {
    if (this.read !== null) return this.read.task;
    const outcome = this.snapshot.outcome;
    if (
      this.closed ||
      this.local !== null ||
      this.snapshot.storage !== "ready" ||
      outcome.kind !== "unknown" ||
      this.snapshot.lookupAvailability !== "available"
    )
      return Promise.resolve();
    const controller = createDshAbortController();
    const generation = this.generation;
    const current = () =>
      !this.closed &&
      !controller.signal.aborted &&
      generation === this.generation &&
      this.snapshot.outcome.kind === "unknown" &&
      this.snapshot.outcome.request.attemptId === outcome.request.attemptId;
    const task = Promise.resolve()
      .then(async () => {
        if (!current()) return;
        try {
          const workspace = await this.workspaces.resolveByPath(
            { path: outcome.request.path },
            controller.signal,
          );
          if (current())
            this.publish({
              lookup:
                workspace === null
                  ? { kind: "absent" }
                  : { kind: "found", workspace: reference(workspace) },
            });
        } catch {
          // Failed and canceled lookups supply no current-registration observation.
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
  /** Explicitly finish review using a positive observation, without claiming request acceptance. */
  adoptCurrent = (): Promise<void> => {
    const { outcome, lookup } = this.snapshot;
    if (
      this.closed ||
      this.local !== null ||
      this.mutation !== null ||
      this.read !== null ||
      this.snapshot.storage !== "ready" ||
      this.snapshot.lookupAvailability !== "available" ||
      outcome.kind !== "unknown" ||
      lookup.kind !== "found"
    )
      return Promise.resolve();
    return this.persistLocal(() =>
      this.journal!.settle({
        kind: "adopted",
        request: outcome.request,
        workspace: lookup.workspace,
      }),
    );
  };
  /** Restore only local records; reconnect and restoration never dispatch or lookup. */
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
      outcome.kind === "idle" ||
      outcome.kind === "sending" ||
      outcome.kind === "unknown"
    )
      return Promise.resolve();
    return this.persistLocal(() => this.journal!.clear(outcome.request.attemptId));
  };
  private persistLocal(operation: () => Promise<StoredRegistrationOutcome | null>): Promise<void> {
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
  private async save(outcome: StoredRegistrationOutcome): Promise<void> {
    try {
      const retained = await this.journal!.settle(outcome);
      this.publish({ outcome: retained ?? { kind: "idle" } });
    } catch {
      this.publish({ storage: "failed", outcome });
    }
  }
  /** Host runtime disposal cancels mutation carriers; this owner cancels reads and joins persistence. */
  async dispose(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.unsubscribe();
      this.cancelRead();
      this.listeners.clear();
    }
    while (this.owned.size > 0) await Promise.allSettled(this.owned);
  }
}
