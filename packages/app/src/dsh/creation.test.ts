import { describe, expect, it, vi } from "vitest";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { brandString } from "@deepseek-ai/dsh-brand";
import {
  SessionCreateError,
  selectRemoteCapabilities,
  type ConnectionHandle,
  type ConnectionHostId,
  type HostCapabilities,
  type ISessions,
  type IWorkspaces,
  type SessionId,
} from "@deepseek-ai/dsh-client";
import { dshCreationEndpoints } from "@getpaseo/protocol/dsh-access";
import { DshCreation, type DshCreationSelection } from "./creation";
const id = brandString<SessionId>("candidate");
const workspaceId = brandString<NonNullable<DshCreationSelection["workspaceId"]>>("workspace");
const identity = {
  version: 1 as const,
  hostId: brandString<ConnectionHostId>("d8d58893-7978-42cb-a6db-a3b275b7b46b"),
  activationId: brandString<HostCapabilities["identity"]["activationId"]>(
    "d3d17c83-0ca7-4f45-8f5e-68b8aa0cf23c",
  ),
};
function cell<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
    listeners,
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
const profile = {
  id: "minimal",
  trust: "system" as const,
  isDefault: true,
  name: "Minimal",
  description: "Small profile",
};
function fixture() {
  const generation = cell<ReturnType<ConnectionHandle["generation"]["getSnapshot"]>>({
    id: 1,
    host: { home: "/fixture", identity },
  });
  const list = cell<ReturnType<ISessions["list"]["getSnapshot"]>>({
    ids: [],
    byId: {},
    current: undefined,
    phase: "ready",
    state: "idle",
    error: null,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  });
  const workspaces = {
    list: cell<ReturnType<IWorkspaces["list"]["getSnapshot"]>>({
      items: [
        {
          workspaceId,
          title: "Workspace",
          path: "/host/project",
          sessionIds: [],
          createdAt: "2026-09-21T00:00:00Z",
          updatedAt: "2026-09-21T00:00:00Z",
        },
      ],
      phase: "ready",
      state: "idle",
      error: null,
      archivedSessionIds: [],
    }),
  };
  const sessions = {
    list,
    create: vi.fn<ISessions["create"]>(async () => id),
    refresh: vi.fn<ISessions["refresh"]>(async () => {}),
  };
  const readRoster = vi.fn<ConstructorParameters<typeof DshCreation>[4]>(async () => ({
    ok: true,
    value: {
      presets: [profile, { ...profile, id: "broken", broken: "unavailable" }],
      authorable: false,
    },
  }));
  let capabilities: HostCapabilities = {
    version: 3,
    identity,
    capabilities: selectRemoteCapabilities(dshCreationEndpoints).map(
      ({ endpoint, mode, wireFingerprint, semanticRevision }) => ({
        endpoint,
        mode,
        wireFingerprint,
        semanticRevision,
        availability: "available" as const,
      }),
    ),
  };
  const createId = vi.fn(() => id);
  const creation = new DshCreation(
    sessions,
    workspaces,
    { generation },
    () => capabilities,
    readRoster,
    createId,
  );
  return {
    creation,
    sessions,
    workspaces,
    generation,
    readRoster,
    createId,
    capability(change: (value: HostCapabilities) => HostCapabilities) {
      capabilities = change(capabilities);
      generation.set({
        id: (generation.getSnapshot()?.id ?? 0) + 1,
        host: { home: "/fixture", identity },
      });
    },
    publish(publishedId = id) {
      list.set({
        ...list.getSnapshot(),
        ids: [publishedId],
        byId: {
          [publishedId]: {
            id: publishedId,
            displayTitle: "same title",
            cwd: "/host/project",
            running: false,
            blank: true,
            updatedAt: 1,
          },
        },
      });
    },
    attach() {
      const snapshot = workspaces.list.getSnapshot();
      workspaces.list.set({
        ...snapshot,
        items: snapshot.items.map(
          ({ workspaceId: ownerId, path, title, createdAt, updatedAt }) => ({
            workspaceId: ownerId,
            path,
            title,
            createdAt,
            updatedAt,
            sessionIds: [id],
          }),
        ),
      });
    },
  };
}

