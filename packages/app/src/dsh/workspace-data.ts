import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import {
  selectRemoteCapabilities,
  type ConnectionHandle,
  type HostCapabilities,
  type RemoteResult,
  type SessionId,
  type WorkspaceId,
} from "@deepseek-ai/dsh-client";
import { createDshAbortController } from "../runtime/dsh-abort-controller";

type Remote = Context["remote"];
type Value<T> = Extract<Awaited<T>, { ok: true }> extends { value: infer V } ? V : never;
export type DshWorkList = Value<ReturnType<Remote["workspaceWork"]["list"]>>;
export type DshWorkItem = DshWorkList["items"][number];
export type DshWorkId = DshWorkItem["id"];
export type DshWorkspaceFiles = Value<ReturnType<Remote["workspaceContent"]["listFiles"]>>;
export type DshWorkspaceFile = Value<ReturnType<Remote["workspaceContent"]["readFile"]>>;
export type DshWorkspaceMemory = Value<ReturnType<Remote["workspaceMemory"]["list"]>>;
export type DshMemoryRecord = DshWorkspaceMemory["memories"][number];
export type DshMemoryQuery = Parameters<Remote["workspaceMemory"]["list"]>[1];
export type DshMemoryReview = Parameters<Remote["workspaceMemory"]["review"]>[1];
export type DshMemoryCorrection = Parameters<Remote["workspaceMemory"]["correct"]>[1];

export type WorkspaceReading<T> =
  | { status: "select-workspace" | "idle" | "loading" | "offline" | "unavailable" | "failed" }
  | { status: "ready"; value: T };
export type WorkspaceMutation =
  | { status: "idle" }
  | {
      status: "sending" | "accepted" | "rejected" | "unknown";
      workspaceId: WorkspaceId;
      action: "initialize" | "create" | "update" | "status" | "attach" | "review" | "correct";
      targetId: string | null;
    };
export interface DshWorkspaceSnapshot {
  workspaceId: WorkspaceId | null;
  work: WorkspaceReading<DshWorkList>;
  detail: WorkspaceReading<DshWorkItem>;
  files: WorkspaceReading<DshWorkspaceFiles>;
  file: WorkspaceReading<DshWorkspaceFile>;
  memory: WorkspaceReading<DshWorkspaceMemory>;
  memoryQuery: DshMemoryQuery;
  mutation: WorkspaceMutation;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  canInitialize: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canSetStatus: boolean;
  canAttachSession: boolean;
  canReviewMemory: boolean;
  canCorrectMemory: boolean;
}
export interface DshWorkEdit {
  id: DshWorkId;
  expectedRevision: number;
  title: string;
  brief: string;
}
export interface DshWorkDraft {
  title: string;
  brief: string;
  workspaceTitle: string;
}
export interface DshWorkStatusEdit {
  id: DshWorkId;
  expectedRevision: number;
  status: "open" | "completed" | "cancelled";
}
export interface DshWorkSessionLink {
  id: DshWorkId;
  expectedRevision: number;
  sessionId: SessionId;
}

type Endpoint = Parameters<typeof selectRemoteCapabilities>[0][number];
type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
type ReadKey = "work" | "detail" | "files" | "file" | "memory" | "more";
type MutationAction = Exclude<WorkspaceMutation, { status: "idle" }>["action"];
type WorkspaceRemote = Pick<Remote, "workspaceWork" | "workspaceContent" | "workspaceMemory">;
interface MutationOptions<T> {
  endpoint: Endpoint;
  action: MutationAction;
  targetId: string | null;
  send(workspaceId: WorkspaceId): Promise<RemoteResult<T>>;
}
const emptyRead = { status: "select-workspace" } as const;

