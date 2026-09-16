import type { ConnectionHostId, SessionSelection } from "@deepseek-ai/dsh-client";
import { createDshAbortController } from "../../runtime/dsh-abort-controller";
import { DshAccessError, type DshAccessErrorCode } from "../access-error";
import { decodeDshPairing, type DshPairing } from "../pairing";
import type { DshHostRuntime } from "../runtime";
import { openSavedDshHost, pairDshHost } from "./access";
import { dshDeviceStore } from "./device-store";

export type DshDirectoryHost =
  | { hostId: ConnectionHostId; status: "paired"; origin: string; label: string }
  | { hostId: ConnectionHostId; status: "unavailable"; error: DshAccessErrorCode };
export type DshDirectoryLoad =
  | { status: "loading" }
  | { status: "failed"; error: DshAccessErrorCode }
  | { status: "ready"; hosts: readonly DshDirectoryHost[] };
export type DshPairingState =
  | { status: "idle" }
  | { status: "scanning" }
  | { status: "review"; pairing: DshPairing }
  | { status: "claiming" }
  | { status: "failed"; error: DshAccessErrorCode };
export interface DshDirectorySnapshot {
  directory: DshDirectoryLoad;
  pairing: DshPairingState;
  runtime: DshHostRuntime | null;
  busy: boolean;
  error: DshAccessErrorCode | null;
}

function accessCode(error: unknown, fallback: DshAccessErrorCode): DshAccessErrorCode {
  return error instanceof DshAccessError ? error.code : fallback;
}

