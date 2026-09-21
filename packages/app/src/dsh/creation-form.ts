import type { IWorkspaces, SessionId, WorkspaceId } from "@deepseek-ai/dsh-client";
import type { DshCreation, DshCreationSnapshot } from "./creation";

interface Display {
  readonly label: string;
  readonly description?: string;
}
interface Selected<T> {
  readonly value: T;
  readonly display: Display;
}
type Workspaces = ReturnType<IWorkspaces["list"]["getSnapshot"]>;
type CreationPort = Pick<
  DshCreation,
  "getSnapshot" | "subscribe" | "create" | "refreshProfiles" | "reconcile" | "restore" | "reset"
>;
export interface DshCreationFormState {
  readonly creation: DshCreationSnapshot;
  readonly workspaces: Workspaces;
  readonly target: "directory" | "workspace";
  readonly cwd: string;
  readonly profile: Selected<string> | null;
  readonly workspace: Selected<WorkspaceId> | null;
  readonly editable: boolean;
  readonly canSubmit: boolean;
  readonly profileMissing: boolean;
  readonly workspaceMissing: boolean;
  readonly working: boolean;
  readonly openSession: SessionId | null;
}

function publishedSession(outcome: DshCreationSnapshot["outcome"]): SessionId | null {
  if (
    outcome.kind === "accepted" ||
    outcome.kind === "attachment-failed" ||
    (outcome.kind === "unknown" && outcome.published)
  )
    return outcome.request.sessionId;
  return null;
}

/** A single form draft. Closing it releases readers without abandoning the Host's retained attempt. */
export class DshCreationForm {
  private readonly listeners = new Set<() => void>();
  private subscriptions: (() => void)[] = [];
  private closed = false;
  private pending: Promise<void> | null = null;
  private state: DshCreationFormState;

  constructor(
    private readonly creation: CreationPort,
    private readonly workspaces: Pick<IWorkspaces, "list">,
  ) {
    this.state = {
      creation: creation.getSnapshot(),
      workspaces: workspaces.list.getSnapshot(),
      target: "directory",
      cwd: "",
      profile: null,
      workspace: null,
      editable: false,
      canSubmit: false,
      profileMissing: false,
      workspaceMissing: false,
      working: false,
      openSession: null,
    };
    this.sync();
  }
  getSnapshot = (): DshCreationFormState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** Attach after mounting; no catalog read or mutation is triggered by subscription. */
  connect = (): (() => void) => {
    this.closed = false;
    this.subscriptions = [
      this.creation.subscribe(this.sync),
      this.workspaces.list.subscribe(this.sync),
    ];
    this.sync();
    return () => {
      this.closed = true;
      for (const unsubscribe of this.subscriptions) unsubscribe();
      this.subscriptions = [];
    };
  };
  private sync = (): void => {
    if (this.closed) return;
    const creation = this.creation.getSnapshot(),
      workspaces = this.workspaces.list.getSnapshot();
    const { profile, workspace, target, cwd } = this.state;
    const editable =
      creation.outcome.kind === "idle" && creation.storage === "ready" && this.pending === null;
    const profileValid =
      creation.roster === "ready" &&
      creation.catalog === "available" &&
      profile !== null &&
      creation.profiles.some((p) => p.id === profile.value);
    const workspaceReady = workspaces.phase === "ready" && workspaces.error === null;
    const workspaceValid =
      workspaceReady &&
      workspace !== null &&
      workspaces.items.some((w) => w.workspaceId === workspace.value);
    const openSession = publishedSession(creation.outcome);
    this.state = {
      ...this.state,
      creation,
      workspaces,
      editable,
      canSubmit:
        editable &&
        creation.availability === "available" &&
        profileValid &&
        (target === "directory" ? cwd.trim().length > 0 : workspaceValid),
      profileMissing: profile !== null && creation.roster === "ready" && !profileValid,
      workspaceMissing: workspace !== null && workspaceReady && !workspaceValid,
      working: this.pending !== null,
      openSession,
    };
    for (const listener of this.listeners) listener();
  };
  chooseTarget = (target: "directory" | "workspace"): void => {
    if (this.state.editable) {
      this.state = { ...this.state, target };
      this.sync();
    }
  };
  setDirectory = (cwd: string): void => {
    if (this.state.editable) {
      this.state = { ...this.state, cwd };
      this.sync();
    }
  };
  chooseProfile = (value: string, display: Display): void => {
    if (this.state.editable) {
      this.state = { ...this.state, profile: { value, display } };
      this.sync();
    }
  };
  chooseWorkspace = (value: WorkspaceId, display: Display): void => {
    if (this.state.editable) {
      this.state = { ...this.state, workspace: { value, display } };
      this.sync();
    }
  };
  refreshProfiles = (): Promise<void> => this.creation.refreshProfiles();
  private run(action: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.pending !== null) return this.pending;
    const task = Promise.resolve()
      .then(action)
      .finally(() => {
        this.pending = null;
        this.sync();
      });
    this.pending = task;
    this.sync();
    return task;
  }
  submit = (): Promise<void> => {
    if (this.pending !== null) return this.pending;
    if (!this.state.canSubmit) return Promise.resolve();
    const { profile, workspace, target, cwd } = this.state;
    return this.run(() =>
      this.creation.create({
        agentPreset: profile!.value,
        ...(target === "directory" ? { cwd } : { workspaceId: workspace!.value }),
      }),
    );
  };
  checkStatus = (): Promise<void> =>
    this.run(async () => {
      await this.creation.restore();
      await this.creation.reconcile();
    });
  reset = (): Promise<void> => this.run(() => this.creation.reset());
}
