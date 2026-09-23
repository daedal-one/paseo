import { dshSessionEndpoints } from "@getpaseo/protocol/dsh-access";
import { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import * as dsh from "@deepseek-ai/dsh-client";
import { DshAccessError } from "./access-error";
import { DshPrompt } from "./prompt";
import { DshCreationJournal, type DshCreationStorage } from "./creation-journal";
import { DshCreation } from "./creation";
import { DshRegistration } from "./registration";
import { DshRegistrationJournal, type RegistrationAttemptId } from "./registration-journal";
import { DshFork } from "./fork";
import { DshForkJournal } from "./fork-journal";
import { DshSearch } from "./search";
import { DshHistory } from "./history";
import { DshImages, DshImageReads } from "./images";
import { DshFileUploads } from "./files";
import { createDshAbortController } from "../runtime/dsh-abort-controller";

export interface DshHostRuntimeOptions {
  hostId: dsh.ConnectionHostId;
  baseUrl: string;
  isLocal: boolean;
  fetch: dsh.RpcFetch;
  createSocket(url: string): dsh.RemoteStreamSocket;
  randomId(): string;
  timeZone(): string;
  /** Hydrated navigation dedicated to this Host; persistence errors stay in its owner. */
  selection: dsh.SessionSelectionStore;
  network?: dsh.ConnectionNetworkSource;
  /** Durable Host-qualified mutation recovery; omission disables creation. */
  creationStorage?: DshCreationStorage;
  /** Dedicated Workspace registration database; omission disables registration. */
  registrationStorage?: DshCreationStorage;
  /** Dedicated fork database; omission disables forks. */
  forkStorage?: DshCreationStorage;
}

export interface DshConversation {
  readonly sessionId: dsh.SessionId;
  readonly session: dsh.SessionFace;
  readonly conversation: dsh.ConversationBinding;
  readonly prompt: DshPrompt;
  readonly history: DshHistory;
  readonly images: DshImages;
}

export interface DshHostRuntime {
  readonly hostId: dsh.ConnectionHostId;
  readonly connection: dsh.ConnectionHandle;
  readonly remote: Context["remote"];
  readonly sessions: dsh.ISessions;
  readonly workspaces: dsh.IWorkspaces;
  readonly creation: DshCreation;
  readonly registration: DshRegistration;
  readonly search: DshSearch;
  readonly fork: DshFork;
  readonly pending: dsh.PendingInteractions["source"];
  openConversation(id: dsh.SessionId, scheduler: dsh.ConversationScheduler | null): DshConversation;
  closeConversation(): void;
  dispose(): Promise<void>;
}

/**
 * Start one Host's generated DSH services. Connection readiness remains observable
 * through `connection.generation`; returning does not mean the Host is online.
 * The caller owns authenticated transports, hydrated navigation and final disposal.
 */
export async function createDshHostRuntime(
  options: DshHostRuntimeOptions,
): Promise<DshHostRuntime> {
  const requiredCapabilities = dsh.selectRemoteCapabilities(dshSessionEndpoints);
  const context = new Context();
  const connection = dsh.createConnection({
    isLoopback: options.isLocal,
    createAbortController: createDshAbortController,
    network: options.network,
    rpc: dsh.createConnectionRpc({
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      randomId: () => brandString<dsh.RpcId>(options.randomId()),
    }),
  });
  let creation: DshCreation | undefined;
  let registration: DshRegistration | undefined;
  let search: DshSearch | undefined;
  let fork: DshFork | undefined;
  try {
    context.provide("connection", connection);
    await context.plugin({ apply: dsh.applyRegistry, inject: dsh.registryInject });
    await context.plugin({
      inject: ["typert", "connection"],
      apply(scope) {
        dsh.applyRemoteClient(scope, {
          baseUrl: options.baseUrl,
          expectedHostId: options.hostId,
          requiredCapabilities,
          createSocket: options.createSocket,
          randomId: options.randomId,
          createAbortController: createDshAbortController,
        });
      },
    });
    await context.plugin({ apply: dsh.apply, inject: dsh.inject });
    await context.plugin({ apply: dsh.applyWorkspaces, inject: dsh.workspaceInject });
    const sessions: dsh.SessionClientOptions = {
      platform: {
        createRequestId: () => brandString<dsh.SessionRequestId>(options.randomId()),
        timeZone: options.timeZone,
      },
      selection: options.selection,
      historyDetailRetention: { maxSerializedChars: 8 * 1024 * 1024 },
    };
    await context.plugin({ apply: dsh.applySessions, inject: dsh.sessionInject }, sessions);
    creation = new DshCreation(
      context.sessions,
      context.workspaces,
      connection,
      () => context.remote.$host.capabilities,
      () => context.remote.agentPresets.list(),
      () => brandString<dsh.SessionId>(options.randomId()),
      options.creationStorage === undefined
        ? undefined
        : new DshCreationJournal(options.hostId, options.creationStorage),
    );
    await creation.restore();
    const ownedCreation = creation;
    registration = new DshRegistration(
      context.workspaces,
      connection,
      () => context.remote.$host.capabilities,
      () => brandString<RegistrationAttemptId>(options.randomId()),
      options.registrationStorage === undefined
        ? undefined
        : new DshRegistrationJournal(options.hostId, options.registrationStorage),
    );
    await registration.restore();
    const ownedRegistration = registration;
    fork = new DshFork(
      context.sessions,
      context.workspaces,
      connection,
      () => context.remote.$host.capabilities,
      () => brandString<dsh.SessionId>(options.randomId()),
      options.forkStorage === undefined
        ? undefined
        : new DshForkJournal(options.hostId, options.forkStorage),
    );
    await fork.restore();
    const ownedFork = fork;
    search = new DshSearch(context.sessions, connection, () => context.remote.$host.capabilities);
    const ownedSearch = search;
    const pending = new dsh.PendingInteractions();
    await context.plugin({
      inject: ["remote", "sessions"],
      apply(scope) {
        dsh.registerApprovalRequests(scope.remote, scope.sessions, (precedence) =>
          pending.register(scope, precedence),
        );
        dsh.registerQuestionRequests(scope.remote, scope.sessions, (precedence) =>
          pending.register(scope, precedence),
        );
      },
    });
    const events = new dsh.ConversationEventRegistry(context);
    const views = new dsh.ConversationViewRegistry(context);
    dsh.registerChatConversation({
      events,
      views,
      inspectRequestPrompt: dsh.inspectRequestPrompt,
      inspectSystemPrompt: dsh.inspectSystemPrompt,
    });
    const imageReads = new DshImageReads(context.remote.session);
    context.effect(() => () => imageReads.close());
    const fileUploads = new DshFileUploads(context.remote.fileUploads);
    context.effect(() => () => fileUploads.close());
    let current: { view: DshConversation; binding: dsh.ConversationBindingModel } | null = null;
    let closed = false;
    const retiringHistory = new Set<Promise<void>>();
    function releaseConversation() {
      if (current === null) return;
      const retiring = current.view.history
        .dispose()
        .finally(() => retiringHistory.delete(retiring));
      retiringHistory.add(retiring);
      current.view.images.dispose();
      current.view.prompt.dispose();
      current.binding.dispose();
      current = null;
    }
    context.effect(() => releaseConversation);
    return {
      hostId: options.hostId,
      connection,
      remote: context.remote,
      sessions: context.sessions,
      workspaces: context.workspaces,
      pending: pending.source,
      creation: ownedCreation,
      registration: ownedRegistration,
      search: ownedSearch,
      fork: ownedFork,
      openConversation(id, scheduler) {
        if (closed) throw new DshAccessError("transport-disposed");
        const source = context.sessions.binding(id);
        if (source === undefined || source.session.getSnapshot().removed)
          throw new DshAccessError("session-unavailable");
        if (current?.view.sessionId === id) return current.view;
        context.sessions.open(id);
        const binding = new dsh.ConversationBindingModel(
          source.eventSource,
          new dsh.ConversationNodeAssembler(events, views),
          scheduler,
        );
        const view: DshConversation = {
          sessionId: id,
          session: source.session,
          conversation: binding,
          history: new DshHistory(
            source.session,
            connection,
            () => context.remote.$host.capabilities,
          ),
          images: new DshImages(
            id,
            imageReads,
            connection,
            () => context.remote.$host.capabilities,
          ),
          prompt: new DshPrompt(
            source,
            connection,
            () => brandString<dsh.SessionRequestId>(options.randomId()),
            {
              capabilities: () => context.remote.$host.capabilities,
              start: (request) => fileUploads.start(id, request),
            },
          ),
        };
        releaseConversation();
        current = { view, binding };
        return view;
      },
      closeConversation() {
        releaseConversation();
        if (!closed) context.sessions.clear();
      },
      async dispose() {
        closed = true;
        imageReads.close();
        releaseConversation();
        await Promise.all([
          fileUploads.close(),
          ownedFork.dispose(),
          ownedSearch.dispose(),
          ownedRegistration.dispose(),
          ownedCreation.dispose(),
          context.fiber.dispose(),
          ...retiringHistory,
        ]);
      },
    };
  } catch (error) {
    await Promise.all([
      fork?.dispose(),
      search?.dispose(),
      registration?.dispose(),
      creation?.dispose(),
      context.fiber.dispose(),
    ]);
    throw error;
  }
}