/** Owns one visible Host connection. Leaving the screen releases it, never its Sessions. */
export class DshDirectory {
  private snapshot: DshDirectorySnapshot = {
    directory: { status: "loading" },
    pairing: { status: "idle" },
    runtime: null,
    busy: false,
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private closed = false;
  private ownedRuntime: DshHostRuntime | null = null;
  private runtimeClosing: Promise<void> | null = null;
  private pending: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private claim: AbortController | null = null;

  getSnapshot = (): DshDirectorySnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<DshDirectorySnapshot>): void {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private run(operation: () => Promise<void>, fallback: DshAccessErrorCode): Promise<void> {
    if (this.closed || this.snapshot.busy) return this.pending;
    this.publish({ busy: true, error: null });
    this.pending = operation()
      .catch((error: unknown) => {
        this.publish({ error: accessCode(error, fallback) });
      })
      .finally(() => {
        this.publish({ busy: false });
      });
    return this.pending;
  }

  private async readHosts(): Promise<void> {
    try {
      const ids = await dshDeviceStore.list();
      const hosts: DshDirectoryHost[] = [];
      for (const hostId of ids) {
        try {
          const record = await dshDeviceStore.load(hostId);
          if (record === null) hosts.push({ hostId, status: "unavailable", error: "not-paired" });
          else
            hosts.push({
              hostId,
              status: "paired",
              origin: record.origin,
              label: record.grant.device.label,
            });
        } catch (error) {
          hosts.push({
            hostId,
            status: "unavailable",
            error: accessCode(error, "storage-unavailable"),
          });
        }
      }
      this.publish({ directory: { status: "ready", hosts } });
    } catch (error) {
      this.publish({
        directory: { status: "failed", error: accessCode(error, "storage-unavailable") },
      });
    }
  }

  reload(): Promise<void> {
    return this.run(() => this.readHosts(), "storage-unavailable");
  }

  scan(): void {
    if (this.closed || this.snapshot.busy) return;
    this.publish({ pairing: { status: "scanning" }, error: null });
  }

  scanned(raw: string): void {
    if (this.closed || this.snapshot.pairing.status !== "scanning") return;
    try {
      this.publish({ pairing: { status: "review", pairing: decodeDshPairing(raw) } });
    } catch (error) {
      this.publish({
        pairing: { status: "failed", error: accessCode(error, "invalid-enrollment") },
      });
    }
  }

  cancelPairing(): void {
    if (this.closed || this.snapshot.pairing.status === "claiming") return;
    this.publish({ pairing: { status: "idle" } });
  }

  pair(deviceLabel: string): Promise<void> {
    const review = this.snapshot.pairing;
    if (review.status !== "review") return this.pending;
    return this.run(async () => {
      this.claim = createDshAbortController();
      this.publish({ pairing: { status: "claiming" } });
      try {
        await pairDshHost({ pairing: review.pairing, deviceLabel, signal: this.claim.signal });
        this.publish({ pairing: { status: "idle" } });
        await this.readHosts();
      } catch (error) {
        this.publish({
          pairing: { status: "failed", error: accessCode(error, "enrollment-outcome-unknown") },
        });
      } finally {
        this.claim = null;
      }
    }, "enrollment-outcome-unknown");
  }

  private closeRuntime(): Promise<void> {
    if (this.runtimeClosing !== null) return this.runtimeClosing;
    const runtime = this.ownedRuntime;
    if (runtime === null) return Promise.resolve();
    this.runtimeClosing = runtime
      .dispose()
      .then(() => {
        this.ownedRuntime = null;
        this.publish({ runtime: null });
        return;
      })
      .catch(() => {
        throw new DshAccessError("runtime-unavailable");
      })
      .finally(() => {
        this.runtimeClosing = null;
      });
    return this.runtimeClosing;
  }

  connect(hostId: ConnectionHostId): Promise<void> {
    return this.run(async () => {
      if (this.snapshot.runtime?.hostId === hostId) {
        return;
      }
      await this.closeRuntime();
      if (this.closed) return;
      // Directory browsing has no persisted conversation selection to restore.
      let selection: SessionSelection = {};
      const runtime = await openSavedDshHost({
        hostId,
        selection: {
          getSnapshot: () => selection,
          set: (value) => {
            selection = value;
          },
        },
      });
      this.ownedRuntime = runtime;
      if (this.closed) await this.closeRuntime();
      else this.publish({ runtime });
    }, "runtime-unavailable");
  }

  reconnect(): void {
    if (this.closed || this.snapshot.busy) return;
    this.ownedRuntime?.connection.reconnect();
  }

  refreshSessions(): Promise<void> {
    return this.run(async () => {
      await this.snapshot.runtime?.sessions.refresh();
    }, "session-refresh-failed");
  }

  loadMoreSessions(): Promise<void> {
    return this.run(async () => {
      await this.snapshot.runtime?.sessions.loadMore();
    }, "session-refresh-failed");
  }

  /** Local forgetting waits for connection disposal; Host-side revocation is a separate action. */
  forget(hostId: ConnectionHostId): Promise<void> {
    return this.run(async () => {
      if (this.snapshot.runtime?.hostId === hostId) await this.closeRuntime();
      if (this.closed) return;
      await dshDeviceStore.forget(hostId);
      await this.readHosts();
    }, "storage-unavailable");
  }

  dispose(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closed = true;
    this.claim?.abort();
    this.listeners.clear();
    // Closing carriers first cancels a pending Session read instead of waiting for it forever.
    this.closing = Promise.allSettled([this.closeRuntime(), this.pending]).then((results) => {
      if (this.ownedRuntime !== null || results.some((result) => result.status === "rejected"))
        throw new DshAccessError("runtime-unavailable");
      return;
    });
    this.snapshot = {
      directory: { status: "ready", hosts: [] },
      pairing: { status: "idle" },
      runtime: null,
      busy: false,
      error: null,
    };
    return this.closing;
  }
}

let activeDirectory: DshDirectory | null = null;
let handoff: Promise<unknown> = Promise.resolve();

/** Serialize route instances so a replacement cannot overlap the previous Host owner. */
export function openDshDirectory(): Promise<DshDirectory> {
  const result = handoff.then(async () => {
    await activeDirectory?.dispose();
    const directory = new DshDirectory();
    activeDirectory = directory;
    return directory;
  });
  handoff = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