function changedCapabilities(
  base: HostCapabilities,
  kind: "missing" | "unavailable" | "mode" | "wire" | "semantic",
): HostCapabilities {
  return {
    ...base,
    capabilities: base.capabilities.flatMap((value) => {
      if (value.endpoint !== "session/create") return [value];
      if (kind === "missing") return [];
      if (kind === "unavailable")
        return [
          {
            ...value,
            availability: "unavailable" as const,
            reason: "service",
          },
        ];
      return [
        {
          ...value,
          ...(kind === "mode" ? { mode: "stream" as const } : {}),
          ...(kind === "wire" ? { wireFingerprint: "other" } : {}),
          ...(kind === "semantic" ? { semanticRevision: (value.semanticRevision ?? 0) + 1 } : {}),
        },
      ];
    }),
  };
}

describe("native creation ownership", () => {
  it.each(["missing", "unavailable", "mode", "wire", "semantic"] as const)(
    "gates only the incompatible optional operation: %s",
    async (kind) => {
      const f = fixture();
      try {
        f.capability((base) => changedCapabilities(base, kind));
        expect(f.creation.getSnapshot()).toMatchObject({
          availability: "unavailable",
          catalog: "available",
        });
        await f.creation.create({});
        expect(f.sessions.create).not.toHaveBeenCalled();
        await f.creation.refreshProfiles();
        expect(f.creation.getSnapshot().profiles).toEqual([profile]);
      } finally {
        await f.creation.dispose();
      }
    },
  );
  it("reads the actual healthy roster explicitly and forwards one identity/profile/workspace on duplicate gestures", async () => {
    const f = fixture();
    const result = deferred<SessionId>();
    f.sessions.create.mockReturnValue(result.promise);
    try {
      expect(f.readRoster).not.toHaveBeenCalled();
      await f.creation.refreshProfiles();
      const request = { workspaceId, agentPreset: "minimal" };
      const first = f.creation.create(request);
      const duplicate = f.creation.create({ cwd: "/other" });
      expect(duplicate).toBe(first);
      await Promise.resolve();
      expect(f.sessions.create).toHaveBeenCalledExactlyOnceWith({
        ...request,
        sessionId: id,
      });
      result.resolve(id);
      await first;
      expect(f.creation.getSnapshot().outcome).toMatchObject({
        kind: "accepted",
        request: { ...request, sessionId: id },
      });
      await f.creation.create({});
      expect(f.sessions.create).toHaveBeenCalledTimes(1);
      f.creation.reset();
      await f.creation.create({});
      expect(f.sessions.create).toHaveBeenLastCalledWith({ sessionId: id });
    } finally {
      result.resolve(id);
      await f.creation.dispose();
    }
  });
  it("rejects stale/removed selections without defaulting or dispatching", async () => {
    const f = fixture();
    try {
      await f.creation.create({ agentPreset: "minimal" });
      expect(f.creation.getSnapshot().selectionError).toBe("profile-unavailable");
      await f.creation.refreshProfiles();
      await f.creation.create({ agentPreset: "broken" });
      expect(f.creation.getSnapshot().selectionError).toBe("profile-unavailable");
      await f.creation.create({ workspaceId, cwd: "/host" });
      expect(f.creation.getSnapshot().selectionError).toBe("ambiguous-target");
      f.workspaces.list.set({ ...f.workspaces.list.getSnapshot(), items: [] });
      await f.creation.create({ workspaceId });
      expect(f.creation.getSnapshot().selectionError).toBe("workspace-unavailable");
      expect(f.sessions.create).not.toHaveBeenCalled();
      expect(f.createId).not.toHaveBeenCalled();
    } finally {
      await f.creation.dispose();
    }
  });
  it("keeps roster failures explicit and coalesces explicit retries", async () => {
    const f = fixture();
    const read = deferred<Awaited<ReturnType<typeof f.readRoster>>>();
    f.readRoster.mockRejectedValueOnce(new Error("carrier"));
    try {
      await f.creation.refreshProfiles();
      expect(f.creation.getSnapshot().roster).toBe("failed");
      f.readRoster.mockReturnValueOnce(read.promise);
      const one = f.creation.refreshProfiles();
      expect(f.creation.refreshProfiles()).toBe(one);
      read.resolve({
        ok: false,
        error: new RemoteError("gateway/internal", "failed", {}),
      });
      await one;
      expect(f.creation.getSnapshot()).toMatchObject({
        roster: "failed",
        profiles: [],
      });
      await f.creation.refreshProfiles();
      expect(f.creation.getSnapshot().roster).toBe("ready");
    } finally {
      await f.creation.dispose();
    }
  });
  it("discards old-generation catalog success and joins it while a new read completes", async () => {
    const f = fixture();
    const old = deferred<Awaited<ReturnType<typeof f.readRoster>>>();
    f.readRoster.mockReturnValueOnce(old.promise);
    const first = f.creation.refreshProfiles();
    await Promise.resolve();
    f.generation.set(undefined);
    expect(f.creation.getSnapshot()).toMatchObject({
      catalog: "offline",
      profiles: [],
    });
    f.capability((base) => base);
    expect(f.readRoster).toHaveBeenCalledTimes(1);
    await f.creation.refreshProfiles();
    expect(f.creation.getSnapshot().profiles).toEqual([profile]);
    let disposed = false;
    const closing = f.creation.dispose().then(() => {
      disposed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    old.resolve({ ok: true, value: { presets: [], authorable: false } });
    await first;
    await closing;
    expect(f.creation.getSnapshot().profiles).toEqual([profile]);
    expect(f.generation.listeners.size).toBe(0);
    expect(f.sessions.list.listeners.size).toBe(0);
    expect(f.workspaces.list.listeners.size).toBe(0);
  });
  it("rejects offline taps and a generation change before dispatch", async () => {
    const f = fixture();
    try {
      f.generation.set(undefined);
      await f.creation.create({});
      expect(f.sessions.create).not.toHaveBeenCalled();
      f.capability((base) => base);
      const pending = f.creation.create({});
      f.capability((base) => base);
      await pending;
      expect(f.sessions.create).not.toHaveBeenCalled();
      expect(f.creation.getSnapshot().outcome).toMatchObject({
        kind: "rejected",
        code: "client/not-dispatched",
      });
    } finally {
      await f.creation.dispose();
    }
  });
  it("reconciles a lost reply only by the original identity, never title or path", async () => {
    const f = fixture();
    f.sessions.create.mockRejectedValueOnce(new Error("lost reply"));
    try {
      await f.creation.create({ cwd: "/host/project" });
      expect(f.creation.getSnapshot().outcome.kind).toBe("unknown");
      f.publish(brandString<SessionId>("other"));
      await f.creation.reconcile();
      expect(f.creation.getSnapshot().outcome.kind).toBe("unknown");
      f.creation.reset();
      await f.creation.create({});
      expect(f.sessions.create).toHaveBeenCalledTimes(1);
      f.generation.set(undefined);
      f.capability((base) => base);
      expect(f.sessions.create).toHaveBeenCalledTimes(1);
      f.publish();
      expect(f.creation.getSnapshot().outcome.kind).toBe("accepted");
      f.sessions.list.set({
        ...f.sessions.list.getSnapshot(),
        ids: [],
        byId: {},
      });
      expect(f.creation.getSnapshot().outcome.kind).toBe("accepted");
    } finally {
      await f.creation.dispose();
    }
  });
  it("accepts an authoritative stream that preceded a lost reply", async () => {
    const f = fixture();
    const reply = deferred<SessionId>();
    f.sessions.create.mockReturnValueOnce(reply.promise);
    try {
      const call = f.creation.create({});
      await Promise.resolve();
      f.publish();
      expect(f.creation.getSnapshot().outcome.kind).toBe("sending");
      reply.reject(new Error("lost"));
      await call;
      expect(f.creation.getSnapshot().outcome.kind).toBe("accepted");
    } finally {
      await f.creation.dispose();
    }
  });
  it("does not turn missing Workspace membership into successful creation or retry", async () => {
    const f = fixture();
    f.sessions.create.mockRejectedValueOnce(new Error("lost"));
    try {
      await f.creation.create({ workspaceId });
      f.publish();
      expect(f.creation.getSnapshot().outcome).toMatchObject({
        kind: "unknown",
        published: true,
      });
      f.creation.reset();
      await f.creation.create({ workspaceId });
      expect(f.sessions.create).toHaveBeenCalledTimes(1);
      f.attach();
      expect(f.creation.getSnapshot().outcome.kind).toBe("accepted");
    } finally {
      await f.creation.dispose();
    }
  });
  it("retains explicit attachment failure until authoritative membership arrives", async () => {
    const f = fixture();
    f.sessions.create.mockRejectedValueOnce(
      new SessionCreateError(
        new RemoteError("session/workspace-attach-failed", "failed", {
          sessionId: id,
          workspaceId,
        }),
        id,
      ),
    );
    try {
      await f.creation.create({ workspaceId });
      f.publish();
      expect(f.creation.getSnapshot().outcome.kind).toBe("attachment-failed");
      f.creation.reset();
      await f.creation.create({});
      expect(f.sessions.create).toHaveBeenCalledTimes(1);
      f.attach();
      expect(f.creation.getSnapshot().outcome.kind).toBe("accepted");
    } finally {
      await f.creation.dispose();
    }
  });
  it("reports definite profile refusal without default retry", async () => {
    const f = fixture();
    f.sessions.create.mockRejectedValueOnce(
      new SessionCreateError(
        new RemoteError("agent-preset/not-found", "removed", {
          agentPreset: "minimal",
          available: [],
        }),
        id,
      ),
    );
    try {
      await f.creation.refreshProfiles();
      await f.creation.create({ agentPreset: "minimal" });
      expect(f.creation.getSnapshot().outcome).toMatchObject({
        kind: "rejected",
        code: "agent-preset/not-found",
      });
      expect(f.sessions.create).toHaveBeenCalledTimes(1);
    } finally {
      await f.creation.dispose();
    }
  });
  it("does not publish a late success after disposal, and joins its carrier", async () => {
    const f = fixture();
    const reply = deferred<SessionId>();
    f.sessions.create.mockReturnValueOnce(reply.promise);
    const pending = f.creation.create({});
    await Promise.resolve();
    const listener = vi.fn();
    f.creation.subscribe(listener);
    let joined = false;
    const close = f.creation.dispose().then(() => {
      joined = true;
      return undefined;
    });
    await Promise.resolve();
    expect(joined).toBe(false);
    reply.resolve(id);
    await pending;
    await close;
    expect(listener).not.toHaveBeenCalled();
    expect(f.creation.getSnapshot().outcome.kind).toBe("sending");
  });
  it("never dispatches work queued just before disposal", async () => {
    const f = fixture();
    const read = f.creation.refreshProfiles();
    const create = f.creation.create({});
    const close = f.creation.dispose();
    await Promise.all([read, create, close]);
    expect(f.sessions.create).not.toHaveBeenCalled();
    expect(f.readRoster).not.toHaveBeenCalled();
  });
  it("coalesces a roster refresh requested synchronously by a loading observer", async () => {
    const f = fixture();
    let notifications = 0;
    const nested: Promise<void>[] = [];
    const off = f.creation.subscribe(() => {
      if (f.creation.getSnapshot().roster === "loading" && ++notifications < 3)
        nested.push(f.creation.refreshProfiles());
    });
    try {
      await f.creation.refreshProfiles();
      await Promise.all(nested);
      expect(f.readRoster).toHaveBeenCalledOnce();
    } finally {
      off();
      await f.creation.dispose();
    }
  });
});
