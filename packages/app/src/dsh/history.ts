import {
  HistoryDetailLimitError,
  selectRemoteCapabilities,
  type ConnectionHandle,
  type HostCapabilities,
  type SessionFace,
} from "@deepseek-ai/dsh-client";
import { dshHistoryEndpoints } from "@getpaseo/protocol/dsh-access";
import { createDshAbortController } from "../runtime/dsh-abort-controller";

const requirements = selectRemoteCapabilities(dshHistoryEndpoints);
type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
type Availability = "available" | "offline" | "unavailable";
export type DshDetailRead = "loading" | "failed" | "too-large";
export interface DshHistorySnapshot {
  readonly older: Availability;
  readonly detail: Availability;
  readonly details: ReadonlyMap<number, DshDetailRead>;
}

/** View-owned read state; Session and Chat retain all history, cursor and result authority. */
export class DshHistory {
  private snapshot: DshHistorySnapshot = {
    older: "offline",
    detail: "offline",
    details: new Map(),
  };
  private readonly listeners = new Set<() => void>();
  private readonly reads = new Set<Promise<void>>();
  private readonly details = new Map<number, Promise<void>>();
  private readonly unsubscribe: () => void;
  private generation: Generation;
  private controller = createDshAbortController();
  private older: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly session: Pick<SessionFace, "loadOlder" | "loadHistoryDetail">,
    private readonly connection: Pick<ConnectionHandle, "generation">,
    private readonly readCapabilities: () => HostCapabilities | undefined,
  ) {
    this.unsubscribe = connection.generation.subscribe(this.sync);
    this.sync();
  }

  getSnapshot = (): DshHistorySnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: DshHistorySnapshot): void {
    if (this.closed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private sync = (): void => {
    if (this.closed) return;
    const generation = this.connection.generation.getSnapshot();
    if (generation === this.generation) return;
    this.generation = generation;
    const previous = this.controller;
    this.controller = createDshAbortController();
    this.older = null;
    this.details.clear();
    previous.abort();
    const capabilities = this.readCapabilities()?.capabilities;
    const available = new Set(
      requirements
        .filter((expected) => {
          const actual = capabilities?.find((value) => value.endpoint === expected.endpoint);
          return (
            actual !== undefined &&
            actual.availability !== "unavailable" &&
            actual.mode === expected.mode &&
            actual.wireFingerprint === expected.wireFingerprint &&
            actual.semanticRevision === expected.semanticRevision
          );
        })
        .map((value) => value.endpoint),
    );
    const availability = (endpoint: (typeof dshHistoryEndpoints)[number]): Availability => {
      if (generation === undefined) return "offline";
      return available.has(endpoint) ? "available" : "unavailable";
    };
    this.publish({
      older: availability("session/page"),
      detail: availability("session/historyDetail"),
      details: new Map(),
    });
  };

  loadOlder = (): Promise<void> => {
    if (this.closed || this.snapshot.older !== "available") return Promise.resolve();
    if (this.older !== null) return this.older;
    const task = this.session.loadOlder(this.controller.signal).finally(() => {
      this.reads.delete(task);
      if (this.older === task) this.older = null;
    });
    this.older = task;
    this.reads.add(task);
    return task;
  };

  loadDetail = (seq: number): Promise<void> => {
    if (this.closed || this.snapshot.detail !== "available") return Promise.resolve();
    const pending = this.details.get(seq);
    if (pending !== undefined) return pending;
    const controller = this.controller;
    const current = () =>
      !this.closed && !controller.signal.aborted && this.controller === controller;
    const states = new Map(this.snapshot.details);
    states.set(seq, "loading");
    const task = Promise.resolve()
      .then(() => {
        if (current()) return this.session.loadHistoryDetail(seq, controller.signal);
        return undefined;
      })
      .then(() => {
        if (!current()) return undefined;
        const details = new Map(this.snapshot.details);
        details.delete(seq);
        this.publish({ ...this.snapshot, details });
        return undefined;
      })
      .catch((error: unknown) => {
        if (!current()) return;
        const details = new Map(this.snapshot.details);
        details.set(seq, error instanceof HistoryDetailLimitError ? "too-large" : "failed");
        this.publish({ ...this.snapshot, details });
      })
      .finally(() => {
        this.reads.delete(task);
        if (this.details.get(seq) === task) this.details.delete(seq);
      });
    this.details.set(seq, task);
    this.reads.add(task);
    this.publish({ ...this.snapshot, details: states });
    return task;
  };

  /** Abort immediately and join every read, including an older generation's late carrier. */
  async dispose(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.unsubscribe();
      this.controller.abort();
      this.older = null;
      this.details.clear();
      this.listeners.clear();
      this.snapshot = { older: "offline", detail: "offline", details: new Map() };
    }
    await Promise.allSettled(this.reads);
  }
}
