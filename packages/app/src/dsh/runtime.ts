import { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import * as dsh from "@deepseek-ai/dsh-client";
import { DshAccessError } from "./access-error";
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
}

export interface DshConversation {
  readonly sessionId: dsh.SessionId;
  readonly session: dsh.SessionFace;
  readonly conversation: dsh.ConversationBinding;
}

export interface DshHostRuntime {
  readonly hostId: dsh.ConnectionHostId;
  readonly connection: dsh.ConnectionHandle;
  readonly remote: Context["remote"];
  readonly sessions: dsh.ISessions;
  readonly workspaces: dsh.IWorkspaces;
  openConversation(id: dsh.SessionId, scheduler: dsh.ConversationScheduler | null): DshConversation;
  closeConversation(): void;
  dispose(): Promise<void>;
}

const sessionEndpoints = [
  "workspace/follow",
  "session/list",
  "session/control",
  "session/follow",
  "session/prompt",
  "session/cancel",
  "subagents/list",
] as const;

/**
 * Start one Host's generated DSH services. Connection readiness remains observable
 * through `connection.generation`; returning does not mean the Host is online.
 * The caller owns authenticated transports, hydrated navigation and final disposal.
 */
export async function createDshHostRuntime(
  options: DshHostRuntimeOptions,
): Promise<DshHostRuntime> {
  const requiredCapabilities = dsh.selectRemoteCapabilities(sessionEndpoints);
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
    };
    await context.plugin({ apply: dsh.applySessions, inject: dsh.sessionInject }, sessions);
    const events = new dsh.ConversationEventRegistry(context);
    const views = new dsh.ConversationViewRegistry(context);
    dsh.registerChatConversation({
      events,
      views,
      inspectRequestPrompt: dsh.inspectRequestPrompt,
      inspectSystemPrompt: dsh.inspectSystemPrompt,
    });
    let current: { view: DshConversation; binding: dsh.ConversationBindingModel } | null = null;
    let closed = false;
    function releaseConversation() {
      if (current === null) return;
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
        releaseConversation();
        await context.fiber.dispose();
      },
    };
  } catch (error) {
    await context.fiber.dispose();
    throw error;
  }
}
