import { describe, expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import {
  selectRemoteCapabilities,
  type ConnectionHandle,
  type ConnectionHostId,
  type HostCapabilities,
  type RemoteResult,
  type WorkspaceId,
} from "@deepseek-ai/dsh-client";
import {
  DshWorkspace,
  type DshWorkItem,
  type DshWorkList,
  type DshWorkspaceFiles,
} from "./workspace-data";

type Remote = ConstructorParameters<typeof DshWorkspace>[0];
type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
const workspaceA = brandString<WorkspaceId>("workspace-a");
const workspaceB = brandString<WorkspaceId>("workspace-b");
const item: DshWorkItem = {
  basis: "tracking",
  id: brandString<DshWorkItem["id"]>("work-a"),
  project: brandString<DshWorkItem["project"]>("project-a"),
  revision: 1,
  title: "Publish guide",
  brief: "Explain the first workspace setup.",
  briefRevision: 1,
  status: "open",
  sessions: [],
  contributors: [],
  executionLinks: [],
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
};
const page: DshWorkList = {
  adoptionCandidate: null,
  binding: { workspaceId: workspaceA, projectId: item.project, path: "/project", revision: 1 },
  items: [item],
  nextCursor: null,
  watermark: 1,
};
function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value };
}

function fixture() {
  const identity = {
    version: 1 as const,
    hostId: brandString<ConnectionHostId>("d8d58893-7978-42cb-a6db-a3b275b7b46b"),
    activationId: brandString<HostCapabilities["identity"]["activationId"]>(
      "d3d17c83-0ca7-4f45-8f5e-68b8aa0cf23c",
    ),
  };
  let generation: Generation = { id: 1, host: { home: "/test", identity } };
  const listeners = new Set<() => void>();
  const connection = {
    generation: {
      getSnapshot: () => generation,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
  let capabilities: HostCapabilities = {
    version: 3,
    identity,
    capabilities: selectRemoteCapabilities([
      "workspaceWork/initialize",
      "workspaceWork/list",
      "workspaceWork/get",
      "workspaceWork/create",
      "workspaceWork/update",
      "workspaceWork/setStatus",
      "workspaceWork/attachSession",
      "workspaceContent/listFiles",
      "workspaceContent/readFile",
      "workspaceMemory/list",
      "workspaceMemory/review",
      "workspaceMemory/correct",
    ]).map((entry) => ({
      endpoint: entry.endpoint,
      mode: entry.mode,
      wireFingerprint: entry.wireFingerprint,
      semanticRevision: entry.semanticRevision,
      availability: "available",
    })),
  };
  const remote = {
    workspaceWork: {
      initialize: vi
        .fn<Remote["workspaceWork"]["initialize"]>()
        .mockResolvedValue(ok(page.binding!)),
      list: vi.fn<Remote["workspaceWork"]["list"]>().mockResolvedValue(ok(page)),
      get: vi.fn<Remote["workspaceWork"]["get"]>().mockResolvedValue(ok(item)),
      create: vi.fn<Remote["workspaceWork"]["create"]>().mockResolvedValue(ok(item)),
      update: vi.fn<Remote["workspaceWork"]["update"]>().mockResolvedValue(ok(item)),
      setStatus: vi.fn<Remote["workspaceWork"]["setStatus"]>().mockResolvedValue(ok(item)),
      attachSession: vi.fn<Remote["workspaceWork"]["attachSession"]>().mockResolvedValue(ok(item)),
    },
    workspaceContent: {
      listFiles: vi
        .fn<Remote["workspaceContent"]["listFiles"]>()
        .mockResolvedValue(
          ok({ path: ".", entries: [{ name: "guide.md", type: "file" }], truncated: false }),
        ),
      readFile: vi
        .fn<Remote["workspaceContent"]["readFile"]>()
        .mockResolvedValue(
          ok({ path: "guide.md", text: "# Guide", bytes: 7, version: "v1", truncated: false }),
        ),
    },
    workspaceMemory: {
      list: vi
        .fn<Remote["workspaceMemory"]["list"]>()
        .mockResolvedValue(ok({ memories: [], truncated: false })),
      review: vi.fn<Remote["workspaceMemory"]["review"]>(),
      correct: vi.fn<Remote["workspaceMemory"]["correct"]>(),
    },
  } satisfies Remote;
  let sequence = 0;
  const source = new DshWorkspace(
    remote,
    connection,
    () => capabilities,
    () => `generated-${++sequence}`,
  );
  return {
    source,
    remote,
    listeners,
    disconnect() {
      generation = undefined;
      for (const listener of listeners) listener();
    },
    setCapabilities(next: HostCapabilities["capabilities"]) {
      capabilities = { ...capabilities, capabilities: next };
    },
  };
}

describe("Workspace data ownership", () => {
  it("does not dispatch a queued mutation after the client owner closes", async () => {
    const f = fixture();
    await f.source.selectWorkspace(workspaceA);
    const creating = f.source.createWork({
      title: "Ship",
      brief: "Publish guide",
      workspaceTitle: "Project",
    });
    const closing = f.source.dispose();
    expect(await creating).toBeNull();
    await closing;
    expect(f.remote.workspaceWork.create).not.toHaveBeenCalled();
  });

  it("does not mutate or open executions while reading explicit workspace work, files and memory", async () => {
    const f = fixture();
    try {
      expect(f.remote.workspaceWork.list).not.toHaveBeenCalled();
      await f.source.selectWorkspace(workspaceA);
      expect(f.source.getSnapshot().work).toEqual({ status: "ready", value: page });
      expect(f.remote.workspaceWork.initialize).not.toHaveBeenCalled();
      expect(f.remote.workspaceWork.create).not.toHaveBeenCalled();
      expect(f.remote.workspaceContent.listFiles).toHaveBeenCalledWith(
        workspaceA,
        ".",
        expect.any(AbortSignal),
      );
      expect(f.remote.workspaceMemory.list).toHaveBeenCalledWith(
        workspaceA,
        { text: "" },
        expect.any(AbortSignal),
      );
      await f.source.listFiles("docs");
      await f.source.readFile("docs/guide.md");
      expect(f.remote.workspaceContent.readFile).toHaveBeenCalledWith(
        workspaceA,
        "docs/guide.md",
        expect.any(AbortSignal),
      );
      f.source.closeFile();
      expect(f.source.getSnapshot().file.status).toBe("idle");
    } finally {
      await f.source.dispose();
    }
  });

  it("discards late old-workspace reads and joins them during disposal", async () => {
    const f = fixture();
    const old = Promise.withResolvers<RemoteResult<DshWorkspaceFiles>>();
    f.remote.workspaceContent.listFiles.mockReturnValueOnce(old.promise);
    const first = f.source.selectWorkspace(workspaceA);
    await Promise.resolve();
    const oldSignal = f.remote.workspaceContent.listFiles.mock.calls[0]?.[2];
    await f.source.selectWorkspace(workspaceB);
    expect(oldSignal?.aborted).toBe(true);
    expect(f.source.getSnapshot().workspaceId).toBe(workspaceB);
    expect(f.source.getSnapshot().files).toMatchObject({
      status: "ready",
      value: { entries: [{ name: "guide.md" }] },
    });
    let disposed = false;
    const closing = f.source.dispose().then(() => {
      disposed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    old.resolve(ok({ path: "old", entries: [{ name: "old.md", type: "file" }], truncated: false }));
    await first;
    await closing;
    expect(f.source.getSnapshot().files).toMatchObject({
      status: "ready",
      value: { entries: [{ name: "guide.md" }] },
    });
    expect(f.listeners.size).toBe(0);
  });

  it("distinguishes unavailable and offline content without sending a read", async () => {
    const f = fixture();
    try {
      f.setCapabilities([]);
      await f.source.selectWorkspace(workspaceA);
      expect(f.source.getSnapshot()).toMatchObject({
        work: { status: "unavailable" },
        files: { status: "unavailable" },
        memory: { status: "unavailable" },
      });
      expect(f.remote.workspaceWork.list).not.toHaveBeenCalled();
      f.disconnect();
      expect(f.source.getSnapshot().work.status).toBe("offline");
      expect(f.source.getSnapshot().canCreate).toBe(false);
    } finally {
      await f.source.dispose();
    }
  });

  it("retains unknown mutations in their workspace and never resends them on refresh or navigation", async () => {
    const f = fixture();
    try {
      await f.source.selectWorkspace(workspaceA);
      f.remote.workspaceWork.create.mockRejectedValueOnce(new Error("response lost"));
      expect(
        await f.source.createWork({
          title: "Ship",
          brief: "Publish documentation",
          workspaceTitle: "Project",
        }),
      ).toBeNull();
      expect(f.source.getSnapshot().mutation).toMatchObject({
        status: "unknown",
        action: "create",
        workspaceId: workspaceA,
        targetId: "generated-2",
      });
      await f.source.refresh();
      await f.source.createWork({
        title: "Ship",
        brief: "Publish documentation",
        workspaceTitle: "Project",
      });
      await f.source.selectWorkspace(workspaceB);
      expect(f.source.getSnapshot().mutation.status).toBe("idle");
      await f.source.selectWorkspace(workspaceA);
      expect(f.source.getSnapshot().mutation.status).toBe("unknown");
      expect(f.remote.workspaceWork.create).toHaveBeenCalledTimes(1);
      f.source.clearMutation();
      await f.source.createWork({
        title: "Another",
        brief: "Deliberately create another item",
        workspaceTitle: "Project",
      });
      expect(f.remote.workspaceWork.create).toHaveBeenCalledTimes(2);
    } finally {
      await f.source.dispose();
    }
  });

  it("connects discovered work only by explicit action using its exact identity", async () => {
    const f = fixture();
    try {
      f.remote.workspaceWork.list.mockResolvedValueOnce(
        ok({
          binding: null,
          adoptionCandidate: { id: item.project, title: "Existing launch work" },
          items: [],
          nextCursor: null,
          watermark: 0,
        }),
      );
      await f.source.selectWorkspace(workspaceA);
      expect(f.source.getSnapshot().files.status).toBe("ready");
      expect(f.source.getSnapshot().memory.status).toBe("ready");
      expect(
        await f.source.createWork({
          title: "New work",
          brief: "Do not replace existing work",
          workspaceTitle: "Project",
        }),
      ).toBeNull();
      expect(f.remote.workspaceWork.initialize).not.toHaveBeenCalled();
      expect(f.remote.workspaceWork.create).not.toHaveBeenCalled();
      await f.source.connectExistingWork();
      expect(f.remote.workspaceWork.initialize).toHaveBeenCalledExactlyOnceWith({
        workspaceId: workspaceA,
        requestId: "generated-1",
        projectId: item.project,
        title: "Existing launch work",
      });
      expect(f.remote.workspaceWork.create).not.toHaveBeenCalled();
      expect(f.source.getSnapshot().work).toEqual({ status: "ready", value: page });
      await f.source.connectExistingWork();
      expect(f.remote.workspaceWork.initialize).toHaveBeenCalledTimes(1);
      expect(
        await f.source.createWork({ title: "Next", brief: "Continue", workspaceTitle: "Project" }),
      ).toEqual(item);
    } finally {
      await f.source.dispose();
    }
  });

  it("keeps unconfirmed existing-work connection visible without retrying or creating another project", async () => {
    const f = fixture();
    try {
      f.remote.workspaceWork.list.mockResolvedValue(
        ok({
          binding: null,
          adoptionCandidate: { id: item.project, title: "Existing work" },
          items: [],
          nextCursor: null,
          watermark: 0,
        }),
      );
      f.remote.workspaceWork.initialize.mockRejectedValueOnce(new Error("response lost"));
      await f.source.selectWorkspace(workspaceA);
      await f.source.connectExistingWork();
      await f.source.refresh();
      await f.source.connectExistingWork();
      await f.source.createWork({ title: "Next", brief: "Continue", workspaceTitle: "Project" });
      expect(f.remote.workspaceWork.initialize).toHaveBeenCalledTimes(1);
      expect(f.remote.workspaceWork.create).not.toHaveBeenCalled();
      expect(f.source.getSnapshot().mutation).toMatchObject({
        status: "unknown",
        action: "initialize",
        targetId: item.project,
      });
    } finally {
      await f.source.dispose();
    }
  });

  it("initializes an unbound workspace only on explicit create and stops if initialization is unconfirmed", async () => {
    const f = fixture();
    try {
      const unbound = {
        binding: null,
        adoptionCandidate: null,
        items: [],
        nextCursor: null,
        watermark: 0,
      };
      f.remote.workspaceWork.list.mockResolvedValueOnce(ok(unbound));
      await f.source.selectWorkspace(workspaceA);
      expect(f.remote.workspaceWork.initialize).not.toHaveBeenCalled();
      f.remote.workspaceWork.initialize.mockRejectedValueOnce(new Error("response lost"));
      await f.source.createWork({
        title: "Ship",
        brief: "Publish guide",
        workspaceTitle: "Project",
      });
      expect(f.remote.workspaceWork.initialize).toHaveBeenCalledWith({
        workspaceId: workspaceA,
        requestId: "generated-1",
        projectId: "generated-2",
        title: "Project",
      });
      expect(f.remote.workspaceWork.create).not.toHaveBeenCalled();
      expect(f.source.getSnapshot().mutation).toMatchObject({
        status: "unknown",
        action: "initialize",
      });
    } finally {
      await f.source.dispose();
    }
  });

  it("creates work after a confirmed project initialization and authoritative binding readback", async () => {
    const f = fixture();
    try {
      f.remote.workspaceWork.list.mockResolvedValueOnce(
        ok({ binding: null, adoptionCandidate: null, items: [], nextCursor: null, watermark: 0 }),
      );
      await f.source.selectWorkspace(workspaceA);
      expect(
        await f.source.createWork({
          title: "Ship",
          brief: "Publish guide",
          workspaceTitle: "Project",
        }),
      ).toEqual(item);
      expect(f.remote.workspaceWork.initialize).toHaveBeenCalledTimes(1);
      expect(f.remote.workspaceWork.create).toHaveBeenCalledWith({
        workspaceId: workspaceA,
        requestId: "generated-3",
        id: "generated-4",
        title: "Ship",
        brief: "Publish guide",
      });
      expect(f.source.getSnapshot().mutation.status).toBe("accepted");
    } finally {
      await f.source.dispose();
    }
  });

  it("sends exact observed revisions and distinguishes a typed refusal from uncertain failure", async () => {
    const f = fixture();
    try {
      await f.source.selectWorkspace(workspaceA);
      f.remote.workspaceWork.update.mockResolvedValueOnce({
        ok: false,
        error: new RemoteError("workspace-work/rejected", "stale", { reason: "conflict" }),
      });
      await f.source.updateWork({
        id: item.id,
        expectedRevision: 7,
        title: "Changed",
        brief: "New brief",
      });
      expect(f.remote.workspaceWork.update).toHaveBeenCalledWith({
        workspaceId: workspaceA,
        requestId: "generated-1",
        id: item.id,
        expectedRevision: 7,
        title: "Changed",
        brief: "New brief",
      });
      expect(f.source.getSnapshot().mutation.status).toBe("rejected");
      f.remote.workspaceWork.setStatus.mockResolvedValueOnce({
        ok: false,
        error: new RemoteError("workspace-work/unknown", "uncertain", { requestId: "generated-2" }),
      });
      await f.source.setWorkStatus({ id: item.id, expectedRevision: 7, status: "completed" });
      expect(f.source.getSnapshot().mutation.status).toBe("unknown");
    } finally {
      await f.source.dispose();
    }
  });

  it("retains old-workspace mutation receipts without navigating a replacement workspace", async () => {
    const f = fixture();
    const gate = Promise.withResolvers<RemoteResult<DshWorkItem>>();
    try {
      await f.source.selectWorkspace(workspaceA);
      f.remote.workspaceWork.create.mockReturnValueOnce(gate.promise);
      const creating = f.source.createWork({
        title: "Ship",
        brief: "Publish guide",
        workspaceTitle: "Project",
      });
      await Promise.resolve();
      await f.source.selectWorkspace(workspaceB);
      gate.resolve(ok(item));
      expect(await creating).toBeNull();
      expect(f.source.getSnapshot()).toMatchObject({
        workspaceId: workspaceB,
        mutation: { status: "idle" },
      });
      await f.source.selectWorkspace(workspaceA);
      expect(f.source.getSnapshot().mutation.status).toBe("accepted");
    } finally {
      gate.resolve(ok(item));
      await f.source.dispose();
    }
  });

  it("preserves prior pages if loading more fails and reads linked work outside the first page", async () => {
    const f = fixture();
    try {
      f.remote.workspaceWork.list.mockResolvedValueOnce(ok({ ...page, nextCursor: "work-a" }));
      await f.source.selectWorkspace(workspaceA);
      f.remote.workspaceWork.list.mockRejectedValueOnce(new Error("read failed"));
      await f.source.loadMoreWork();
      expect(f.source.getSnapshot()).toMatchObject({
        work: { status: "ready", value: { items: [item] } },
        loadMoreFailed: true,
        loadingMore: false,
      });
      await f.source.selectWork(item.id);
      expect(f.remote.workspaceWork.get).toHaveBeenCalledWith({
        workspaceId: workspaceA,
        id: item.id,
      });
    } finally {
      await f.source.dispose();
    }
  });
});