/** Host-owned Work and content, scoped to one explicit Workspace selection. */
export class DshWorkspace {
  private snapshot: DshWorkspaceSnapshot = {
    workspaceId: null,
    work: emptyRead,
    detail: emptyRead,
    files: emptyRead,
    file: emptyRead,
    memory: emptyRead,
    memoryQuery: { text: "" },
    mutation: { status: "idle" },
    loadingMore: false,
    loadMoreFailed: false,
    canInitialize: false,
    canCreate: false,
    canUpdate: false,
    canSetStatus: false,
    canAttachSession: false,
    canReviewMemory: false,
    canCorrectMemory: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly reads = new Map<ReadKey, AbortController>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly unsubscribe: () => void;
  private generation: Generation;
  private scope = {};
  private selectedWork: DshWorkId | null = null;
  private directoryPath = ".";
  private filePath: string | null = null;
  private memoryQuery: DshMemoryQuery = { text: "" };
  private mutationController: AbortController | null = null;
  private readonly outcomes = new Map<WorkspaceId, WorkspaceMutation>();
  private closed = false;

  constructor(
    private readonly remote: WorkspaceRemote,
    private readonly connection: Pick<ConnectionHandle, "generation">,
    private readonly capabilities: () => HostCapabilities | undefined,
    private readonly randomId: () => string,
  ) {
    this.generation = connection.generation.getSnapshot();
    this.unsubscribe = connection.generation.subscribe(this.sync);
    this.publishCapabilities();
  }

  getSnapshot = (): DshWorkspaceSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<DshWorkspaceSnapshot>): void {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
  private own<T>(task: Promise<T>): Promise<T> {
    this.tasks.add(task);
    void task.then(
      () => this.tasks.delete(task),
      () => this.tasks.delete(task),
    );
    return task;
  }
  private available(endpoint: Endpoint): boolean {
    if (this.connection.generation.getSnapshot() === undefined) return false;
    const expected = selectRemoteCapabilities([endpoint])[0];
    const actual = this.capabilities()?.capabilities.find((entry) => entry.endpoint === endpoint);
    return (
      actual !== undefined &&
      actual.availability !== "unavailable" &&
      actual.mode === expected.mode &&
      actual.wireFingerprint === expected.wireFingerprint &&
      actual.semanticRevision === expected.semanticRevision
    );
  }
  private publishCapabilities(): void {
    const idle = this.mutationController === null;
    this.publish({
      canInitialize: idle && this.available("workspaceWork/initialize"),
      canCreate: idle && this.available("workspaceWork/create"),
      canUpdate: idle && this.available("workspaceWork/update"),
      canSetStatus: idle && this.available("workspaceWork/setStatus"),
      canAttachSession: idle && this.available("workspaceWork/attachSession"),
      canReviewMemory: idle && this.available("workspaceMemory/review"),
      canCorrectMemory: idle && this.available("workspaceMemory/correct"),
    });
  }
  private cancelReads(): void {
    this.scope = {};
    for (const controller of this.reads.values()) controller.abort();
    this.reads.clear();
  }
  private sync = (): void => {
    const generation = this.connection.generation.getSnapshot();
    if (this.closed || generation === this.generation) return;
    this.generation = generation;
    this.cancelReads();
    this.publishCapabilities();
    void this.refresh();
  };

  selectWorkspace = (workspaceId: WorkspaceId | null): Promise<void> => {
    if (this.closed || this.snapshot.workspaceId === workspaceId) return Promise.resolve();
    this.cancelReads();
    this.selectedWork = null;
    this.directoryPath = ".";
    this.filePath = null;
    this.memoryQuery = { text: "" };
    this.publish({
      workspaceId,
      work: emptyRead,
      detail: emptyRead,
      files: emptyRead,
      file: workspaceId === null ? emptyRead : { status: "idle" },
      memory: emptyRead,
      memoryQuery: this.memoryQuery,
      mutation:
        workspaceId === null
          ? { status: "idle" }
          : (this.outcomes.get(workspaceId) ?? { status: "idle" }),
      loadingMore: false,
      loadMoreFailed: false,
    });
    return this.refresh();
  };

  private read<T>(
    key: ReadKey,
    endpoint: Endpoint,
    invoke: (workspaceId: WorkspaceId, signal: AbortSignal) => Promise<RemoteResult<T>>,
    publish: (reading: WorkspaceReading<T>) => void,
  ): Promise<void> {
    this.reads.get(key)?.abort();
    this.reads.delete(key);
    if (this.closed) return Promise.resolve();
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === null) {
      publish(emptyRead);
      return Promise.resolve();
    }
    if (this.connection.generation.getSnapshot() === undefined) {
      publish({ status: "offline" });
      return Promise.resolve();
    }
    if (!this.available(endpoint)) {
      publish({ status: "unavailable" });
      return Promise.resolve();
    }
    const controller = createDshAbortController();
    this.reads.set(key, controller);
    const scope = this.scope;
    const current = () =>
      !this.closed && this.scope === scope && this.reads.get(key) === controller;
    publish({ status: "loading" });
    return this.own(
      Promise.resolve()
        .then(async () => {
          controller.signal.throwIfAborted();
          const result = await invoke(workspaceId, controller.signal);
          if (current())
            publish(result.ok ? { status: "ready", value: result.value } : { status: "failed" });
          return undefined;
        })
        .catch(() => {
          if (current()) publish({ status: "failed" });
        })
        .finally(() => {
          if (this.reads.get(key) === controller) this.reads.delete(key);
        }),
    );
  }

