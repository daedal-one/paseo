import { DshSearch } from "./search";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import {
  selectRemoteCapabilities,
  type ConnectionHostId,
  type SessionId,
  type ConnectionHandle,
  type HostCapabilities,
  type ISessions,
} from "@deepseek-ai/dsh-client";
import { brandString } from "@deepseek-ai/dsh-brand";
import { vi } from "vitest";
import type { SessionSelection } from "@deepseek-ai/dsh-client";
import type { DshHostRuntimeOptions } from "./runtime";
import { describe, expect, it } from "vitest";
import { createDshHostRuntime } from "./runtime";

it("exposes Host-owned search with no automatic request while offline", async () => {
  const { runtime, requests } = await offlineRuntime();
  try {
    expect(runtime.search.getSnapshot().availability).toBe("offline");
    const close = runtime.search.begin();
    runtime.search.setQuery("saffron");
    await runtime.search.submit();
    expect(requests).toEqual([]);
    close();
  } finally {
    await runtime.dispose();
  }
});
function offlineHost(hostId: string) {
  let selection: SessionSelection = {};
  const networkListeners = new Set<() => void>();
  const fetch = vi.fn<DshHostRuntimeOptions["fetch"]>();
  const sockets: { close: ReturnType<typeof vi.fn> }[] = [];
  const createSocket = vi.fn<DshHostRuntimeOptions["createSocket"]>(() => {
    let readyState = 0;
    const socket = {
      get readyState() {
        return readyState;
      },
      send: vi.fn(),
      close: vi.fn(() => {
        readyState = 3;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    sockets.push(socket);
    return socket;
  });
  const options: DshHostRuntimeOptions = {
    hostId: brandString<ConnectionHostId>(hostId),
    baseUrl: "https://paired.example",
    isLocal: false,
    fetch,
    createSocket,
    randomId: () => crypto.randomUUID(),
    timeZone: () => "Europe/Rome",
    selection: {
      getSnapshot: () => selection,
      set(value) {
        selection = value;
      },
    },
    network: {
      getSnapshot: () => false,
      subscribe(listener) {
        networkListeners.add(listener);
        return () => networkListeners.delete(listener);
      },
    },
  };
  return { options, fetch, createSocket, networkListeners, sockets };
}

async function offlineRuntime() {
  const host = offlineHost("d8d58893-7978-42cb-a6db-a3b275b7b46b");
  return { runtime: await createDshHostRuntime(host.options), requests: host.fetch.mock.calls };
}

type SearchResponse = Awaited<ReturnType<ISessions["search"]>>;
const hit = brandString<SessionId>("off-page");
const other = brandString<SessionId>("another-page");
const result: SearchResponse = {
  ok: true,
  value: { items: [{ sessionId: hit, snippet: "Recorded saffron" }], hasMore: true },
};
const identity = {
  version: 1 as const,
  hostId: brandString<ConnectionHostId>("d8d58893-7978-42cb-a6db-a3b275b7b46b"),
  activationId: brandString<HostCapabilities["identity"]["activationId"]>(
    "d3d17c83-0ca7-4f45-8f5e-68b8aa0cf23c",
  ),
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  let generation: ReturnType<ConnectionHandle["generation"]["getSnapshot"]> = {
    id: 1,
    host: { home: "/fixture", identity },
  };
  let capabilities: HostCapabilities | undefined = {
    version: 3,
    identity,
    capabilities: selectRemoteCapabilities(["session/search"]).map((value) => ({
      endpoint: value.endpoint,
      mode: value.mode,
      wireFingerprint: value.wireFingerprint,
      semanticRevision: value.semanticRevision,
      availability: "available",
    })),
  };
  const listeners = new Set<() => void>();
  const sessions = {
    searchResultLimit: 20,
    search: vi.fn<ISessions["search"]>(async () => result),
    loadSummary: vi.fn<ISessions["loadSummary"]>(async () => ({ ok: true, value: true })),
  };
  const search = new DshSearch(
    sessions,
    {
      generation: {
        getSnapshot: () => generation,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    },
    () => capabilities,
  );
  const close = search.begin();
  search.setQuery("saffron");
  return {
    search,
    sessions,
    listeners,
    close,
    capabilities: () => capabilities!,
    publish(connected: boolean, next = capabilities) {
      capabilities = next;
      generation = connected
        ? { id: (generation?.id ?? 0) + 1, host: { home: "/fixture", identity } }
        : undefined;
      for (const listener of listeners) listener();
    },
  };
}

describe("explicit native search", () => {
  it("coalesces duplicate and reentrant gestures, then resolves only a displayed hit before navigation", async () => {
    const f = fixture();
    const pending = deferred<SearchResponse>();
    f.sessions.search.mockReturnValueOnce(pending.promise);
    let reentrant: Promise<void> | undefined;
    const remove = f.search.subscribe(() => {
      if (f.search.getSnapshot().read.kind === "loading") reentrant = f.search.submit();
    });
    try {
      const first = f.search.submit();
      expect(f.search.submit()).toBe(first);
      expect(reentrant).toBe(first);
      pending.resolve(result);
      await first;
      expect(f.sessions.search).toHaveBeenCalledTimes(1);
      expect(f.search.getSnapshot()).toMatchObject({
        query: "saffron",
        read: { kind: "ready", result: result.value },
        limit: 20,
      });
      expect(f.sessions.loadSummary).not.toHaveBeenCalled();
      const open = vi.fn();
      await f.search.openResult(other, open);
      expect(f.sessions.loadSummary).not.toHaveBeenCalled();
      const loading = f.search.openResult(hit, open);
      expect(f.search.openResult(hit, open)).toBe(loading);
      await loading;
      expect(f.sessions.loadSummary).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledExactlyOnceWith(hit);
    } finally {
      remove();
      await f.search.dispose();
    }
  });
  it("keeps refusal separate from no matches and retries only explicitly", async () => {
    const f = fixture();
    f.sessions.search.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError("gateway/internal", "Search provider disabled", {}),
    });
    try {
      await f.search.submit();
      expect(f.search.getSnapshot().read).toEqual({ kind: "failed" });
      f.sessions.search.mockResolvedValueOnce({ ok: true, value: { items: [], hasMore: false } });
      await f.search.submit();
      expect(f.search.getSnapshot().read).toEqual({
        kind: "ready",
        result: { items: [], hasMore: false },
      });
      expect(f.sessions.search).toHaveBeenCalledTimes(2);
    } finally {
      await f.search.dispose();
    }
  });
  it("validates empty and over-limit phrases without requests and forwards an exact maximum phrase", async () => {
    const f = fixture();
    try {
      f.search.setQuery("   ");
      await f.search.submit();
      expect(f.search.getSnapshot().validation).toBe("empty");
      f.search.setQuery("😀".repeat(251));
      await f.search.submit();
      expect(f.search.getSnapshot().validation).toBe("too-long");
      expect(f.sessions.search).not.toHaveBeenCalled();
      f.search.setQuery("😀".repeat(250));
      await f.search.submit();
      expect(f.sessions.search.mock.calls[0][0]).toBe("😀".repeat(250));
    } finally {
      await f.search.dispose();
    }
  });
  it.each(["missing", "unavailable", "mode", "wire", "semantic", "context"] as const)(
    "admits optional search independently with %s capability metadata",
    async (kind) => {
      const f = fixture();
      const base = f.capabilities();
      const capability = base.capabilities[0];
      const fields = {
        endpoint: capability.endpoint,
        mode: kind === "mode" ? ("stream" as const) : capability.mode,
        wireFingerprint: kind === "wire" ? "other" : capability.wireFingerprint,
        semanticRevision: kind === "semantic" ? 99 : capability.semanticRevision,
      };
      try {
        const availability =
          kind === "context" ? ("context-required" as const) : ("available" as const);
        const capabilities: HostCapabilities["capabilities"][number][] =
          kind === "missing" ? [] : [{ ...fields, availability }];
        if (kind === "unavailable")
          capabilities[0] = { ...fields, availability: "unavailable", reason: "service" };
        f.publish(true, { ...base, capabilities });
        await f.search.submit();
        expect(f.search.getSnapshot().availability).toBe(
          kind === "context" ? "available" : "unavailable",
        );
        expect(f.sessions.search).toHaveBeenCalledTimes(kind === "context" ? 1 : 0);
      } finally {
        await f.search.dispose();
      }
    },
  );
  it.each(["success", "failure"] as const)(
    "query replacement refuses late %s and allows a new read before the old carrier settles",
    async (kind) => {
      const f = fixture();
      const pending = deferred<SearchResponse>();
      f.sessions.search.mockReturnValueOnce(pending.promise);
      try {
        const old = f.search.submit();
        await Promise.resolve();
        const signal = f.sessions.search.mock.calls[0][1];
        f.search.setQuery("new phrase");
        expect(signal.aborted).toBe(true);
        await f.search.submit();
        const accepted = f.search.getSnapshot();
        if (kind === "success") pending.resolve({ ok: true, value: { items: [], hasMore: false } });
        else pending.reject(new Error("late carrier"));
        await old;
        expect(f.search.getSnapshot()).toBe(accepted);
      } finally {
        pending.resolve(result);
        await f.search.dispose();
      }
    },
  );
  it.each(["edit", "close", "generation", "replacement"] as const)(
    "cancels summary opening on %s without navigating",
    async (kind) => {
      const f = fixture();
      const pending = deferred<Awaited<ReturnType<ISessions["loadSummary"]>>>();
      const open = vi.fn();
      try {
        await f.search.submit();
        f.sessions.loadSummary.mockReturnValueOnce(pending.promise);
        const loading = f.search.openResult(hit, open);
        await Promise.resolve();
        const signal = f.sessions.loadSummary.mock.calls[0][1];
        if (kind === "edit") f.search.setQuery("other");
        else if (kind === "close") f.close();
        else if (kind === "generation") f.publish(false);
        else {
          f.search.begin();
          f.close();
          f.search.setQuery("replacement");
        }
        expect(signal.aborted).toBe(true);
        pending.resolve({ ok: true, value: true });
        await loading;
        expect(open).not.toHaveBeenCalled();
        if (kind === "replacement") {
          await f.search.submit();
          expect(f.sessions.search).toHaveBeenCalledTimes(2);
        }
      } finally {
        pending.resolve({ ok: true, value: true });
        await f.search.dispose();
      }
    },
  );
  it("retains results after missing/failed summaries and permits explicit retry", async () => {
    const f = fixture();
    const open = vi.fn();
    try {
      await f.search.submit();
      const read = f.search.getSnapshot().read;
      f.sessions.loadSummary.mockResolvedValueOnce({ ok: true, value: false });
      await f.search.openResult(hit, open);
      expect(f.search.getSnapshot().opening).toEqual({ kind: "missing", id: hit });
      f.sessions.loadSummary.mockResolvedValueOnce({
        ok: false,
        error: new RemoteError("gateway/internal", "read failed", {}),
      });
      await f.search.openResult(hit, open);
      expect(f.search.getSnapshot().opening).toEqual({ kind: "failed", id: hit });
      expect(f.search.getSnapshot().read).toBe(read);
      expect(open).not.toHaveBeenCalled();
      await f.search.openResult(hit, open);
      expect(open).toHaveBeenCalledExactlyOnceWith(hit);
    } finally {
      await f.search.dispose();
    }
  });
  it("clears results on disconnect, preserves the draft and never searches on reconnect", async () => {
    const f = fixture();
    try {
      await f.search.submit();
      f.publish(false);
      expect(f.search.getSnapshot()).toMatchObject({
        availability: "offline",
        query: "saffron",
        read: { kind: "idle" },
      });
      await f.search.submit();
      f.publish(true);
      expect(f.sessions.search).toHaveBeenCalledTimes(1);
      expect(f.search.getSnapshot().read).toEqual({ kind: "idle" });
      await f.search.submit();
      expect(f.sessions.search).toHaveBeenCalledTimes(2);
    } finally {
      await f.search.dispose();
    }
  });
  it("joins cancelled carriers on disposal and refuses later reads", async () => {
    const f = fixture();
    const pending = deferred<SearchResponse>();
    f.sessions.search.mockReturnValueOnce(pending.promise);
    const started = f.search.submit();
    await Promise.resolve();
    f.close();
    let disposed = false;
    const done = f.search.dispose().then(() => {
      disposed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(f.listeners.size).toBe(0);
    f.search.begin();
    f.search.setQuery("later");
    await f.search.submit();
    expect(f.sessions.search).toHaveBeenCalledTimes(1);
    pending.resolve(result);
    await started;
    await done;
    expect(disposed).toBe(true);
  });
});
