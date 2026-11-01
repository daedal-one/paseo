import {
  selectRemoteCapabilities,
  type ConnectionHandle,
  type HostCapabilities,
} from "@deepseek-ai/dsh-client";
import { createDshAbortController } from "../runtime/dsh-abort-controller";

type Endpoint = Parameters<typeof selectRemoteCapabilities>[0][number];
export type InspectionReading<T> =
  | { status: "idle" | "loading" | "offline" | "unavailable" | "failed" }
  | { status: "ready"; value: T };

/** A view-owned, capability-gated reading. Retired transports cannot replace a newer reading. */
export class InspectionRead<T> {
  private snapshot: InspectionReading<T> = { status: "idle" };
  private readonly listeners = new Set<() => void>();
  private readonly reads = new Set<Promise<void>>();
  private controller: AbortController | null = null;
  private closed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly endpoint: Endpoint,
    private readonly connection: Pick<ConnectionHandle, "generation">,
    private readonly capabilities: () => HostCapabilities | undefined,
    private readonly read: (signal: AbortSignal) => Promise<T>,
  ) {
    this.unsubscribe = connection.generation.subscribe(() => {
      this.controller?.abort();
      this.controller = null;
      this.publish({
        status: connection.generation.getSnapshot() === undefined ? "offline" : "idle",
      });
    });
  }

  getSnapshot = (): InspectionReading<T> => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(snapshot: InspectionReading<T>) {
    if (this.closed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  refresh = (): Promise<void> => {
    if (this.closed) return Promise.resolve();
    this.controller?.abort();
    const controller = createDshAbortController();
    this.controller = controller;
    if (this.connection.generation.getSnapshot() === undefined) {
      this.publish({ status: "offline" });
      return Promise.resolve();
    }
    const expected = selectRemoteCapabilities([this.endpoint])[0];
    const actual = this.capabilities()?.capabilities.find(
      (value) => value.endpoint === this.endpoint,
    );
    if (
      actual === undefined ||
      actual.availability === "unavailable" ||
      actual.mode !== expected.mode ||
      actual.wireFingerprint !== expected.wireFingerprint ||
      actual.semanticRevision !== expected.semanticRevision
    ) {
      this.publish({ status: "unavailable" });
      return Promise.resolve();
    }
    this.publish({ status: "loading" });
    const current = () =>
      !this.closed && this.controller === controller && !controller.signal.aborted;
    const task = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return this.read(controller.signal);
      })
      .then((value) => {
        if (current()) this.publish({ status: "ready", value });
        return undefined;
      })
      .catch(() => {
        if (current()) this.publish({ status: "failed" });
      })
      .finally(() => this.reads.delete(task));
    this.reads.add(task);
    return task;
  };

  async dispose(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    this.controller?.abort();
    this.listeners.clear();
    await Promise.allSettled(this.reads);
  }
}
