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
function conversationHost() {
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
  const streams = new Map<string, string>();
  const listeners = new Map<string, Set<(event: { readonly data: unknown }) => void>>();
  const once = new Set<(event: { readonly data: unknown }) => void>();
  let readyState = 0;
  let failHistory = false;
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
      case "subagents/list":
        value = { entries: [], parentAvailable: true };
        break;
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
              cursor: 0,
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
