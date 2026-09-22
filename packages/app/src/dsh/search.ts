import {
  selectRemoteCapabilities,
  type ConnectionHandle,
  type HostCapabilities,
  type ISessions,
  type SessionId,
} from "@deepseek-ai/dsh-client";
import { dshSearchEndpoints } from "@getpaseo/protocol/dsh-access";
import { createDshAbortController } from "../runtime/dsh-abort-controller";

const requirements = selectRemoteCapabilities(dshSearchEndpoints);
type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
type SessionSearchResult = Extract<Awaited<ReturnType<ISessions["search"]>>, { ok: true }>["value"];
type SearchRead =
  | { readonly kind: "idle" | "loading" | "failed" }
  | { readonly kind: "ready"; readonly result: SessionSearchResult };
type OpenRead =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" | "missing" | "failed"; readonly id: SessionId };
export interface DshSearchSnapshot {
  readonly availability: "available" | "offline" | "unavailable";
  readonly query: string;
  readonly validation: "empty" | "too-long" | null;
  readonly read: SearchRead;
  readonly opening: OpenRead;
  readonly limit: number;
}

/** One explicit search view per Host; shared Sessions own every loaded summary and conversation. */
export class DshSearch {
  private snapshot: DshSearchSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly reads = new Set<Promise<void>>();
  private readonly unsubscribe: () => void;
  private generation: Generation;
  private view: object | null = null;
  private controller = createDshAbortController();
  private searching: Promise<void> | null = null;
  private opening: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly sessions: Pick<ISessions, "search" | "searchResultLimit" | "loadSummary">,
    private readonly connection: Pick<ConnectionHandle, "generation">,
    private readonly readCapabilities: () => HostCapabilities | undefined,
  ) {
    this.snapshot = {
      availability: "offline",
      query: "",
      validation: null,
      read: { kind: "idle" },
      opening: { kind: "idle" },
      limit: sessions.searchResultLimit,
    };
    this.unsubscribe = connection.generation.subscribe(this.sync);
    this.sync();
  }
  getSnapshot = (): DshSearchSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<DshSearchSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
  private cancel(): void {
    const old = this.controller;
    this.controller = createDshAbortController();
    this.searching = null;
    this.opening = null;
    old.abort();
  }
  private sync = (): void => {
    const generation = this.connection.generation.getSnapshot();
    if (this.disposed || generation === this.generation) return;
    this.generation = generation;
    this.cancel();
    const capabilities = this.readCapabilities()?.capabilities;
    const admitted = requirements.every((expected) =>
      capabilities?.some(
        (actual) =>
          actual.endpoint === expected.endpoint &&
          actual.availability !== "unavailable" &&
          actual.mode === expected.mode &&
          actual.wireFingerprint === expected.wireFingerprint &&
          actual.semanticRevision === expected.semanticRevision,
      ),
    );
    let availability: DshSearchSnapshot["availability"] = "offline";
    if (generation !== undefined) availability = admitted ? "available" : "unavailable";
    this.publish({ availability, read: { kind: "idle" }, opening: { kind: "idle" } });
  };

  /** Acquire a fresh view. A replaced view's cleanup cannot close its successor. */
  begin = (): (() => void) => {
    if (this.disposed) return () => {};
    this.cancel();
    const view = {};
    this.view = view;
    this.publish({
      query: "",
      validation: null,
      read: { kind: "idle" },
      opening: { kind: "idle" },
    });
    return () => {
      if (this.view !== view) return;
      this.view = null;
      this.cancel();
      this.publish({
        query: "",
        validation: null,
        read: { kind: "idle" },
        opening: { kind: "idle" },
      });
    };
  };
  setQuery = (query: string): void => {
    if (this.disposed || this.view === null || query === this.snapshot.query) return;
    this.cancel();
    this.publish({ query, validation: null, read: { kind: "idle" }, opening: { kind: "idle" } });
  };
  private current(controller: AbortController): boolean {
    return (
      !this.disposed &&
      this.view !== null &&
      this.controller === controller &&
      !controller.signal.aborted &&
      this.snapshot.availability === "available"
    );
  }
  submit = (): Promise<void> => {
    if (this.disposed || this.view === null || this.snapshot.availability !== "available")
      return Promise.resolve();
    if (this.searching !== null) return this.searching;
    const query = this.snapshot.query.trim();
    if (query.length === 0 || query.length > 500) {
      this.publish({ validation: query.length === 0 ? "empty" : "too-long" });
      return Promise.resolve();
    }
    this.cancel();
    const controller = this.controller;
    const task = Promise.resolve()
      .then(async () => {
        if (!this.current(controller)) return undefined;
        const result = await this.sessions.search(query, controller.signal);
        if (!this.current(controller)) return undefined;
        this.publish({
          read: result.ok ? { kind: "ready", result: result.value } : { kind: "failed" },
        });
        return undefined;
      })
      .catch(() => {
        // A rejected carrier has no usable search response; keep failure distinct from no matches.
        if (this.current(controller)) this.publish({ read: { kind: "failed" } });
      })
      .finally(() => {
        this.reads.delete(task);
        if (this.searching === task) this.searching = null;
      });
    this.searching = task;
    this.reads.add(task);
    this.publish({ validation: null, read: { kind: "loading" }, opening: { kind: "idle" } });
    return task;
  };

  /** Resolve exact Host metadata before navigating; only the current result can open. */
  openResult = (id: SessionId, onOpen: (id: SessionId) => void): Promise<void> => {
    const { read } = this.snapshot;
    if (
      this.disposed ||
      this.view === null ||
      this.snapshot.availability !== "available" ||
      read.kind !== "ready" ||
      !read.result.items.some((item) => item.sessionId === id)
    )
      return Promise.resolve();
    if (this.opening !== null) return this.opening;
    const controller = this.controller;
    const task = Promise.resolve()
      .then(async () => {
        if (!this.current(controller)) return undefined;
        const result = await this.sessions.loadSummary(id, controller.signal);
        if (!this.current(controller)) return undefined;
        if (!result.ok) this.publish({ opening: { kind: "failed", id } });
        else if (!result.value) this.publish({ opening: { kind: "missing", id } });
        else onOpen(id);
        return undefined;
      })
      .catch(() => {
        // Navigation/summary failures stay with this result so an explicit gesture can retry.
        if (this.current(controller)) this.publish({ opening: { kind: "failed", id } });
      })
      .finally(() => {
        this.reads.delete(task);
        if (this.opening === task) {
          this.opening = null;
          if (this.snapshot.opening.kind === "loading") this.publish({ opening: { kind: "idle" } });
        }
      });
    this.opening = task;
    this.reads.add(task);
    this.publish({ opening: { kind: "loading", id } });
    return task;
  };
  /** Abort now, join late carriers, and never cancel work on the Host. */
  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.view = null;
      this.unsubscribe();
      this.cancel();
      this.listeners.clear();
    }
    await Promise.allSettled(this.reads);
  }
}