  refresh = async (): Promise<void> => {
    await Promise.all([
      this.refreshWork(),
      this.refreshDetail(),
      this.listFiles(this.directoryPath),
      this.refreshMemory(this.memoryQuery),
    ]);
    if (this.filePath !== null) await this.readFile(this.filePath);
  };
  refreshWork = (): Promise<void> => {
    this.reads.get("more")?.abort();
    this.reads.delete("more");
    this.publish({ loadingMore: false, loadMoreFailed: false });
    return this.read(
      "work",
      "workspaceWork/list",
      (workspaceId) => this.remote.workspaceWork.list({ workspaceId, after: null, limit: 100 }),
      (work) => this.publish({ work }),
    );
  };
  loadMoreWork = (): Promise<void> => {
    const work = this.snapshot.work;
    if (work.status !== "ready" || work.value.nextCursor === null || this.snapshot.loadingMore)
      return Promise.resolve();
    const previous = work.value;
    return this.read(
      "more",
      "workspaceWork/list",
      (workspaceId) =>
        this.remote.workspaceWork.list({ workspaceId, after: previous.nextCursor, limit: 100 }),
      (reading) => {
        if (reading.status === "loading")
          this.publish({ loadingMore: true, loadMoreFailed: false });
        else if (reading.status === "ready") {
          const items = new Map(previous.items.map((item) => [item.id, item]));
          for (const item of reading.value.items) items.set(item.id, item);
          this.publish({
            work: { status: "ready", value: { ...reading.value, items: [...items.values()] } },
            loadingMore: false,
          });
        } else this.publish({ loadingMore: false, loadMoreFailed: true });
      },
    );
  };
  selectWork = (id: DshWorkId | null): Promise<void> => {
    this.selectedWork = id;
    return this.refreshDetail();
  };
  private refreshDetail = (): Promise<void> => {
    const id = this.selectedWork;
    if (id === null) {
      this.reads.get("detail")?.abort();
      this.reads.delete("detail");
      this.publish({ detail: { status: "idle" } });
      return Promise.resolve();
    }
    return this.read(
      "detail",
      "workspaceWork/get",
      (workspaceId) => this.remote.workspaceWork.get({ workspaceId, id }),
      (detail) => this.publish({ detail }),
    );
  };
  listFiles = (path: string): Promise<void> => {
    this.directoryPath = path;
    return this.read(
      "files",
      "workspaceContent/listFiles",
      (workspaceId, signal) => this.remote.workspaceContent.listFiles(workspaceId, path, signal),
      (files) => this.publish({ files }),
    );
  };
  readFile = (path: string): Promise<void> => {
    this.filePath = path;
    return this.read(
      "file",
      "workspaceContent/readFile",
      (workspaceId, signal) => this.remote.workspaceContent.readFile(workspaceId, path, signal),
      (file) => this.publish({ file }),
    );
  };
  closeFile = (): void => {
    this.filePath = null;
    this.reads.get("file")?.abort();
    this.reads.delete("file");
    this.publish({ file: { status: "idle" } });
  };
  refreshMemory = (query: DshMemoryQuery = this.memoryQuery): Promise<void> => {
    this.memoryQuery = query;
    this.publish({ memoryQuery: query });
    return this.read(
      "memory",
      "workspaceMemory/list",
      (workspaceId, signal) => this.remote.workspaceMemory.list(workspaceId, query, signal),
      (memory) => this.publish({ memory }),
    );
  };

