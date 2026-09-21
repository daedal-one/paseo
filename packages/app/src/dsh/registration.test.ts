import { afterEach, describe, expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import {
  WorkspaceCreateError,
  selectRemoteCapabilities,
  type ConnectionHandle,
  type ConnectionHostId,
  type HostCapabilities,
  type IWorkspaces,
  type WorkspaceId,
  type WorkspaceView,
} from "@deepseek-ai/dsh-client";
import { dshRegistrationEndpoints } from "@getpaseo/protocol/dsh-access";
import { DshRegistration } from "./registration";
import { DshRegistrationJournal, type RegistrationAttemptId } from "./registration-journal";
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
const identity = {
  version: 1 as const,
  hostId: brandString<ConnectionHostId>("host-a"),
  activationId: brandString<HostCapabilities["identity"]["activationId"]>("activation-a"),
};
const workspace: WorkspaceView = {
  workspaceId: brandString<WorkspaceId>("workspace-a"),
  path: "/canonical/project",
  title: "Project",
  sessionIds: [],
  createdAt: "2026-09-21",
  updatedAt: "2026-09-21",
};
const owners: DshRegistration[] = [];
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.dispose()));
});
async function fixture(storage: DshCreationStorage | null = store().storage) {
  let id = 0;
  const generation = cell<ReturnType<ConnectionHandle["generation"]["getSnapshot"]>>({
    id: 1,
    host: { home: "/fixture", identity },
  });
  let capabilities: HostCapabilities = {
    version: 3,
    identity,
    capabilities: selectRemoteCapabilities(dshRegistrationEndpoints).map(
      ({ endpoint, mode, wireFingerprint, semanticRevision }) => ({
        endpoint,
        mode,
        wireFingerprint,
        semanticRevision,
        availability: "available" as const,
      }),
    ),
  };
  const workspaces = {
    create: vi.fn<IWorkspaces["create"]>(async () => workspace),
    resolveByPath: vi.fn<IWorkspaces["resolveByPath"]>(async () => workspace),
  };
  const journal =
    storage === null ? undefined : new DshRegistrationJournal(identity.hostId, storage);
  const registration = new DshRegistration(
    workspaces,
    { generation },
    () => capabilities,
    () => brandString<RegistrationAttemptId>(`attempt-${++id}`),
    journal,
  );
  owners.push(registration);
  await registration.restore();
  return {
    registration,
    journal: journal!,
    workspaces,
    generation,
    change(fn: (value: HostCapabilities) => HostCapabilities) {
      capabilities = fn(capabilities);
      generation.set({
        id: (generation.getSnapshot()?.id ?? 0) + 1,
        host: { home: "/fixture", identity },
      });
    },
  };
}
async function uncertain(f: Awaited<ReturnType<typeof fixture>>) {
  f.workspaces.create.mockRejectedValueOnce(new Error("lost reply"));
  await f.registration.register("/host/alias");
  expect(f.registration.getSnapshot().outcome.kind).toBe("unknown");
}
describe("native Workspace registration ownership", () => {
  it("commits before dispatch, coalesces reentrant gestures and requires durable explicit reset", async () => {
    const f = await fixture();
    const held = deferred<WorkspaceView>();
    f.workspaces.create.mockImplementation(async (request) => {
      expect((await f.journal.read())?.request.path).toBe(request.path);
      return held.promise;
    });
    const remove = f.registration.subscribe(() => {
      if (f.registration.getSnapshot().outcome.kind === "sending")
        void f.registration.register("/wrong");
    });
    const a = f.registration.register("/host/alias");
    expect(f.registration.register("/wrong")).toBe(a);
    held.resolve(workspace);
    await a;
    remove();
    expect(f.workspaces.create).toHaveBeenCalledExactlyOnceWith({ path: "/host/alias" });
    expect(f.registration.getSnapshot().outcome).toMatchObject({
      kind: "confirmed",
      workspace: { workspaceId: workspace.workspaceId, path: workspace.path },
    });
    await f.registration.register("/second");
    expect(f.workspaces.create).toHaveBeenCalledTimes(1);
    await f.registration.reset();
    expect(await f.journal.read()).toBeNull();
    await f.registration.register("/second");
    expect(f.workspaces.create).toHaveBeenCalledTimes(2);
  });
  it("lets only one competing owner dispatch, restoring its exact request", async () => {
    const shared = store();
    const one = await fixture(shared.storage);
    const two = await fixture(shared.storage);
    one.workspaces.create.mockRejectedValueOnce(new Error("lost"));
    await Promise.all([one.registration.register("/first"), two.registration.register("/second")]);
    expect(one.workspaces.create).toHaveBeenCalledTimes(1);
    expect(two.workspaces.create).not.toHaveBeenCalled();
    expect(two.registration.getSnapshot().outcome).toMatchObject({
      kind: "unknown",
      request: { path: "/first" },
    });
  });
  it("retains broad Host invalid-path failures as unknown and refuses reset or replay", async () => {
    const f = await fixture();
    f.workspaces.create.mockRejectedValueOnce(
      new WorkspaceCreateError(
        new RemoteError("workspace/invalid-path", "storage write failed", { path: "/host/alias" }),
      ),
    );
    await f.registration.register("/host/alias");
    await f.registration.reset();
    await f.registration.register("/host/alias");
    expect(f.registration.getSnapshot().outcome.kind).toBe("unknown");
    expect(f.workspaces.create).toHaveBeenCalledTimes(1);
  });
  it("persists qualified rejection through cold owners and requires reset before a corrected request", async () => {
    const shared = store();
    const one = await fixture(shared.storage);
    one.workspaces.create.mockRejectedValueOnce(
      new WorkspaceCreateError(
        new RemoteError("workspace/create-rejected", "Directory does not exist", {
          path: "/missing",
        }),
      ),
    );
    await one.registration.register("/missing");
    expect(await one.journal.read()).toMatchObject({
      kind: "rejected",
      request: { path: "/missing" },
      message: "Directory does not exist",
    });
    await one.registration.dispose();
    const cold = await fixture(shared.storage);
    cold.generation.set(undefined);
    expect(cold.registration.getSnapshot().outcome.kind).toBe("rejected");
    cold.change((value) => value);
    await cold.registration.checkCurrent();
    await cold.registration.register("/corrected");
    expect(cold.workspaces.resolveByPath).not.toHaveBeenCalled();
    expect(cold.workspaces.create).not.toHaveBeenCalled();
    await cold.registration.reset();
    await cold.registration.register("/corrected");
    expect(cold.workspaces.create).toHaveBeenCalledExactlyOnceWith({ path: "/corrected" });
    expect(cold.registration.getSnapshot().outcome.kind).toBe("confirmed");
  });
  it("does not treat a matching error code outside the shared create error as rejection", async () => {
    const f = await fixture();
    f.workspaces.create.mockRejectedValueOnce(
      new RemoteError("workspace/create-rejected", "unqualified", { path: "/project" }),
    );
    await f.registration.register("/project");
    expect(f.registration.getSnapshot().outcome.kind).toBe("unknown");
    await f.registration.reset();
    expect(f.registration.getSnapshot().outcome.kind).toBe("unknown");
  });
  it.each([false, true])(
    "blocks reset after a rejected outcome write loses acknowledgement (committed: %s)",
    async (committed) => {
      const shared = store();
      let fail = false;
      const f = await fixture({
        async transact(host, update) {
          if (fail && !committed) throw new Error("write failed");
          const value = await shared.storage.transact(host, update);
          if (fail) throw new Error("write ack lost");
          return value;
        },
      });
      f.workspaces.create.mockImplementationOnce(async () => {
        fail = true;
        throw new WorkspaceCreateError(
          new RemoteError("workspace/create-rejected", "Not a directory", { path: "/file" }),
        );
      });
      await f.registration.register("/file");
      expect(f.registration.getSnapshot()).toMatchObject({
        storage: "failed",
        outcome: { kind: "rejected" },
      });
      await f.registration.reset();
      await f.registration.register("/corrected");
      expect(f.workspaces.create).toHaveBeenCalledTimes(1);
      fail = false;
      await f.registration.restore();
      expect(f.registration.getSnapshot().outcome.kind).toBe(committed ? "rejected" : "unknown");
      if (committed) {
        fail = true;
        await f.registration.reset();
        expect(f.registration.getSnapshot().storage).toBe("failed");
        await f.registration.register("/corrected");
        expect(f.workspaces.create).toHaveBeenCalledTimes(1);
        fail = false;
        await f.registration.restore();
        expect(f.registration.getSnapshot().outcome.kind).toBe("idle");
      }
    },
  );
  it("refuses revision-one creation without consuming a journal or disabling lookup", async () => {
    const f = await fixture();
    f.change((value) => {
      const capabilities = [];
      for (const item of value.capabilities)
        capabilities.push(
          item.endpoint === "workspace/create" ? { ...item, semanticRevision: 1 } : item,
        );
      return { ...value, capabilities };
    });
    expect(f.registration.getSnapshot()).toMatchObject({
      availability: "unavailable",
      lookupAvailability: "available",
    });
    await f.registration.register("/project");
    expect(f.workspaces.create).not.toHaveBeenCalled();
    expect(await f.journal.read()).toBeNull();
  });
  it("keeps a positive lookup separate from acceptance until explicit adoption", async () => {
    const f = await fixture();
    await uncertain(f);
    await f.registration.checkCurrent();
    expect(f.registration.getSnapshot()).toMatchObject({
      outcome: { kind: "unknown" },
      lookup: { kind: "found", workspace: { workspaceId: workspace.workspaceId } },
    });
    expect((await f.journal.read())?.kind).toBe("unknown");
    await f.registration.reset();
    expect(f.registration.getSnapshot().outcome.kind).toBe("unknown");
    await f.registration.adoptCurrent();
    expect((await f.journal.read())?.kind).toBe("adopted");
    expect(f.workspaces.create).toHaveBeenCalledTimes(1);
    await f.registration.reset();
    expect(await f.journal.read()).toBeNull();
  });
  it("does not classify absence or a failed lookup as rejection and retries reads explicitly", async () => {
    const f = await fixture();
    await uncertain(f);
    f.workspaces.resolveByPath.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("read"));
    await f.registration.checkCurrent();
    expect(f.registration.getSnapshot().lookup.kind).toBe("absent");
    await f.registration.adoptCurrent();
    await f.registration.checkCurrent();
    expect(f.registration.getSnapshot().lookup.kind).toBe("failed");
    await f.registration.checkCurrent();
    expect(f.registration.getSnapshot().lookup.kind).toBe("found");
    expect(f.registration.getSnapshot().outcome.kind).toBe("unknown");
    expect(f.workspaces.create).toHaveBeenCalledTimes(1);
  });
  it("restores unknown across owners offline, reconnects without lookup, and preserves the path", async () => {
    const shared = store();
    const one = await fixture(shared.storage);
    await uncertain(one);
    await one.registration.dispose();
    const two = await fixture(shared.storage);
    two.generation.set(undefined);
    await two.registration.register("/other");
    await two.registration.checkCurrent();
    two.change((value) => value);
    expect(two.registration.getSnapshot().outcome).toMatchObject({
      kind: "unknown",
      request: { path: "/host/alias" },
    });
    expect(two.workspaces.create).not.toHaveBeenCalled();
    expect(two.workspaces.resolveByPath).not.toHaveBeenCalled();
    await two.registration.checkCurrent();
    expect(two.workspaces.resolveByPath).toHaveBeenCalledTimes(1);
  });
  it("cancels stale reads, frees their slot and joins them on disposal", async () => {
    const f = await fixture();
    await uncertain(f);
    const entered = deferred<void>();
    const held = deferred<WorkspaceView>();
    let signal: AbortSignal | undefined;
    f.workspaces.resolveByPath.mockImplementationOnce(async (_input, value) => {
      signal = value;
      entered.resolve();
      return held.promise;
    });
    const read = f.registration.checkCurrent();
    expect(f.registration.checkCurrent()).toBe(read);
    await entered.promise;
    f.generation.set(undefined);
    expect(signal?.aborted).toBe(true);
    f.change((value) => value);
    f.workspaces.resolveByPath.mockResolvedValueOnce(null);
    await f.registration.checkCurrent();
    expect(f.registration.getSnapshot().lookup.kind).toBe("absent");
    let disposed = false;
    const exit = f.registration.dispose().then(() => {
      disposed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    held.resolve(workspace);
    await read;
    await exit;
    expect(f.registration.getSnapshot().lookup.kind).toBe("absent");
    expect(f.generation.listeners.size).toBe(0);
  });
  it("invalidates a positive observation on generation change before adoption", async () => {
    const f = await fixture();
    await uncertain(f);
    await f.registration.checkCurrent();
    f.change((value) => value);
    await f.registration.adoptCurrent();
    expect(f.registration.getSnapshot()).toMatchObject({
      outcome: { kind: "unknown" },
      lookup: { kind: "idle" },
    });
  });
  it.each(["workspace/create", "workspace/resolveByPath"] as const)(
    "admits %s independently by generated descriptor",
    async (endpoint) => {
      const f = await fixture();
      f.change((value) => {
        const capabilities = [];
        for (const item of value.capabilities)
          capabilities.push(item.endpoint === endpoint ? { ...item, semanticRevision: 999 } : item);
        return { ...value, capabilities };
      });
      expect(f.registration.getSnapshot()).toMatchObject(
        endpoint === "workspace/create"
          ? { availability: "unavailable", lookupAvailability: "available" }
          : { availability: "available", lookupAvailability: "unavailable" },
      );
      if (endpoint === "workspace/create") {
        await f.registration.register("/project");
        expect(f.workspaces.create).not.toHaveBeenCalled();
      } else {
        await uncertain(f);
        await f.registration.checkCurrent();
        expect(f.workspaces.resolveByPath).not.toHaveBeenCalled();
      }
    },
  );
  it("refuses missing storage, empty paths and offline gestures", async () => {
    const absent = await fixture(null);
    await absent.registration.register("/project");
    expect(absent.registration.getSnapshot().storage).toBe("unavailable");
    expect(absent.workspaces.create).not.toHaveBeenCalled();
    const f = await fixture();
    await f.registration.register("  ");
    f.generation.set(undefined);
    await f.registration.register("/project");
    expect(f.workspaces.create).not.toHaveBeenCalled();
  });
  it("fails closed on a possibly committed claim, then restores without sending", async () => {
    const shared = store();
    let fail = false;
    const f = await fixture({
      async transact(host, update) {
        const value = await shared.storage.transact(host, update);
        if (fail) throw new Error("commit ack lost");
        return value;
      },
    });
    fail = true;
    await f.registration.register("/project");
    expect(f.registration.getSnapshot().storage).toBe("failed");
    expect(f.workspaces.create).not.toHaveBeenCalled();
    fail = false;
    await f.registration.restore();
    expect(f.registration.getSnapshot().outcome.kind).toBe("unknown");
    await f.registration.register("/project");
    expect(f.workspaces.create).not.toHaveBeenCalled();
  });
  it("retains pre-dispatch ownership if saving a confirmed reply fails", async () => {
    const shared = store();
    let fail = false;
    const f = await fixture({
      async transact(host, update) {
        if (fail) throw new Error("write failed");
        return shared.storage.transact(host, update);
      },
    });
    f.workspaces.create.mockImplementation(async () => {
      fail = true;
      return workspace;
    });
    await f.registration.register("/project");
    expect(f.registration.getSnapshot()).toMatchObject({
      storage: "failed",
      outcome: { kind: "confirmed" },
    });
    fail = false;
    await f.registration.restore();
    expect(f.registration.getSnapshot().outcome.kind).toBe("unknown");
    expect(f.workspaces.create).toHaveBeenCalledTimes(1);
  });
  it("records not-dispatched if the generation changes while the claim commits", async () => {
    const shared = store();
    const entered = deferred<void>();
    const held = deferred<void>();
    let block = false;
    const f = await fixture({
      async transact(host, update) {
        const value = await shared.storage.transact(host, update);
        if (block) {
          block = false;
          entered.resolve();
          await held.promise;
        }
        return value;
      },
    });
    block = true;
    const call = f.registration.register("/project");
    await entered.promise;
    f.generation.set(undefined);
    held.resolve();
    await call;
    expect((await f.journal.read())?.kind).toBe("not-dispatched");
    expect(f.workspaces.create).not.toHaveBeenCalled();
  });
});
