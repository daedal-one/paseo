import {
  discoverHosts,
  type ConnectionHandle,
  type ConnectionHostId,
  type HostDiscoveryCandidate,
  type HostDiscoveryResult,
} from "@deepseek-ai/dsh-client";
import { createDshAbortController } from "../runtime/dsh-abort-controller";

type AdmittedGeneration = NonNullable<ReturnType<ConnectionHandle["generation"]["getSnapshot"]>>;

export type DshDiscoverySnapshot =
  | { status: "offline" | "loading" | "unavailable" | "invalid-response" }
  | { status: "tailscale-unavailable" | "tailscale-disconnected" | "scan-failed" }
  | { status: "ready"; candidates: readonly HostDiscoveryCandidate[]; truncated: boolean };

/** Optional reads scoped to one admitted Host generation, independent of its Sessions. */
export class DshDiscovery {
  private snapshot: DshDiscoverySnapshot = { status: "offline" };
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private generation: AdmittedGeneration | undefined;
  private controller: AbortController | null = null;
  private pending: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly connection: Pick<ConnectionHandle, "generation" | "rpc">,
    private readonly hostId: ConnectionHostId,
  ) {
    this.unsubscribe = connection.generation.subscribe(this.sync);
    this.sync();
  }

  getSnapshot = (): DshDiscoverySnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: DshDiscoverySnapshot): void {
    if (this.closed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private sync = (): void => {
    if (this.closed) return;
    const generation = this.connection.generation.getSnapshot();
    if (generation === this.generation) return;
    this.generation = generation;
    this.controller?.abort();
    if (generation === undefined) this.publish({ status: "offline" });
    else if (this.pending === null) void this.refresh();
    else this.publish({ status: "loading" });
  };

  refresh = (): Promise<void> => {
    if (this.pending !== null) return this.pending;
    const generation = this.generation;
    if (this.closed || generation === undefined) return Promise.resolve();
    const identity = generation.host.identity;
    if (identity === undefined || identity.hostId !== this.hostId) {
      this.publish({ status: "invalid-response" });
      return Promise.resolve();
    }
    const controller = createDshAbortController();
    this.controller = controller;
    this.publish({ status: "loading" });
    this.pending = this.read(generation, controller.signal).finally(() => {
      this.controller = null;
      this.pending = null;
      if (!this.closed && this.generation !== generation && this.generation !== undefined)
        void this.refresh();
    });
    return this.pending;
  };

  private async read(generation: AdmittedGeneration, signal: AbortSignal): Promise<void> {
    const current = () => !this.closed && !signal.aborted && this.generation === generation;
    let result: Awaited<ReturnType<typeof discoverHosts>>;
    try {
      result = await discoverHosts(this.connection.rpc, this.hostId, signal);
    } catch {
      // Missing optional routes and lost transports cannot prevent ordinary Session access.
      if (current()) this.publish({ status: "unavailable" });
      return;
    }
    if (!current()) return;
    if (!result.ok) {
      this.publish({
        status:
          result.error.code === "connection/invalid-discovery" ? "invalid-response" : "unavailable",
      });
      return;
    }
    if (result.value.host.activationId !== generation.host.identity?.activationId) {
      this.publish({ status: "invalid-response" });
      return;
    }
    this.publishResult(result.value);
  }

  private publishResult(result: HostDiscoveryResult): void {
    if (result.status !== "ready") {
      this.publish({ status: result.status });
      return;
    }
    this.publish({ status: "ready", candidates: result.candidates, truncated: result.truncated });
  }

  /** Abort and await the owned read; no cached candidates survive disposal. */
  dispose(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.unsubscribe();
      this.controller?.abort();
      this.listeners.clear();
      this.snapshot = { status: "offline" };
    }
    return this.pending ?? Promise.resolve();
  }
}
