import { brandString } from "@deepseek-ai/dsh-brand";
import {
  createConnectionRpc,
  readHostIdentity,
  type RpcId,
  type SessionId,
  type SessionSelection,
} from "@deepseek-ai/dsh-client";
import { createBrowserDshTransport } from "../../../src/dsh/browser/transport";
import { createDshHostRuntime, type DshHostRuntime } from "../../../src/dsh/runtime";

interface Observable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/** Bounded readiness, not a replacement Session store or a fabricated Host response. */
function ready<T>(
  source: Observable<T>,
  predicate: (value: T) => boolean,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (predicate(source.getSnapshot())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancelled);
      unsubscribe();
      complete();
    };
    const cancelled = () => finish(() => reject(signal.reason));
    const check = () => {
      try {
        if (predicate(source.getSnapshot())) finish(resolve);
      } catch (error) {
        finish(() => reject(error));
      }
    };
    signal.addEventListener("abort", cancelled, { once: true });
    try {
      unsubscribe = source.subscribe(check);
      // A synchronous subscription callback settled before its disposer was returned.
      if (settled) unsubscribe();
      else check();
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

/**
 * Test-only composition of the actual product runtime over the authenticated page transport.
 * The production app independently renders the Host log; no product debug route/global exists.
 * Callers own this handle and must dispose it before reloading or closing the page.
 */
export async function createMountedDshOwner(id: string) {
  const transport = createBrowserDshTransport();
  const startup = new AbortController();
  const timeout = setTimeout(() => {
    startup.abort(new Error("Mounted product-owner startup exceeded 30 seconds"));
    // This also aborts a pending identity fetch before a JSHandle exists to own cleanup.
    transport.dispose();
  }, 30_000);
  let runtime: DshHostRuntime | undefined;
  let selection: SessionSelection = {};
  try {
    const rpc = createConnectionRpc({
      baseUrl: transport.origin,
      fetch: transport.fetch,
      randomId: () => brandString<RpcId>(crypto.randomUUID()),
    });
    const identity = await readHostIdentity(rpc, startup.signal);
    startup.signal.throwIfAborted();
    if (!identity.ok) throw new Error("Private Host identity is unavailable");
    runtime = await createDshHostRuntime({
      hostId: identity.value.hostId,
      baseUrl: transport.origin,
      isLocal: true,
      fetch: transport.fetch,
      createSocket: transport.createSocket,
      randomId: () => crypto.randomUUID(),
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      selection: {
        getSnapshot: () => selection,
        set(value) {
          selection = value;
        },
      },
    });
    const owner = runtime;
    const sessionId = brandString<SessionId>(id);
    await ready(
      owner.sessions.list,
      (snapshot) => snapshot.phase === "ready" && snapshot.byId[sessionId] !== undefined,
      startup.signal,
    );
    const view = owner.openConversation(sessionId, null);
    await ready(view.prompt, (snapshot) => snapshot.availability === "ready", startup.signal);
    return {
      hostId: identity.value.hostId,
      sessionId,
      prompt: view.prompt,
      generation: () => owner.connection.generation.getSnapshot()?.id ?? null,
      reconnect: () => owner.connection.reconnect(),
      async dispose() {
        try {
          await owner.dispose();
        } finally {
          transport.dispose();
        }
      },
    };
  } catch (error) {
    try {
      await runtime?.dispose();
    } finally {
      transport.dispose();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