  private async mutate<T>(options: MutationOptions<T>): Promise<T | null> {
    const workspaceId = this.snapshot.workspaceId;
    if (
      this.closed ||
      workspaceId === null ||
      this.mutationController !== null ||
      !this.available(options.endpoint)
    )
      return null;
    const retained = this.outcomes.get(workspaceId);
    if (retained?.status === "unknown") return null;
    const controller = createDshAbortController();
    this.mutationController = controller;
    this.publishCapabilities();
    const scope = this.scope;
    const outcome = (status: Exclude<WorkspaceMutation, { status: "idle" }>["status"]) => {
      const mutation: WorkspaceMutation = {
        status,
        workspaceId,
        action: options.action,
        targetId: options.targetId,
      };
      this.outcomes.set(workspaceId, mutation);
      if (this.snapshot.workspaceId === workspaceId) this.publish({ mutation });
    };
    outcome("sending");
    return this.own(
      Promise.resolve()
        .then(async () => {
          if (controller.signal.aborted) {
            outcome("rejected");
            return null;
          }
          const result = await options.send(workspaceId);
          if (!result.ok) {
            const code = result.error.code;
            const refused =
              code === "workspace-work/rejected" ||
              code === "workspace/not-found" ||
              code === "gateway/arguments-invalid" ||
              code === "gateway/invocation-unavailable" ||
              code === "workspace-memory/refused";
            outcome(refused ? "rejected" : "unknown");
            return null;
          }
          outcome("accepted");
          if (this.scope !== scope || this.snapshot.workspaceId !== workspaceId) return null;
          await this.refresh();
          return this.scope === scope ? result.value : null;
        })
        .catch(() => {
          outcome("unknown");
          return null;
        })
        .finally(() => {
          this.mutationController = null;
          this.publishCapabilities();
        }),
    );
  }
  clearMutation = (): void => {
    if (this.mutationController !== null || this.snapshot.workspaceId === null) return;
    this.outcomes.delete(this.snapshot.workspaceId);
    this.publish({ mutation: { status: "idle" } });
  };
  connectExistingWork = async (): Promise<void> => {
    const work = this.snapshot.work;
    if (work.status !== "ready" || work.value.binding !== null) return;
    const candidate = work.value.adoptionCandidate;
    if (candidate === null) return;
    const requestId = this.randomId();
    await this.mutate({
      endpoint: "workspaceWork/initialize",
      action: "initialize",
      targetId: candidate.id,
      send: (workspaceId) =>
        this.remote.workspaceWork.initialize({
          workspaceId,
          requestId,
          projectId: candidate.id,
          title: candidate.title,
        }),
    });
  };
  private initializeWork = async (title: string): Promise<void> => {
    type ProjectId = Parameters<Remote["workspaceWork"]["initialize"]>[0]["projectId"];
    const requestId = this.randomId();
    const projectId = brandString<ProjectId>(this.randomId());
    await this.mutate({
      endpoint: "workspaceWork/initialize",
      action: "initialize",
      targetId: projectId,
      send: (workspaceId) =>
        this.remote.workspaceWork.initialize({ workspaceId, requestId, projectId, title }),
    });
  };
  createWork = async (draft: DshWorkDraft): Promise<DshWorkItem | null> => {
    const selectedWorkspaceId = this.snapshot.workspaceId;
    const scope = this.scope;
    const work = this.snapshot.work;
    if (selectedWorkspaceId === null || work.status !== "ready") return null;
    if (work.value.binding === null) {
      if (work.value.adoptionCandidate !== null) return null;
      await this.initializeWork(draft.workspaceTitle);
      const refreshed = this.snapshot.work;
      if (
        this.snapshot.workspaceId !== selectedWorkspaceId ||
        this.scope !== scope ||
        this.snapshot.mutation.status !== "accepted" ||
        refreshed.status !== "ready" ||
        refreshed.value.binding === null
      )
        return null;
    }
    const requestId = this.randomId();
    const id = brandString<DshWorkId>(this.randomId());
    return this.mutate({
      endpoint: "workspaceWork/create",
      action: "create",
      targetId: id,
      send: (workspaceId) =>
        this.remote.workspaceWork.create({
          workspaceId,
          requestId,
          id,
          title: draft.title,
          brief: draft.brief,
        }),
    });
  };
  updateWork = (edit: DshWorkEdit): Promise<DshWorkItem | null> => {
    const requestId = this.randomId();
    return this.mutate({
      endpoint: "workspaceWork/update",
      action: "update",
      targetId: edit.id,
      send: (workspaceId) => this.remote.workspaceWork.update({ workspaceId, requestId, ...edit }),
    });
  };
  setWorkStatus = (edit: DshWorkStatusEdit): Promise<DshWorkItem | null> => {
    const requestId = this.randomId();
    return this.mutate({
      endpoint: "workspaceWork/setStatus",
      action: "status",
      targetId: edit.id,
      send: (workspaceId) =>
        this.remote.workspaceWork.setStatus({ workspaceId, requestId, ...edit }),
    });
  };
  attachSession = (link: DshWorkSessionLink): Promise<DshWorkItem | null> => {
    const requestId = this.randomId();
    return this.mutate({
      endpoint: "workspaceWork/attachSession",
      action: "attach",
      targetId: link.id,
      send: (workspaceId) =>
        this.remote.workspaceWork.attachSession({ workspaceId, requestId, ...link }),
    });
  };
  reviewMemory = (review: DshMemoryReview): Promise<DshMemoryRecord | null> =>
    this.mutate({
      endpoint: "workspaceMemory/review",
      action: "review",
      targetId: review.id,
      send: (workspaceId) => this.remote.workspaceMemory.review(workspaceId, review),
    });
  correctMemory = (
    correction: DshMemoryCorrection,
  ): Promise<Value<ReturnType<Remote["workspaceMemory"]["correct"]>> | null> =>
    this.mutate({
      endpoint: "workspaceMemory/correct",
      action: "correct",
      targetId: correction.id,
      send: (workspaceId) => this.remote.workspaceMemory.correct(workspaceId, correction),
    });

  async dispose(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.unsubscribe();
      this.cancelReads();
      this.mutationController?.abort();
      this.listeners.clear();
    }
    await Promise.allSettled(this.tasks);
  }
}
