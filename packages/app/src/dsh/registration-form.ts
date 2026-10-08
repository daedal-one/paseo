import type { IWorkspaces, WorkspaceView } from "@deepseek-ai/dsh-client";
import type { DshRegistration, DshRegistrationSnapshot } from "./registration";

type RegistrationPort = Pick<
  DshRegistration,
  "getSnapshot" | "subscribe" | "register" | "restore" | "reset" | "checkCurrent" | "adoptCurrent"
>;
export interface DshRegistrationFormState {
  readonly registration: DshRegistrationSnapshot;
  readonly path: string;
  readonly editable: boolean;
  readonly working: boolean;
  readonly canSubmit: boolean;
  readonly canReset: boolean;
  readonly canCheck: boolean;
  readonly canAdopt: boolean;
  readonly currentWorkspace: WorkspaceView | null;
}
/** A registration draft and explicit review actions; closing never abandons a retained attempt. */
export class DshRegistrationForm {
  private readonly listeners = new Set<() => void>();
  private subscriptions: (() => void)[] = [];
  private pending: Promise<void> | null = null;
  private closed = false;
  private state: DshRegistrationFormState;
  constructor(
    private readonly registration: RegistrationPort,
    private readonly workspaces: Pick<IWorkspaces, "list">,
  ) {
    this.state = {
      registration: registration.getSnapshot(),
      path: "",
      editable: false,
      working: false,
      canSubmit: false,
      canReset: false,
      canCheck: false,
      canAdopt: false,
      currentWorkspace: null,
    };
    this.sync();
  }
  getSnapshot = (): DshRegistrationFormState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  connect = (): (() => void) => {
    this.closed = false;
    this.subscriptions = [
      this.registration.subscribe(this.sync),
      this.workspaces.list.subscribe(this.sync),
    ];
    this.sync();
    return () => {
      this.closed = true;
      for (const remove of this.subscriptions) remove();
      this.subscriptions = [];
    };
  };
  private sync = (): void => {
    if (this.closed) return;
    const registration = this.registration.getSnapshot(),
      list = this.workspaces.list.getSnapshot();
    const outcome = registration.outcome;
    const working = this.pending !== null;
    const ready = registration.storage === "ready" && !working;
    const editable = ready && outcome.kind === "idle";
    const terminal =
      outcome.kind === "confirmed" ||
      outcome.kind === "adopted" ||
      outcome.kind === "rejected" ||
      outcome.kind === "not-dispatched";
    const currentWorkspace = registeredWorkspace(outcome, list);
    const canCheck =
      ready &&
      outcome.kind === "unknown" &&
      registration.lookupAvailability === "available" &&
      registration.lookup.kind !== "loading";
    this.state = {
      ...this.state,
      registration,
      working,
      editable,
      canSubmit:
        editable && registration.availability === "available" && this.state.path.trim().length > 0,
      canReset: ready && terminal,
      canCheck,
      canAdopt: canCheck && registration.lookup.kind === "found",
      currentWorkspace,
    };
    for (const listener of this.listeners) listener();
  };
  setPath = (path: string): void => {
    if (!this.state.editable) return;
    this.state = { ...this.state, path };
    this.sync();
  };
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
    const path = this.state.path;
    return this.run(() => this.registration.register(path));
  };
  reset = (): Promise<void> => {
    if (!this.state.canReset) return Promise.resolve();
    const outcome = this.state.registration.outcome;
    const path = "request" in outcome ? outcome.request.path : this.state.path;
    return this.run(async () => {
      this.state = { ...this.state, path };
      await this.registration.reset();
    });
  };
  checkCurrent = (): Promise<void> =>
    this.state.canCheck ? this.run(() => this.registration.checkCurrent()) : Promise.resolve();
  adoptCurrent = (): Promise<void> =>
    this.state.canAdopt ? this.run(() => this.registration.adoptCurrent()) : Promise.resolve();
  restore = (): Promise<void> => this.run(() => this.registration.restore());
}

/** Only a followed identity can be offered for Session selection. */
function registeredWorkspace(
  outcome: DshRegistrationSnapshot["outcome"],
  list: ReturnType<IWorkspaces["list"]["getSnapshot"]>,
): WorkspaceView | null {
  if (list.phase !== "ready" || list.error !== null) return null;
  if (outcome.kind !== "confirmed" && outcome.kind !== "adopted") return null;
  return list.items.find((item) => item.workspaceId === outcome.workspace.workspaceId) ?? null;
}
