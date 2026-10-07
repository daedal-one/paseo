import type {
  ConnectionHostId,
  ConversationScheduler,
  SessionId,
  SessionSelection,
  SessionSelectionStore,
} from "@deepseek-ai/dsh-client";
import { createDshAbortController } from "../runtime/dsh-abort-controller";
import { DshDiscovery } from "./discovery";
import { DshAccessError, type DshAccessErrorCode } from "./access-error";
import { decodeDshPairing, type DshPairing } from "./pairing";
import type { DshConversation, DshHostRuntime } from "./runtime";
import { DshContinuum, type ContinuumStorage } from "./continuum";
import { conversationPreview } from "./continuum-preview";

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
  | { status: "wrong-host" }
  | { status: "failed"; error: DshAccessErrorCode };
/** Only text that has never crossed an uncertain submission is restored as an editable draft. */
export function savedDraft(prompt: import("./prompt").DshPromptSnapshot): string {
  return prompt.draftLocked ||
    prompt.submission.kind === "sending" ||
    prompt.submission.kind === "unknown"
    ? ""
    : prompt.text;
}

export interface DshDirectorySnapshot {
  directory: DshDirectoryLoad;
  pairing: DshPairingState;
  runtime: DshHostRuntime | null;
  conversation: DshConversation | null;
  discovery: DshDiscovery | null;
  cache: DshContinuum | null;
  cachedSessionId: SessionId | null;
  busy: boolean;
  error: DshAccessErrorCode | null;
}

function accessCode(error: unknown, fallback: DshAccessErrorCode): DshAccessErrorCode {
  return error instanceof DshAccessError ? error.code : fallback;
}

export interface DshDirectoryAccess {
  list(signal: AbortSignal): Promise<readonly DshDirectoryHost[]>;
  pair(options: { pairing: unknown; deviceLabel: string; signal: AbortSignal }): Promise<unknown>;
  open(options: {
    hostId: ConnectionHostId;
    selection: SessionSelectionStore;
    signal: AbortSignal;
  }): Promise<DshHostRuntime>;
  forget(hostId: ConnectionHostId): Promise<void>;
}

/** Owns one visible Host connection. Leaving the screen releases it, never its Sessions. */
export class DshDirectory {
  private snapshot: DshDirectorySnapshot = {
    directory: { status: "loading" },
    pairing: { status: "idle" },
    runtime: null,
    conversation: null,
    discovery: null,
    cache: null,
    cachedSessionId: null,
    busy: false,
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = createDshAbortController();
  private closed = false;

  constructor(
    private readonly access: DshDirectoryAccess,
    private readonly storage?: ContinuumStorage,
  ) {}
  private releaseSelection: (() => void) | null = null;
  private releaseDraft: (() => void) | null = null;
  private ownedRuntime: DshHostRuntime | null = null;
  private runtimeClosing: Promise<void> | null = null;
  private pending: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private claim: AbortController | null = null;
  private pairingHostId: ConnectionHostId | null = null;

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
      const hosts = await this.access.list(this.lifetime.signal);
      this.publish({ directory: { status: "ready", hosts } });
      if (this.ownedRuntime === null && this.storage !== undefined && !this.closed) {
        const saved = await this.storage.getItem("daedal-dsh:last-host:v1");
        let host = hosts.find((item) => item.hostId === saved);
        if (saved === null && hosts.length === 1) host = hosts[0];
        if (host?.status === "paired") await this.connectHost(host.hostId);
      }
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
    if (this.snapshot.pairing.status === "idle") this.pairingHostId = null;
    this.publish({ pairing: { status: "scanning" }, error: null });
  }

  scanned(raw: string): void {
    if (this.closed || this.snapshot.pairing.status !== "scanning") return;
    try {
      const pairing = decodeDshPairing(raw);
      if (this.pairingHostId !== null && pairing.enrollment.hostId !== this.pairingHostId) {
        this.publish({ pairing: { status: "wrong-host" } });
        return;
      }
      this.publish({ pairing: { status: "review", pairing } });
    } catch (error) {
      this.publish({
        pairing: { status: "failed", error: accessCode(error, "invalid-enrollment") },
      });
    }
  }

  cancelPairing(): void {
    if (this.closed || this.snapshot.pairing.status === "claiming") return;
    this.pairingHostId = null;
    this.publish({ pairing: { status: "idle" } });
  }

