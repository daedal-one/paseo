import { describe, expect, test } from "vitest";
import { z } from "zod";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { DshConfigSchema } from "./connection.js";
import { DshInteractions } from "./interactions.js";
import { DshSession } from "./session.js";
import { DshTestTransport } from "./test-transport.js";

const config = DshConfigSchema.parse({ url: "http://127.0.0.1:3080", reconnectDelayMs: 100 });
const record = (seq: number, type: string, data: unknown) => ({
  type: "event",
  event: { seq, type, data, time: 1000 },
});
const user = (rpcId: string) => ({
  id: "message-1",
  content: [{ type: "text", text: "Hello" }],
  source: { kind: "user", rpcId },
});
const snapshot = (records: unknown[], cursor: number, hasMore = false) => ({
  type: "snapshot",
  header: { id: "session-1", version: 3, cwd: "/workspace" },
  cursor,
  records,
  hasMore,
  projections: { asOfSeq: cursor, values: {} },
});

async function attach(transport: DshTestTransport) {
  const interactions = new DshInteractions(transport, config.reconnectDelayMs);
  const session = new DshSession("session-1", "/workspace", transport, interactions, config);
  await session.initialize();
  return {
    session,
    close: async () => {
      await session.close();
      interactions.close();
    },
  };
}

describe("DSH existing sessions", () => {
  test("loads older history and detaches without canceling the host session", async () => {
    const transport = new DshTestTransport();
    transport.initial = (endpoint) =>
      endpoint === "$events"
        ? { type: "ready", clientId: "client-1" }
        : snapshot([record(2, "turn/end", { turn: 1, reason: { kind: "completed" } })], 2, true);
    transport.respond = () => ({
      records: [record(0, "turn/start", { turn: 1 }), record(1, "user/message", user("external"))],
      hasMore: false,
    });
    const attached = await attach(transport);
    try {
      const events = [];
      for await (const event of attached.session.streamHistory()) events.push(event);
      expect(events.map((event) => event.type)).toEqual([
        "turn_started",
        "timeline",
        "turn_completed",
      ]);
      expect(transport.requests).toEqual([
        {
          endpoint: "session/page",
          args: {
            request: {
              address: { kind: "session", sessionId: "session-1" },
              throughSeq: 2,
              beforeSeq: 2,
              maxMessages: 50,
            },
          },
        },
      ]);
    } finally {
      await attached.close();
    }
    expect(transport.closedStreams).toEqual(["session/follow", "$events"]);
    expect(transport.requests.map((request) => request.endpoint)).toEqual(["session/page"]);
  });

  test("confirms the native turn even when a pre-step rejection emits no user message", async () => {
    const transport = new DshTestTransport();
    transport.initial = (endpoint) =>
      endpoint === "$events" ? { type: "ready", clientId: "client-1" } : snapshot([], -1);
    transport.respond = ({ endpoint, args }) => {
      if (endpoint !== "session/prompt") throw new Error(`Unexpected ${endpoint}`);
      const { request } = z.object({ request: z.object({ requestId: z.string() }) }).parse(args);
      transport.send(
        "session/follow",
        record(0, "agent/inbox/spliced", {
          target: "next-turn",
          start: 0,
          inserted: [user(request.requestId)],
        }),
      );
      transport.send("session/follow", record(1, "turn/start", { turn: 1 }));
      transport.send(
        "session/follow",
        record(2, "agent/inbox/spliced", {
          target: "next-turn",
          start: 0,
          removedCount: 1,
          inserted: [],
        }),
      );
      transport.send(
        "session/follow",
        record(3, "turn/end", { turn: 1, reason: { kind: "blocked" } }),
      );
      return { accepted: true };
    };
    const attached = await attach(transport);
    try {
      expect(await attached.session.startTurn("Hello")).toEqual({ turnId: "session-1:1" });
      expect(transport.requests.map((request) => request.endpoint)).toEqual(["session/prompt"]);
    } finally {
      await attached.close();
    }
  });

  test("reconnects across overlapping history without duplicating messages", async () => {
    const transport = new DshTestTransport();
    let reconnect = false;
    transport.initial = (endpoint) =>
      endpoint === "$events"
        ? { type: "ready", clientId: "client-1" }
        : snapshot(
            reconnect
              ? [
                  record(0, "user/message", user("external")),
                  record(1, "user/message", { ...user("second"), id: "message-2" }),
                ]
              : [record(0, "user/message", user("external"))],
            reconnect ? 1 : 0,
          );
    const attached = await attach(transport);
    try {
      const events: AgentStreamEvent[] = [];
      const caughtUp = new Promise<void>((resolve) =>
        attached.session.subscribe((event) => {
          events.push(event);
          if (event.type === "timeline" && event.item.type === "user_message") resolve();
        }),
      );
      reconnect = true;
      transport.streams.get("session/follow")!.error(new Error("offline"));
      await caughtUp;
      const messages = events.flatMap((event) =>
        event.type === "timeline" && event.item.type === "user_message"
          ? [event.item.messageId]
          : [],
      );
      expect(messages).toEqual(["message-2"]);
    } finally {
      await attached.close();
    }
  });
});
