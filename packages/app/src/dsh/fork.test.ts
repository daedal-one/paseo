import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import {
  SessionForkError,
  selectRemoteCapabilities,
  type ConnectionHandle,
  type ConnectionHostId,
  type HostCapabilities,
  type ISessions,
  type IWorkspaces,
  type WorkspaceId,
  type SessionId,
} from "@deepseek-ai/dsh-client";
import { DshFork } from "./fork";
import { DshForkJournal } from "./fork-journal";
import type { DshCreationStorage } from "./creation-journal";
function cell<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    set(next: T) {
      value = next;
      for (const fn of listeners) fn();
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function store() {
  const rows = new Map<string, string>();
  const storage: DshCreationStorage = {
    async transact(host, update) {
      const before = rows.get(host) ?? null;
      const after = update(before);
      if (after === null) rows.delete(host);
      else rows.set(host, after);
      return { before, after };
    },
  };
  return { storage, rows };
}
const sid = (value: string) => brandString<SessionId>(value);
const identity = {
  version: 1 as const,
  hostId: brandString<ConnectionHostId>("host-a"),
  activationId: brandString<HostCapabilities["identity"]["activationId"]>("activation-a"),
};
const owners: DshFork[] = [];
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.dispose()));
});
function advertised(increment = 0) {
  return selectRemoteCapabilities(["session/forkTo"]).map((value) =>
    Object.assign({}, value, {
      availability: "available" as const,
      semanticRevision: value.semanticRevision + increment,
    }),
  );
}
async function fixture(storage: DshCreationStorage | null = store().storage) {
  const generation = cell<ReturnType<ConnectionHandle["generation"]["getSnapshot"]>>({
    id: 1,
    host: { home: "/fixture", identity },
  });
  let capabilities: HostCapabilities = {
    version: 3,
    identity,
    capabilities: advertised(),
  };
  const list = cell<ReturnType<ISessions["list"]["getSnapshot"]>>({
    phase: "ready",
    ids: [],
    byId: {},
    current: undefined,
    hasMore: false,
    loadingMore: false,
    state: "idle",
    error: null,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  });
  const workspaces = {
    list: cell<ReturnType<IWorkspaces["list"]["getSnapshot"]>>({
      phase: "ready",
      items: [],
      archivedSessionIds: [],
      state: "idle",
      error: null,
    }),
  };
  const sessions = {
    list,
    forkTo: vi.fn<ISessions["forkTo"]>(async (request) => request.childSessionId),
    loadSummary: vi.fn<ISessions["loadSummary"]>(async () => ({ ok: true, value: false })),
  };
  const journal = storage === null ? undefined : new DshForkJournal(identity.hostId, storage);
  let sequence = 0;
  const fork = new DshFork(
    sessions,
    workspaces,
    { generation },
    () => capabilities,
    () => sid(`child-${++sequence}`),
    journal,
  );
  owners.push(fork);
  await fork.restore();
  const close = fork.begin();
  return {
    fork,
    journal: journal!,
    sessions,
    workspaces,
    generation,
    close,
    change(fn: (value: HostCapabilities) => HostCapabilities) {
      capabilities = fn(capabilities);
      generation.set({ id: 2, host: { home: "/fixture", identity } });
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function unknown() {
  const f = await fixture();
  f.sessions.forkTo.mockRejectedValue(new Error("lost"));
  await f.fork.fork(sid("source"));
  return f;
}
function setChild(f: Fixture, parent = "source") {
  const id = sid("child-1");
  f.sessions.list.set({
    ...f.sessions.list.getSnapshot(),
    ids: [id],
    byId: {
      [id]: {
        id,
        parentId: sid(parent),
        displayTitle: "Current child",
        running: false,
        blank: false,
        updatedAt: 1,
      },
    },
  });
}
describe("native fork ownership", () => {
  it("journals the exact request before one dispatch and coalesces reentrant gestures", async () => {
    const f = await fixture();
    const held = deferred<SessionId>();
    f.sessions.forkTo.mockImplementation(async (request) => {
      expect(await f.journal.read()).toEqual({ kind: "unknown", request });
      return held.promise;
    });
    const off = f.fork.subscribe(() => {
      if (f.fork.getSnapshot().outcome.kind === "sending") void f.fork.fork(sid("wrong"));
    });
    const one = f.fork.fork(sid("source"), 7);
    const two = f.fork.fork(sid("other"));
    expect(two).toBe(one);
    held.resolve(sid("child-1"));
    await one;
    off();
    expect(f.sessions.forkTo.mock.calls).toEqual([
      [{ sessionId: "source", childSessionId: "child-1", atSeq: 7 }],
    ]);
    expect(f.fork.getSnapshot().outcome).toEqual({
      kind: "confirmed",
      request: { sessionId: "source", childSessionId: "child-1", atSeq: 7 },
    });
    await f.fork.fork(sid("another"));
    expect(f.sessions.forkTo).toHaveBeenCalledTimes(1);
    await f.fork.reset();
    expect(f.fork.getSnapshot().outcome).toEqual({ kind: "idle" });
  });
  it("disables optional mutation on old Hosts and without storage", async () => {
    const f = await fixture();
    f.change((value) => ({ ...value, capabilities: [] }));
    expect(f.fork.getSnapshot()).toMatchObject({
      availability: "unavailable",
      lookupAvailability: "available",
    });
    await f.fork.fork(sid("source"));
    expect(f.sessions.forkTo).not.toHaveBeenCalled();
    expect(await f.journal.read()).toBeNull();
    const missing = await fixture(null);
    await missing.fork.fork(sid("source"));
    expect(missing.fork.getSnapshot().storage).toBe("unavailable");
    expect(missing.sessions.forkTo).not.toHaveBeenCalled();
    f.change((value) => ({
      ...value,
      capabilities: advertised(1),
    }));
    await f.fork.fork(sid("source"));
    expect(f.sessions.forkTo).not.toHaveBeenCalled();
  });
  it("does not dispatch offline or after its view or generation closes during the durable claim", async () => {
    const offline = await fixture();
    offline.generation.set(undefined);
    await offline.fork.fork(sid("source"));
    expect(await offline.journal.read()).toBeNull();
    for (const abandon of [
      (f: Fixture) => f.close(),
      (f: Fixture) => f.generation.set(undefined),
    ]) {
      const storage = store();
      const held = deferred<void>();
      let block = false;
      const f = await fixture({
        async transact(host, update) {
          if (block) await held.promise;
          return storage.storage.transact(host, update);
        },
      });
      block = true;
      const task = f.fork.fork(sid("source"));
      abandon(f);
      held.resolve();
      await task;
      expect(f.sessions.forkTo).not.toHaveBeenCalled();
      expect((await f.journal.read())?.kind).toBe("not-dispatched");
      await f.fork.reset();
      expect(await f.journal.read()).toBeNull();
    }
  });
  it("retains an unknown attempt across cold restoration with no automatic read or resend", async () => {
    const storage = store();
    const first = await fixture(storage.storage);
    first.sessions.forkTo.mockRejectedValue(new Error("lost reply"));
    await first.fork.fork(sid("source"), 4);
    await first.fork.dispose();
    const cold = await fixture(storage.storage);
    cold.generation.set(undefined);
    cold.generation.set({ id: 9, host: { home: "/fixture", identity } });
    await cold.fork.reset();
    await cold.fork.fork(sid("source"));
    expect(cold.fork.getSnapshot().outcome).toMatchObject({
      kind: "unknown",
      request: { sessionId: "source", childSessionId: "child-1", atSeq: 4 },
    });
    expect(cold.sessions.forkTo).not.toHaveBeenCalled();
    expect(cold.sessions.loadSummary).not.toHaveBeenCalled();
  });
  it("requires explicit current child adoption and keeps absence, wrong lineage and failure uncertain", async () => {
    const f = await unknown();
    await f.fork.checkCurrent();
    expect(f.fork.getSnapshot().lookup.kind).toBe("absent");
    await f.fork.adoptCurrent();
    await f.fork.reset();
    expect(f.fork.getSnapshot().outcome.kind).toBe("unknown");
    f.sessions.loadSummary.mockResolvedValue({
      ok: false,
      error: new RemoteError("gateway/internal", "unavailable", {}),
    });
    await f.fork.checkCurrent();
    expect(f.fork.getSnapshot().lookup.kind).toBe("failed");
    f.sessions.loadSummary.mockResolvedValue({ ok: true, value: true });
    setChild(f, "wrong-parent");
    await f.fork.checkCurrent();
    expect(f.fork.getSnapshot().lookup.kind).toBe("mismatch");
    setChild(f);
    await f.fork.checkCurrent();
    expect(f.fork.getSnapshot().lookup).toMatchObject({
      kind: "found",
      child: { id: "child-1", parentId: "source", workspaceIds: [] },
    });
    expect(f.fork.getSnapshot().outcome.kind).toBe("unknown");
    await f.fork.adoptCurrent();
    expect((await f.journal.read())?.kind).toBe("adopted");
    expect(f.sessions.forkTo).toHaveBeenCalledTimes(1);
    expect(f.sessions.loadSummary.mock.calls.every((call) => call[0] === "child-1")).toBe(true);
    await f.fork.reset();
    expect(await f.journal.read()).toBeNull();
  });
  it("distinguishes pending Workspace membership and records the reviewed current baseline", async () => {
    const f = await unknown();
    setChild(f);
    f.sessions.loadSummary.mockResolvedValue({ ok: true, value: true });
    f.workspaces.list.set({ ...f.workspaces.list.getSnapshot(), phase: "pending" });
    await f.fork.checkCurrent();
    expect(f.fork.getSnapshot().lookup).toMatchObject({ child: { workspaceIds: null } });
    f.workspaces.list.set({
      ...f.workspaces.list.getSnapshot(),
      phase: "ready",
      items: [
        {
          workspaceId: brandString<WorkspaceId>("workspace"),
          path: "/host",
          title: "Project",
          createdAt: "2026-09-22T00:00:00Z",
          updatedAt: "2026-09-22T00:00:00Z",
          sessionIds: [sid("child-1")],
        },
      ],
    });
    await f.fork.checkCurrent();
    expect(f.fork.getSnapshot().lookup).toMatchObject({ child: { workspaceIds: ["workspace"] } });
    await f.fork.adoptCurrent();
    expect(await f.journal.read()).toMatchObject({
      kind: "adopted",
      child: { workspaceIds: ["workspace"] },
    });
  });
  it("cancels replaced views, ignores held replies and preserves a successor view from old cleanup", async () => {
    const f = await unknown();
    const held = deferred<Awaited<ReturnType<ISessions["loadSummary"]>>>();
    f.sessions.loadSummary.mockReturnValueOnce(held.promise);
    const old = f.fork.checkCurrent();
    await Promise.resolve();
    const signal = f.sessions.loadSummary.mock.calls[0][1];
    const close = f.fork.begin();
    f.close();
    expect(signal.aborted).toBe(true);
    await f.fork.checkCurrent();
    expect(f.sessions.loadSummary).toHaveBeenCalledTimes(2);
    expect(f.fork.getSnapshot().lookup.kind).toBe("absent");
    setChild(f);
    held.resolve({ ok: true, value: true });
    await old;
    expect(f.fork.getSnapshot().lookup.kind).toBe("absent");
    close();
    await f.fork.checkCurrent();
    expect(f.sessions.loadSummary).toHaveBeenCalledTimes(2);
  });
  it("cancels generation reads and joins already retired carriers on disposal", async () => {
    const f = await unknown();
    const held = deferred<Awaited<ReturnType<ISessions["loadSummary"]>>>();
    f.sessions.loadSummary.mockReturnValueOnce(held.promise);
    const read = f.fork.checkCurrent();
    await Promise.resolve();
    f.generation.set(undefined);
    expect(f.sessions.loadSummary.mock.calls[0][1].aborted).toBe(true);
    let joined = false;
    const dispose = f.fork.dispose().then(() => {
      joined = true;
      return undefined;
    });
    await Promise.resolve();
    expect(joined).toBe(false);
    held.reject(new Error("late"));
    await read;
    await dispose;
    expect(joined).toBe(true);
  });
  it("retains exact attachment failure and does not mistake other dispatch errors for rejection", async () => {
    for (const wrong of [false, true]) {
      const f = await fixture();
      f.sessions.forkTo.mockRejectedValue(
        new SessionForkError(
          new RemoteError("session/workspace-attach-failed", "attach failed", {
            sessionId: sid(wrong ? "other" : "child-1"),
            workspaceId: "workspace",
          }),
          sid("source"),
          sid("child-1"),
        ),
      );
      await f.fork.fork(sid("source"));
      expect(f.fork.getSnapshot().outcome.kind).toBe(wrong ? "unknown" : "attachment-failed");
      await f.fork.reset();
      expect((await f.journal.read())?.kind).toBe(wrong ? "unknown" : "attachment-failed");
      if (!wrong) {
        setChild(f);
        f.sessions.loadSummary.mockResolvedValue({ ok: true, value: true });
        await f.fork.checkCurrent();
        await f.fork.adoptCurrent();
        expect((await f.journal.read())?.kind).toBe("adopted");
      }
    }
    const f = await fixture();
    f.sessions.forkTo.mockResolvedValue(sid("wrong-child"));
    await f.fork.fork(sid("source"));
    expect(f.fork.getSnapshot().outcome.kind).toBe("unknown");
  });
  it("keeps broad and foreign attachment errors unknown", async () => {
    const failures = [
      new Error("carrier"),
      new SessionForkError(
        new RemoteError("session/fork-unavailable", "refused", { sessionId: sid("source") }),
        sid("source"),
        sid("child-1"),
      ),
      Object.assign(new Error("foreign class"), {
        rpcError: {
          code: "session/workspace-attach-failed",
          details: { sessionId: "child-1", workspaceId: "w" },
        },
      }),
      new SessionForkError(
        new RemoteError("session/workspace-attach-failed", "bad", {
          sessionId: sid("child-1"),
          workspaceId: "w",
        }),
        sid("foreign"),
        sid("child-1"),
      ),
    ];
    for (const error of failures) {
      const f = await fixture();
      f.sessions.forkTo.mockRejectedValue(error);
      await f.fork.fork(sid("source"));
      expect(f.fork.getSnapshot().outcome.kind).toBe("unknown");
    }
  });
  it("allows only one competing owner to dispatch and preserves adopted evidence against late success", async () => {
    const storage = store();
    const one = await fixture(storage.storage);
    const two = await fixture(storage.storage);
    const held = deferred<SessionId>();
    one.sessions.forkTo.mockReturnValue(held.promise);
    const first = one.fork.fork(sid("source"));
    try {
      await two.fork.fork(sid("source"));
      expect(two.sessions.forkTo).not.toHaveBeenCalled();
      setChild(two);
      two.sessions.loadSummary.mockResolvedValue({ ok: true, value: true });
      await two.fork.checkCurrent();
      await two.fork.adoptCurrent();
      held.resolve(sid("child-1"));
      await first;
      expect((await one.journal.read())?.kind).toBe("adopted");
    } finally {
      held.resolve(sid("child-1"));
      await first;
    }
  });
  it("fails closed on claim, outcome and reset storage errors", async () => {
    for (const stage of ["claim", "outcome", "reset"]) {
      const storage = store();
      let failed = false;
      const f = await fixture({
        transact(host, update) {
          if (failed) throw new Error("disk");
          return storage.storage.transact(host, update);
        },
      });
      if (stage === "claim") failed = true;
      if (stage === "outcome")
        f.sessions.forkTo.mockImplementation(async (request) => {
          failed = true;
          return request.childSessionId;
        });
      await f.fork.fork(sid("source"));
      if (stage === "reset") {
        failed = true;
        await f.fork.reset();
      }
      expect(f.fork.getSnapshot().storage).toBe("failed");
      await f.fork.fork(sid("source"));
      expect(f.sessions.forkTo).toHaveBeenCalledTimes(stage === "claim" ? 0 : 1);
    }
  });
  it("rechecks lineage before adoption and leaves a dispatched mutation owned after view closure", async () => {
    const f = await unknown();
    setChild(f);
    f.sessions.loadSummary.mockResolvedValue({ ok: true, value: true });
    await f.fork.checkCurrent();
    setChild(f, "replacement");
    await f.fork.adoptCurrent();
    expect(f.fork.getSnapshot().outcome.kind).toBe("unknown");
    const live = await fixture();
    const held = deferred<SessionId>();
    live.sessions.forkTo.mockReturnValue(held.promise);
    const task = live.fork.fork(sid("source"));
    await vi.waitFor(() => expect(live.sessions.forkTo).toHaveBeenCalledOnce());
    live.close();
    held.resolve(sid("child-1"));
    await task;
    expect((await live.journal.read())?.kind).toBe("confirmed");
  });
});