  pair(deviceLabel: string): Promise<void> {
    const review = this.snapshot.pairing;
    if (review.status !== "review") return this.pending;
    return this.run(async () => {
      this.claim = createDshAbortController();
      this.publish({ pairing: { status: "claiming" } });
      try {
        await this.access.pair({ pairing: review.pairing, deviceLabel, signal: this.claim.signal });
        this.pairingHostId = null;
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
    this.rememberConversation();
    this.releaseDraft?.();
    this.releaseDraft = null;
    this.releaseSelection?.();
    this.releaseSelection = null;
    const runtime = this.ownedRuntime;
    if (runtime === null) return Promise.resolve();
    this.runtimeClosing = Promise.allSettled([
      this.snapshot.discovery?.dispose(),
      runtime.dispose(),
      this.snapshot.cache?.flush(),
    ])
      .then((results) => {
        if (results[1].status === "rejected") throw new DshAccessError("runtime-unavailable");
        this.ownedRuntime = null;
        this.publish({
          runtime: null,
          conversation: null,
          discovery: null,
          ...(results[2].status === "rejected" ? { error: "storage-unavailable" as const } : {}),
        });
        if (results[0].status === "rejected") throw new DshAccessError("runtime-unavailable");
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
    return this.run(() => this.connectHost(hostId), "runtime-unavailable");
  }

  private async connectHost(hostId: ConnectionHostId): Promise<void> {
    if (this.ownedRuntime?.hostId === hostId) return;
    await this.closeRuntime();
    if (this.closed) return;
    const cache = this.storage === undefined ? null : new DshContinuum(hostId, this.storage);
    if (cache !== null) await cache.restore();
    let selection: SessionSelection = {};
    const runtime = await this.access.open({
      signal: this.lifetime.signal,
      hostId,
      selection: cache?.selection ?? {
        getSnapshot: () => selection,
        set(value) {
          selection = value;
        },
      },
    });
    this.ownedRuntime = runtime;
    if (this.closed) {
      await this.closeRuntime();
      return;
    }
    const selected = cache?.selection.getSnapshot().sessionId ?? null;
    this.publish({
      runtime,
      cache,
      cachedSessionId: selected,
      discovery: new DshDiscovery(runtime.connection, hostId),
    });
    if (this.storage !== undefined) await this.storage.setItem("daedal-dsh:last-host:v1", hostId);
    const restore = () => {
      void this.restoreConversation();
    };
    const releases = [
      runtime.sessions.list.subscribe(restore),
      runtime.connection.generation.subscribe(restore),
    ];
    this.releaseSelection = () => {
      for (const release of releases) release();
    };
    await this.restoreConversation();
  }

  private restoring = false;
  private async restoreConversation(): Promise<void> {
    const { runtime, cachedSessionId } = this.snapshot;
    if (this.restoring || runtime === null || cachedSessionId === null || this.closed) return;
    const list = runtime.sessions.list.getSnapshot();
    if (list.phase !== "ready" || runtime.connection.generation.getSnapshot() === undefined) return;
    this.restoring = true;
    try {
      const address = this.snapshot.cache?.selection.getSnapshot().subagentAddress;
      if (address !== undefined) runtime.sessions.openSubagent(address);
      else await runtime.sessions.loadSummary(cachedSessionId, this.lifetime.signal);
      if (
        this.closed ||
        this.ownedRuntime !== runtime ||
        this.snapshot.cachedSessionId !== cachedSessionId
      )
        return;
      if (runtime.sessions.binding(cachedSessionId) !== undefined)
        this.showConversation(runtime, cachedSessionId, null);
      else this.publish({ error: "session-unavailable" });
    } catch {
      if (this.ownedRuntime === runtime && this.snapshot.cachedSessionId === cachedSessionId)
        this.publish({ error: "session-unavailable" });
    } finally {
      this.restoring = false;
      if (
        !this.closed &&
        this.snapshot.cachedSessionId !== null &&
        (this.ownedRuntime !== runtime || this.snapshot.cachedSessionId !== cachedSessionId)
      )
        void this.restoreConversation();
    }
  }

  rememberConversation(): void {
    const { conversation, runtime, cache } = this.snapshot;
    if (conversation === null || runtime === null || cache === null) return;
    const row = runtime.sessions.list.getSnapshot().byId[conversation.sessionId];
    cache.save(
      conversation.sessionId,
      row?.displayTitle ?? conversation.sessionId,
      conversationPreview(conversation),
      savedDraft(conversation.prompt.getSnapshot()),
      Date.now(),
    );
  }

  async suspend(): Promise<void> {
    this.rememberConversation();
    try {
      await this.snapshot.cache?.flush();
    } catch {
      this.publish({ error: "storage-unavailable" });
    }
  }

  private showConversation(
    runtime: DshHostRuntime,
    id: SessionId,
    scheduler: ConversationScheduler | null,
  ): void {
    this.rememberConversation();
    this.releaseDraft?.();
    const conversation = runtime.openConversation(id, scheduler);
    const saved = this.snapshot.cache?.getSnapshot().rows.find((row) => row.id === id);
    if (saved !== undefined && conversation.prompt.getSnapshot().text === "")
      conversation.prompt.setText(saved.draft);
    this.publish({ conversation, cachedSessionId: null });
    let draft = savedDraft(conversation.prompt.getSnapshot());
    const releasePrompt = conversation.prompt.subscribe(() => {
      const next = savedDraft(conversation.prompt.getSnapshot());
      if (next === draft) return;
      draft = next;
      const cache = this.snapshot.cache;
      const old = cache?.getSnapshot().rows.find((row) => row.id === id);
      cache?.save(
        id,
        runtime.sessions.list.getSnapshot().byId[id]?.displayTitle ?? id,
        old?.text ?? "",
        draft,
        old?.savedAt ?? Date.now(),
      );
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const releaseTranscript = conversation.conversation.target("chat").subscribe(() => {
      if (timer === null)
        timer = setTimeout(() => {
          timer = null;
          if (this.snapshot.conversation === conversation) this.rememberConversation();
        }, 1500);
    });
    this.releaseDraft = () => {
      releasePrompt();
      releaseTranscript();
      if (timer !== null) clearTimeout(timer);
    };
  }

  /** Candidate addresses never override the origin stored with a protected grant or QR. */
  selectDiscoveredHost(hostId: ConnectionHostId): Promise<void> {
    if (this.closed || this.snapshot.busy || this.snapshot.pairing.status !== "idle")
      return this.pending;
    const discovery = this.snapshot.discovery?.getSnapshot();
    const directory = this.snapshot.directory;
    if (
      discovery?.status !== "ready" ||
      directory.status !== "ready" ||
      !discovery.candidates.some((candidate) => candidate.identity.hostId === hostId)
    )
      return Promise.resolve();
    const saved = directory.hosts.find((host) => host.hostId === hostId);
    if (saved?.status === "paired") return this.connect(saved.hostId);
    if (saved?.status === "unavailable") {
      this.publish({ error: saved.error });
      return Promise.resolve();
    }
    this.scan();
    this.pairingHostId = hostId;
    return Promise.resolve();
  }

  openConversation(id: SessionId, scheduler: ConversationScheduler | null): Promise<void> {
    return this.run(async () => {
      const runtime = this.ownedRuntime;
      if (runtime === null) throw new DshAccessError("session-unavailable");
      if (
        runtime.connection.generation.getSnapshot() === undefined ||
        runtime.sessions.binding(id) === undefined
      ) {
        if (this.snapshot.conversation !== null) this.closeConversation();
        this.publish({ cachedSessionId: id });
        this.snapshot.cache?.selection.set({ sessionId: id });
        await this.restoreConversation();
      } else this.showConversation(runtime, id, scheduler);
    }, "session-unavailable");
  }

  openSubagent(address: Parameters<DshHostRuntime["sessions"]["openSubagent"]>[0]): void {
    const runtime = this.ownedRuntime;
    if (runtime === null || this.closed || this.snapshot.busy) return;
    this.rememberConversation();
    runtime.sessions.openSubagent(address);
    this.showConversation(runtime, address.childSessionId, null);
  }

  closeConversation(): void {
    if (this.closed) return;
    this.rememberConversation();
    this.releaseDraft?.();
    this.releaseDraft = null;
    this.ownedRuntime?.closeConversation();
    this.publish({ conversation: null, cachedSessionId: null });
  }

  retryConversation(): Promise<void> {
    return this.run(async () => {
      await this.snapshot.conversation?.session.retryOpen();
    }, "session-unavailable");
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
      await this.access.forget(hostId);
      if (this.storage !== undefined) {
        const cache = new DshContinuum(hostId, this.storage);
        await cache.forget();
        if ((await this.storage.getItem("daedal-dsh:last-host:v1")) === hostId)
          await this.storage.removeItem("daedal-dsh:last-host:v1");
      }
      this.publish({ cache: null, cachedSessionId: null });
      await this.readHosts();
    }, "storage-unavailable");
  }

  dispose(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closed = true;
    this.lifetime.abort();
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
      conversation: null,
      discovery: null,
      cache: null,
      cachedSessionId: null,
      busy: false,
      error: null,
    };
    return this.closing;
  }
}

/** Serialize route instances so a replacement cannot overlap the previous Host owner. */
export function createDshDirectoryOwner(create: () => DshDirectory): () => Promise<DshDirectory> {
  let activeDirectory: DshDirectory | null = null;
  let handoff: Promise<unknown> = Promise.resolve();
  return () => {
    const result = handoff.then(async () => {
      await activeDirectory?.dispose();
      const directory = create();
      activeDirectory = directory;
      return directory;
    });
    handoff = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
