import { z } from "zod";
import { selectRemoteCapabilities } from "@deepseek-ai/dsh-client";
import { describe, expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { ConnectionHostId, SessionId, SessionSelection } from "@deepseek-ai/dsh-client";
import { createDshHostRuntime, type DshHostRuntimeOptions } from "./runtime";

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

describe("native DSH runtime ownership", () => {
  it("starts offline without replacing remembered navigation or sending commands", async () => {
    const host = offlineHost("26e99520-f2d3-4874-84b5-07c5ef24775d");
    const remembered: SessionSelection = {
      sessionId: brandString<SessionId>("remembered-session"),
    };
    host.options.selection.set(remembered);
    const runtime = await createDshHostRuntime(host.options);
    try {
      expect(runtime.hostId).toBe(host.options.hostId);
      expect(host.options.selection.getSnapshot()).toEqual(remembered);
      expect(runtime.connection.generation.getSnapshot()).toBeUndefined();
      expect(typeof runtime.remote.session.prompt).toBe("function");
      expect(typeof runtime.sessions.open).toBe("function");
      expect(host.fetch).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
    expect(host.networkListeners.size).toBe(0);
    expect(host.sockets.length).toBeGreaterThan(0);
    for (const socket of host.sockets) expect(socket.close).toHaveBeenCalled();
  });

  it("rejects an unknown Session without issuing a read or changing selection", async () => {
    const host = offlineHost("26e99520-f2d3-4874-84b5-07c5ef24775d");
    const runtime = await createDshHostRuntime(host.options);
    try {
      expect(() => runtime.openConversation(brandString<SessionId>("missing"), null)).toThrow(
        "dsh-access/session-unavailable",
      );
      expect(host.options.selection.getSnapshot()).toEqual({});
      expect(host.fetch).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it("disposes one Host without withdrawing another Host's services", async () => {
    const first = offlineHost("26e99520-f2d3-4874-84b5-07c5ef24775d");
    const second = offlineHost("00293014-2e9f-47ef-bc87-98fe20ebceae");
    const firstRuntime = await createDshHostRuntime(first.options);
    try {
      const secondRuntime = await createDshHostRuntime(second.options);
      try {
        expect(firstRuntime.remote).not.toBe(secondRuntime.remote);
        expect(firstRuntime.sessions).not.toBe(secondRuntime.sessions);
        expect(firstRuntime.workspaces).not.toBe(secondRuntime.workspaces);
        await firstRuntime.dispose();
        expect(first.networkListeners.size).toBe(0);
        expect(second.networkListeners.size).toBe(1);
        const result = await secondRuntime.remote.session.search({ query: "offline" });
        expect(result.ok).toBe(false);
        expect(second.fetch).not.toHaveBeenCalled();
      } finally {
        await secondRuntime.dispose();
      }
    } finally {
      await firstRuntime.dispose();
    }
    expect(second.networkListeners.size).toBe(0);
  });
});

// In-memory carriers exercise the installed generated codecs and real Session/Chat owners.
// Platform socket and fetch behavior is qualified separately against an isolated DSH Host.
function hasFixtureAdmission(
  runtime: Awaited<ReturnType<typeof createDshHostRuntime>>,
  id: SessionId,
) {
  return (
    runtime.sessions
      .binding(id)
      ?.eventSource.getSnapshot()
      .entries.some(
        (entry) =>
          entry.type === "event" &&
          entry.event.type === "user/message" &&
          entry.event.data.id === "admitted-1",
      ) === true
  );
}

function admittedPrompt(requestId: string, seq = 1) {
  return {
    type: "event",
    event: {
      type: "user/message",
      seq,
      time: seq + 1,
      surfaceOp: "append",
      data: {
        id: `admitted-${seq}`,
        role: "user",
        content: [{ type: "text", text: "Possibly accepted" }],
        source: { kind: "user", rpcId: requestId },
      },
    },
  };
}

function conversationHost() {
  let historyAdmission: string | null = null;
  const host = offlineHost("26e99520-f2d3-4874-84b5-07c5ef24775d");
  const identity = {
    version: 1,
    hostId: host.options.hostId,
    activationId: "f5292bdb-ebda-41ba-b473-6c587a3c1d02",
  };
  const capabilities = selectRemoteCapabilities([
    "workspace/follow",
    "session/list",
    "session/control",
    "session/follow",
    "session/prompt",
    "session/cancel",
    "subagents/list",
  ]).map((entry) => Object.assign({}, entry, { availability: "available" }));
  const ids = [brandString<SessionId>("first"), brandString<SessionId>("second")];
  const calls: string[] = [];
  const eventResults: unknown[] = [];
  const streams = new Map<string, string>();
  const listeners = new Map<string, Set<(event: { readonly data: unknown }) => void>>();
  const once = new Set<(event: { readonly data: unknown }) => void>();
  let readyState = 0;
  let failHistory = false;
  const prompts: {
    requestId: string;
    sessionId: string;
    mode: string;
    content: { type: "text"; text: string }[];
  }[] = [];
  let promptReply: (signal: AbortSignal | null | undefined) => Promise<unknown> = async () => ({
    ok: true,
    value: { accepted: true },
  });
  function emit(type: string, data: unknown) {
    for (const listener of listeners.get(type) ?? []) {
      if (once.delete(listener)) listeners.get(type)?.delete(listener);
      listener({ data });
    }
  }
  function item(streamId: string, value: unknown) {
    emit("message", JSON.stringify({ type: "item", streamId, value }));
  }
  host.options.network = { getSnapshot: () => true, subscribe: () => () => {} };
  host.options.fetch = async (_url, init) => {
    const request = z
      .object({ rpcId: z.string(), method: z.string() })
      .parse(JSON.parse(String(init.body)));
    calls.push(request.method);
    let value: unknown;
    switch (request.method) {
      case "connection/identity":
        value = identity;
        break;
      case "$capabilities":
        value = { version: 3, identity, capabilities };
        break;
      case "session/list":
        value = {
          items: ids.map((sessionId) => ({
            sessionId,
            title: sessionId,
            updatedAt: 1,
            running: false,
            blank: false,
          })),
        };
        break;
      case "$events/result": {
        const frame = z
          .object({ payload: z.object({ args: z.unknown() }) })
          .parse(JSON.parse(String(init.body)));
        eventResults.push(frame.payload.args);
        value = undefined;
        break;
      }
      case "subagents/list":
        value = { entries: [], parentAvailable: true };
        break;
      case "session/prompt": {
        const payload = z
          .object({
            payload: z.object({
              args: z.object({
                request: z.object({
                  requestId: z.string(),
                  sessionId: z.string(),
                  mode: z.string(),
                  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
                }),
              }),
            }),
          })
          .parse(JSON.parse(String(init.body)));
        prompts.push(payload.payload.args.request);
        const result = await promptReply(init.signal);
        return {
          ok: true,
          status: 200,
          json: async () => ({ type: "server-response", rpcId: request.rpcId, result }),
        };
      }
      default:
        throw new Error(`Unexpected test RPC: ${request.method}`);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value },
      }),
    };
  };
  host.options.createSocket = () => {
    queueMicrotask(() => {
      readyState = 1;
      emit("open", undefined);
    });
    return {
      get readyState() {
        return readyState;
      },
      addEventListener(type, listener, options?: { once?: boolean }) {
        let set = listeners.get(type);
        if (set === undefined) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(listener);
        if (options?.once) once.add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      close() {
        readyState = 3;
        emit("close", undefined);
      },
      send(raw) {
        const frame = z
          .object({ type: z.string(), streamId: z.string(), endpoint: z.string().optional() })
          .parse(JSON.parse(raw));
        if (frame.type !== "open") return;
        const endpoint = frame.endpoint;
        if (endpoint === undefined) throw new Error("Missing stream endpoint");
        streams.set(endpoint, frame.streamId);
        calls.push(endpoint);
        let value: unknown;
        switch (endpoint) {
          case "$events":
            value = {
              type: "ready",
              protocolVersion: 1,
              clientId: "native-test",
              host: { home: "/fixture", identity },
            };
            break;
          case "workspace/follow":
            value = { type: "baseline", value: { items: [], archivedSessionIds: [] } };
            break;
          case "session/control":
            value = { type: "baseline", value: { queues: {}, jobs: {}, projections: {} } };
            break;
          case "session/follow": {
            const request = z
              .object({
                payload: z.object({
                  args: z.object({
                    request: z.object({ address: z.object({ sessionId: z.string() }) }),
                  }),
                }),
              })
              .parse(JSON.parse(raw));
            if (failHistory) {
              queueMicrotask(() =>
                emit(
                  "message",
                  JSON.stringify({
                    type: "error",
                    streamId: frame.streamId,
                    error: { code: "fixture/unavailable", message: "Unavailable", details: {} },
                  }),
                ),
              );
              return;
            }
            value = {
              type: "snapshot",
              header: {
                version: 3,
                id: request.payload.args.request.address.sessionId,
                createdAt: 0,
                isSeeded: false,
              },
              cursor: historyAdmission === null ? 0 : 1,
              records: [
                {
                  type: "event",
                  event: {
                    type: "user/message",
                    seq: 0,
                    time: 1,
                    surfaceOp: "append",
                    data: {
                      id: "message-one",
                      role: "user",
                      content: [{ type: "text", text: "Read this existing conversation" }],
                      source: { kind: "user" },
                    },
                  },
                },
                ...(historyAdmission === null ? [] : [admittedPrompt(historyAdmission)]),
              ],
              hasMore: false,
              projections: { asOfSeq: 0, values: {} },
              assistantStream: { revision: 0 },
            };
            break;
          }
          default:
            throw new Error(`Unexpected test stream: ${endpoint}`);
        }
        queueMicrotask(() => item(frame.streamId, value));
      },
    };
  };
  return {
    options: host.options,
    eventResults,
    event(value: unknown) {
      const streamId = streams.get("$events");
      if (streamId === undefined) throw new Error("Remote event stream is not open");
      item(streamId, value);
    },
    disconnect() {
      readyState = 3;
      emit("close", undefined);
    },
    prompts,
    admitOnReconnect(requestId: string) {
      historyAdmission = requestId;
    },
    control(value: unknown) {
      const streamId = streams.get("session/control");
      if (streamId === undefined) throw new Error("Session control is not open");
      item(streamId, value);
    },
    replyToPrompt(reply: typeof promptReply) {
      promptReply = reply;
    },
    push(value: unknown) {
      const streamId = streams.get("session/follow");
      if (streamId === undefined) throw new Error("Session history is not open");
      item(streamId, value);
    },
    ids,
    calls,
    failHistory(value: boolean) {
      failHistory = value;
    },
    get readyState() {
      return readyState;
    },
  };
}

describe("native DSH Conversation ownership", () => {
  it("opens shared Session history once and closes its view without cancelling the Session", async () => {
    const host = conversationHost();
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const first = runtime.openConversation(host.ids[0], null);
      const target = first.conversation.target("chat");
      const unsubscribe = target.subscribe(() => {});
      try {
        await vi.waitFor(() => expect(first.session.getSnapshot().openState).toBe("open"));
        const snapshot = target.getSnapshot();
        expect(snapshot?.nodes.values().find((node) => node.kind === "user")?.data).toMatchObject({
          content: [{ type: "text", text: "Read this existing conversation" }],
        });
        expect(runtime.openConversation(host.ids[0], null)).toBe(first);
        expect(host.calls.filter((endpoint) => endpoint === "session/follow")).toHaveLength(1);
        const second = runtime.openConversation(host.ids[1], null);
        expect(second.sessionId).toBe(host.ids[1]);
        expect(second.conversation).not.toBe(first.conversation);
        await vi.waitFor(() => expect(second.session.getSnapshot().openState).toBe("open"));
        expect(target.getSnapshot()).toBe(snapshot);
        runtime.closeConversation();
        expect(host.options.selection.getSnapshot().sessionId).toBeUndefined();
        expect(host.calls).not.toContain("session/cancel");
      } finally {
        unsubscribe();
      }
    } finally {
      await runtime.dispose();
    }
    expect(host.readyState).toBe(3);
    expect(() => runtime.openConversation(host.ids[0], null)).toThrow(
      "dsh-access/transport-disposed",
    );
  });

  it("publishes cumulative streaming on the supplied scheduler and ignores a late frame after close", async () => {
    const host = conversationHost();
    const runtime = await createDshHostRuntime(host.options);
    const pending = new Set<() => void>();
    const cancelled = vi.fn();
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const view = runtime.openConversation(host.ids[0], {
        schedule(publish) {
          pending.add(publish);
          return () => {
            pending.delete(publish);
            cancelled();
          };
        },
      });
      const target = view.conversation.target("chat");
      const unsubscribe = target.subscribe(() => {});
      try {
        await vi.waitFor(() => expect(view.session.getSnapshot().openState).toBe("open"));
        host.push({
          type: "event",
          event: { type: "turn/start", seq: 1, time: 2, data: { turn: 1 } },
        });
        host.push({
          type: "event",
          event: { type: "step/start", seq: 2, time: 3, data: { turn: 1, step: 1 } },
        });
        host.push({
          type: "assistant-stream",
          frame: {
            type: "start",
            attemptId: "streaming",
            revision: 1,
            startedAfterSeq: 2,
            turn: 1,
            step: 1,
          },
        });
        host.push({
          type: "assistant-stream",
          frame: {
            type: "chunk",
            attemptId: "streaming",
            revision: 2,
            index: 0,
            time: 4,
            chunk: { type: "text-delta", index: 0, text: "Hello" },
          },
        });
        await vi.waitFor(() => expect(pending.size).toBe(1));
        for (const publish of pending) publish();
        pending.clear();
        expect(target.getSnapshot()?.navigation.items()[0].response).toBe("Hello");
        const key = target
          .getSnapshot()
          ?.order.find((id) => target.getSnapshot()?.nodes.get(id)?.kind === "assistant-step");
        expect(typeof key).toBe("string");
        host.push({
          type: "assistant-stream",
          frame: {
            type: "chunk",
            attemptId: "streaming",
            revision: 3,
            index: 1,
            time: 5,
            chunk: { type: "text-delta", index: 0, text: " world" },
          },
        });
        await vi.waitFor(() => expect(pending.size).toBe(1));
        for (const publish of pending) publish();
        pending.clear();
        expect(target.getSnapshot()?.navigation.items()[0].response).toBe("Hello world");
        expect(target.getSnapshot()?.order).toContain(key);
        host.push({
          type: "assistant-stream",
          frame: {
            type: "chunk",
            attemptId: "streaming",
            revision: 4,
            index: 2,
            time: 6,
            chunk: { type: "text-delta", index: 0, text: "!" },
          },
        });
        await vi.waitFor(() => expect(pending.size).toBe(1));
        const late = [...pending];
        const snapshot = target.getSnapshot();
        runtime.closeConversation();
        expect(cancelled).toHaveBeenCalledOnce();
        expect(pending.size).toBe(0);
        for (const publish of late) publish();
        expect(target.getSnapshot()).toBe(snapshot);
      } finally {
        unsubscribe();
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps a failed history read explicit and retries through the existing Session", async () => {
    const host = conversationHost();
    host.failHistory(true);
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const view = runtime.openConversation(host.ids[0], null);
      await vi.waitFor(() => expect(view.session.getSnapshot().openState).toBe("error"));
      expect(view.session.getSnapshot().openError?.code).toBe("fixture/unavailable");
      host.failHistory(false);
      await view.session.retryOpen();
      expect(view.session.getSnapshot().openState).toBe("open");
      expect(view.session.getSnapshot().openError).toBeNull();
      expect(runtime.openConversation(host.ids[0], null)).toBe(view);
    } finally {
      await runtime.dispose();
    }
  });
});

describe("native DSH text submission", () => {
  it("sends one exact queued prompt and clears only a Host-accepted draft", async () => {
    const host = conversationHost();
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const view = runtime.openConversation(host.ids[0], null);
      await vi.waitFor(() => expect(view.session.getSnapshot().openState).toBe("open"));
      expect(view.prompt.getSnapshot().canSend).toBe(false);
      view.prompt.setText("  \n ");
      await view.prompt.send();
      expect(host.prompts).toHaveLength(0);
      view.prompt.setText("Continue the existing task\nPreserve this line.");
      expect(view.prompt.getSnapshot().canSend).toBe(true);
      await view.prompt.send();
      expect(host.prompts).toHaveLength(1);
      expect(host.prompts[0]).toMatchObject({
        sessionId: host.ids[0],
        mode: "queue",
        content: [{ type: "text", text: "Continue the existing task\nPreserve this line." }],
      });
      expect(view.prompt.getSnapshot()).toMatchObject({
        text: "",
        canSend: false,
        submission: { kind: "accepted" },
      });
      expect(host.calls).not.toContain("session/cancel");
    } finally {
      await runtime.dispose();
    }
  });
  it("prevents duplicate taps while preserving edits made before acceptance", async () => {
    const host = conversationHost();
    let reply: (value: unknown) => void = () => {
      throw new Error("No prompt is pending");
    };
    host.replyToPrompt(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const view = runtime.openConversation(host.ids[0], null);
      await vi.waitFor(() => expect(view.session.getSnapshot().openState).toBe("open"));
      view.prompt.setText("First draft");
      const pending = view.prompt.send();
      await vi.waitFor(() => expect(host.prompts).toHaveLength(1));
      expect(view.prompt.getSnapshot()).toMatchObject({
        canSend: false,
        submission: { kind: "sending", text: "First draft" },
      });
      view.prompt.setText("Next draft");
      expect(view.prompt.send()).toBe(pending);
      expect(host.prompts).toHaveLength(1);
      reply({ ok: true, value: { accepted: true } });
      expect(await pending).toBe(true);
      expect(view.prompt.getSnapshot()).toMatchObject({
        text: "Next draft",
        canSend: true,
        submission: { kind: "accepted" },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps a confirmed Host refusal visible and retries only on another user submission", async () => {
    const host = conversationHost();
    host.replyToPrompt(async () => ({
      ok: false,
      error: {
        code: "session/model-unavailable",
        message: "No model",
        details: { provider: "fixture", model: "fixture" },
      },
    }));
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const view = runtime.openConversation(host.ids[0], null);
      await vi.waitFor(() => expect(view.session.getSnapshot().openState).toBe("open"));
      view.prompt.setText("Keep my draft");
      expect(await view.prompt.send()).toBe(false);
      expect(view.prompt.getSnapshot()).toMatchObject({
        text: "Keep my draft",
        canSend: true,
        submission: { kind: "rejected", code: "session/model-unavailable" },
      });
      expect(host.prompts).toHaveLength(1);
      host.replyToPrompt(async () => ({ ok: true, value: { accepted: true } }));
      expect(await view.prompt.send()).toBe(true);
      expect(host.prompts).toHaveLength(2);
      expect(host.prompts[1].requestId).not.toBe(host.prompts[0].requestId);
      expect(view.prompt.getSnapshot().text).toBe("");
    } finally {
      await runtime.dispose();
    }
  });

  it("never resubmits an uncertain prompt when the user taps or the Host reconnects", async () => {
    const host = conversationHost();
    host.replyToPrompt(async () => {
      throw new Error("Response lost after dispatch");
    });
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const view = runtime.openConversation(host.ids[0], null);
      await vi.waitFor(() => expect(view.session.getSnapshot().openState).toBe("open"));
      view.prompt.setText("Possibly accepted");
      expect(await view.prompt.send()).toBe(false);
      expect(view.prompt.getSnapshot()).toMatchObject({
        text: "Possibly accepted",
        canSend: false,
        submission: { kind: "unknown" },
      });
      view.prompt.setText("A replacement cannot hide uncertainty");
      expect(await view.prompt.send()).toBe(false);
      const generation = runtime.connection.generation.getSnapshot();
      runtime.connection.reconnect();
      await vi.waitFor(() => {
        expect(runtime.connection.generation.getSnapshot()).not.toBeUndefined();
        expect(runtime.connection.generation.getSnapshot()).not.toBe(generation);
      });
      expect(view.prompt.getSnapshot()).toMatchObject({
        text: "Possibly accepted",
        canSend: false,
        submission: { kind: "unknown" },
      });
      expect(host.prompts).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });

  it.each(["live history", "reconnect history", "queue"])(
    "confirms a lost reply from exact %s evidence without resending",
    async (evidence) => {
      const host = conversationHost();
      host.replyToPrompt(async () => {
        throw new Error("Reply lost");
      });
      const runtime = await createDshHostRuntime(host.options);
      try {
        await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
        const view = runtime.openConversation(host.ids[0], null);
        await vi.waitFor(() => expect(view.session.getSnapshot().openState).toBe("open"));
        view.prompt.setText("Possibly accepted");
        expect(await view.prompt.send()).toBe(false);
        const requestId = host.prompts[0]!.requestId;
        expect(view.prompt.getSnapshot().submission.kind).toBe("unknown");
        if (evidence === "live history") {
          host.push(admittedPrompt("another-request"));
          expect(view.prompt.getSnapshot().submission.kind).toBe("unknown");
          host.push(admittedPrompt(requestId, 2));
        } else if (evidence === "reconnect history") {
          host.admitOnReconnect(requestId);
          runtime.connection.reconnect();
        } else {
          host.control({
            type: "queue",
            sessionId: host.ids[0],
            items: [
              {
                id: "queued-prompt",
                placement: "queued",
                rpcId: requestId,
                message: {
                  id: "queued-prompt",
                  content: [{ type: "text", text: "Possibly accepted" }],
                },
              },
            ],
          });
        }
        await vi.waitFor(() =>
          expect(view.prompt.getSnapshot()).toMatchObject({
            text: "",
            submission: { kind: "accepted" },
            canSend: false,
          }),
        );
        expect(host.prompts).toHaveLength(1);
      } finally {
        await runtime.dispose();
      }
    },
  );

  it.each(["before", "after"])(
    "retains an edited draft when evidence arrives %s a lost reply",
    async (timing) => {
      const host = conversationHost();
      let loseReply: (error: Error) => void = () => {
        throw new Error("No pending request");
      };
      host.replyToPrompt(
        () =>
          new Promise((_resolve, reject) => {
            loseReply = reject;
          }),
      );
      const runtime = await createDshHostRuntime(host.options);
      try {
        await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
        const view = runtime.openConversation(host.ids[0], null);
        await vi.waitFor(() => expect(view.session.getSnapshot().openState).toBe("open"));
        view.prompt.setText("Possibly accepted");
        const pending = view.prompt.send();
        await vi.waitFor(() => expect(host.prompts).toHaveLength(1));
        view.prompt.setText("Changed");
        view.prompt.setText("Possibly accepted");
        if (timing === "before") {
          host.push(admittedPrompt(host.prompts[0]!.requestId));
          await vi.waitFor(() => expect(hasFixtureAdmission(runtime, host.ids[0])).toBe(true));
        }
        loseReply(new Error("Reply lost"));
        expect(await pending).toBe(timing === "before");
        if (timing === "after") host.push(admittedPrompt(host.prompts[0]!.requestId));
        await vi.waitFor(() =>
          expect(view.prompt.getSnapshot()).toMatchObject({
            text: "Possibly accepted",
            submission: { kind: "accepted" },
            canSend: true,
          }),
        );
        expect(host.prompts).toHaveLength(1);
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("releases an uncertain observer when another conversation opens", async () => {
    const host = conversationHost();
    host.replyToPrompt(async () => {
      throw new Error("Reply lost");
    });
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const first = runtime.openConversation(host.ids[0], null);
      await vi.waitFor(() => expect(first.session.getSnapshot().openState).toBe("open"));
      first.prompt.setText("Possibly accepted");
      await first.prompt.send();
      const second = runtime.openConversation(host.ids[1], null);
      await vi.waitFor(() => expect(second.session.getSnapshot().openState).toBe("open"));
      second.prompt.setText("Independent draft");
      host.push(admittedPrompt(host.prompts[0]!.requestId));
      expect(first.prompt.getSnapshot()).toMatchObject({
        text: "Possibly accepted",
        submission: { kind: "unknown" },
        canSend: false,
      });
      expect(second.prompt.getSnapshot()).toMatchObject({
        text: "Independent draft",
        submission: { kind: "idle" },
        canSend: true,
      });
      expect(host.prompts).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });

  it("aborts the owned request on view replacement and ignores its late success", async () => {
    const host = conversationHost();
    let reply: (value: unknown) => void = () => {
      throw new Error("No prompt is pending");
    };
    let aborted = false;
    const onAbort = () => {
      aborted = true;
    };
    host.replyToPrompt(
      (signal) =>
        new Promise((resolve) => {
          reply = resolve;
          signal?.addEventListener("abort", onAbort, { once: true });
        }),
    );
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const first = runtime.openConversation(host.ids[0], null);
      first.prompt.setText("Wait for loaded history");
      expect(first.prompt.getSnapshot().canSend).toBe(false);
      await first.prompt.send();
      expect(host.prompts).toHaveLength(0);
      await vi.waitFor(() => expect(first.session.getSnapshot().openState).toBe("open"));
      const pending = first.prompt.send();
      await vi.waitFor(() => expect(host.prompts).toHaveLength(1));
      const second = runtime.openConversation(host.ids[1], null);
      second.prompt.setText("Independent replacement draft");
      expect(aborted).toBe(true);
      reply({ ok: true, value: { accepted: true } });
      expect(await pending).toBe(false);
      expect(first.prompt.getSnapshot().canSend).toBe(false);
      first.prompt.setText("Closed form");
      await first.prompt.send();
      expect(first.prompt.getSnapshot().text).toBe("Wait for loaded history");
      expect(second.prompt.getSnapshot().text).toBe("Independent replacement draft");
      expect(host.prompts).toHaveLength(1);
      expect(host.calls).not.toContain("session/cancel");
    } finally {
      await runtime.dispose();
    }
  });
  it("preserves a draft edited back to its submitted text while acceptance is pending", async () => {
    const host = conversationHost();
    let reply: (value: unknown) => void = () => {
      throw new Error("No prompt is pending");
    };
    host.replyToPrompt(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const view = runtime.openConversation(host.ids[0], null);
      await vi.waitFor(() => expect(view.session.getSnapshot().openState).toBe("open"));
      view.prompt.setText("Original");
      const pending = view.prompt.send();
      await vi.waitFor(() => expect(host.prompts).toHaveLength(1));
      view.prompt.setText("Edited");
      view.prompt.setText("Original");
      reply({ ok: true, value: { accepted: true } });
      await pending;
      expect(view.prompt.getSnapshot()).toMatchObject({
        text: "Original",
        canSend: true,
        submission: { kind: "accepted" },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("retains the uncertain submitted text separately from a newer draft", async () => {
    const host = conversationHost();
    let reject: (error: Error) => void = () => {
      throw new Error("No prompt is pending");
    };
    host.replyToPrompt(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      const view = runtime.openConversation(host.ids[0], null);
      await vi.waitFor(() => expect(view.session.getSnapshot().openState).toBe("open"));
      view.prompt.setText("Possibly received");
      const pending = view.prompt.send();
      await vi.waitFor(() => expect(host.prompts).toHaveLength(1));
      view.prompt.setText("A newer unsent draft");
      reject(new Error("Response lost"));
      expect(await pending).toBe(false);
      expect(view.prompt.getSnapshot()).toMatchObject({
        text: "A newer unsent draft",
        canSend: false,
        submission: { kind: "unknown", text: "Possibly received" },
      });
      await view.prompt.send();
      expect(host.prompts).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });
});

describe("native DSH pending interactions", () => {
  it("answers a scoped approval through the installed Remote event transport", async () => {
    const host = conversationHost();
    const runtime = await createDshHostRuntime(host.options);
    try {
      await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
      host.event({
        type: "waterfall",
        event: "approval/request",
        eventId: "approval-one",
        agentId: host.ids[1],
        request: { toolName: "shell", reason: "Run tests" },
      });
      await vi.waitFor(() =>
        expect(runtime.pending.getSnapshot().get(host.ids[1])?.kind).toBe("approval"),
      );
      const approval = runtime.pending.getSnapshot().get(host.ids[1]);
      if (approval?.kind !== "approval") throw new Error("Missing approval");
      expect(runtime.pending.getSnapshot().has(host.ids[0])).toBe(false);
      expect(approval.reason).toBe("Run tests");
      await approval.answer("allowed-once");
      await vi.waitFor(() =>
        expect(host.eventResults).toEqual([
          {
            clientId: "native-test",
            eventId: "approval-one",
            outcome: { kind: "result", value: "allowed-once" },
          },
        ]),
      );
      expect(runtime.pending.getSnapshot().size).toBe(0);
    } finally {
      await runtime.dispose();
    }
  });
});

it("preserves question identity beneath plan precedence and returns every answer", async () => {
  const host = conversationHost();
  const runtime = await createDshHostRuntime(host.options);
  try {
    await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
    host.event({
      type: "waterfall",
      event: "user-questions/request",
      eventId: "question",
      agentId: host.ids[0],
      request: {
        questions: [
          { id: "a", question: "First?" },
          { id: "b", question: "Second?" },
        ],
      },
    });
    await vi.waitFor(() =>
      expect(runtime.pending.getSnapshot().get(host.ids[0])?.kind).toBe("question"),
    );
    const question = runtime.pending.getSnapshot().get(host.ids[0]);
    if (question?.kind !== "question") throw new Error("Missing question");
    host.event({
      type: "waterfall",
      event: "approval/request",
      eventId: "approval",
      agentId: host.ids[0],
      request: { toolName: "read" },
    });
    host.event({
      type: "waterfall",
      event: "user-questions/request",
      eventId: "plan",
      agentId: host.ids[0],
      request: {
        questions: [
          {
            id: "p",
            question: "Review?",
            detail: "Plan",
            options: [{ label: "No" }, { label: "Yes" }],
            intent: { kind: "plan-review", approve: "Yes" },
          },
        ],
      },
    });
    await vi.waitFor(() =>
      expect(runtime.pending.getSnapshot().get(host.ids[0])?.kind).toBe("plan-review"),
    );
    const plan = runtime.pending.getSnapshot().get(host.ids[0]);
    if (plan?.kind !== "plan-review") throw new Error("Missing plan");
    await plan.answer({ answers: [{ id: "p", selected: ["Yes"] }] });
    await vi.waitFor(() => expect(runtime.pending.getSnapshot().get(host.ids[0])).toBe(question));
    await question.answer({
      answers: [
        { id: "a", selected: [], custom: "Text" },
        { id: "b", selected: [] },
      ],
    });
    await vi.waitFor(() =>
      expect(runtime.pending.getSnapshot().get(host.ids[0])?.kind).toBe("approval"),
    );
    const approval = runtime.pending.getSnapshot().get(host.ids[0]);
    if (approval?.kind !== "approval") throw new Error("Missing approval");
    await approval.answer("rejected");
    await vi.waitFor(() => expect(host.eventResults).toHaveLength(3));
    expect(host.eventResults).toEqual([
      {
        clientId: "native-test",
        eventId: "plan",
        outcome: { kind: "result", value: { answers: [{ id: "p", selected: ["Yes"] }] } },
      },
      {
        clientId: "native-test",
        eventId: "question",
        outcome: {
          kind: "result",
          value: {
            answers: [
              { id: "a", selected: [], custom: "Text" },
              { id: "b", selected: [] },
            ],
          },
        },
      },
      {
        clientId: "native-test",
        eventId: "approval",
        outcome: { kind: "result", value: "rejected" },
      },
    ]);
    expect(runtime.pending.getSnapshot().size).toBe(0);
  } finally {
    await runtime.dispose();
  }
});

it("withdraws a Host-cancelled question and never sends its late answer", async () => {
  const host = conversationHost();
  const runtime = await createDshHostRuntime(host.options);
  try {
    await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
    host.event({
      type: "waterfall",
      event: "user-questions/request",
      eventId: "cancel",
      agentId: host.ids[0],
      request: { questions: [{ id: "q", question: "Answer?" }] },
    });
    await vi.waitFor(() => expect(runtime.pending.getSnapshot().size).toBe(1));
    const question = runtime.pending.getSnapshot().get(host.ids[0]);
    if (question?.kind !== "question") throw new Error("Missing question");
    host.event({ type: "cancel", eventId: "cancel" });
    await vi.waitFor(() => expect(runtime.pending.getSnapshot().size).toBe(0));
    await expect(
      question.answer({ answers: [{ id: "q", selected: [], custom: "Late" }] }),
    ).rejects.toThrow("already settled");
    expect(host.eventResults).toEqual([]);
  } finally {
    await runtime.dispose();
  }
});

it("sends explicit question cancellation as a rejected waterfall result", async () => {
  const host = conversationHost();
  const runtime = await createDshHostRuntime(host.options);
  try {
    await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
    host.event({
      type: "waterfall",
      event: "user-questions/request",
      eventId: "cancel",
      agentId: host.ids[0],
      request: { questions: [{ id: "q", question: "Answer?" }] },
    });
    await vi.waitFor(() => expect(runtime.pending.getSnapshot().size).toBe(1));
    const question = runtime.pending.getSnapshot().get(host.ids[0]);
    if (question?.kind !== "question") throw new Error("Missing question");
    await question.cancel();
    await vi.waitFor(() => expect(host.eventResults).toHaveLength(1));
    expect(host.eventResults[0]).toMatchObject({
      eventId: "cancel",
      outcome: { kind: "rejected", error: { code: "ASK_CANCELLED" } },
    });
  } finally {
    await runtime.dispose();
  }
});

it("withdraws unanswered requests on generation loss and final disposal", async () => {
  const host = conversationHost();
  const runtime = await createDshHostRuntime(host.options);
  try {
    await vi.waitFor(() => expect(runtime.sessions.list.getSnapshot().phase).toBe("ready"));
    host.event({
      type: "waterfall",
      event: "approval/request",
      eventId: "lost",
      agentId: host.ids[0],
      request: { toolName: "shell" },
    });
    await vi.waitFor(() => expect(runtime.pending.getSnapshot().size).toBe(1));
    const request = runtime.pending.getSnapshot().get(host.ids[0]);
    if (request?.kind !== "approval") throw new Error("Missing approval");
    host.disconnect();
    await vi.waitFor(() => expect(runtime.pending.getSnapshot().size).toBe(0));
    await expect(request.answer("allowed-once")).rejects.toThrow("already settled");
    expect(host.eventResults).toEqual([]);
  } finally {
    await runtime.dispose();
  }
  expect(runtime.pending.getSnapshot().size).toBe(0);
});

it("isolates two Hosts and releases unanswered requests when one closes", async () => {
  const first = conversationHost();
  const second = conversationHost();
  const one = await createDshHostRuntime(first.options);
  const two = await createDshHostRuntime(second.options);
  try {
    await vi.waitFor(() => expect(one.sessions.list.getSnapshot().phase).toBe("ready"));
    await vi.waitFor(() => expect(two.sessions.list.getSnapshot().phase).toBe("ready"));
    const frame = {
      type: "waterfall",
      event: "approval/request",
      eventId: "separate",
      agentId: first.ids[0],
      request: { toolName: "shell" },
    };
    first.event(frame);
    second.event(frame);
    await vi.waitFor(() => expect(one.pending.getSnapshot().size).toBe(1));
    await vi.waitFor(() => expect(two.pending.getSnapshot().size).toBe(1));
    const other = two.pending.getSnapshot().get(second.ids[0]);
    expect(one.pending.getSnapshot().get(first.ids[0])).not.toBe(other);
    await one.dispose();
    expect(one.pending.getSnapshot().size).toBe(0);
    expect(two.pending.getSnapshot().get(second.ids[0])).toBe(other);
    if (other?.kind !== "approval") throw new Error("Missing independent approval");
    await other.answer("allowed-once");
    await vi.waitFor(() => expect(second.eventResults).toHaveLength(1));
    expect(first.calls).not.toContain("session/cancel");
  } finally {
    await one.dispose();
    await two.dispose();
  }
});
