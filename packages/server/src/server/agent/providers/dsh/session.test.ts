import { describe, expect, test, vi } from "vitest";
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
  test("closing during the initial snapshot settles initialization without leaving a timer", async () => {
    vi.useFakeTimers();
    const transport = new DshTestTransport();
    let followOpened!: () => void;
    const opened = new Promise<void>((resolve) => {
      followOpened = resolve;
    });
    transport.opened = (endpoint) => {
      if (endpoint === "session/follow") followOpened();
    };
    const interactions = new DshInteractions(transport, 100);
    const session = new DshSession("session-1", "/workspace", transport, interactions, config);
    const initializing = expect(session.initialize()).rejects.toThrow("DSH companion detached");
    try {
      await opened;
      await session.close();
      await initializing;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await session.close();
      interactions.close();
      vi.useRealTimers();
    }
  });

  test("answers a pending question while transcript recovery is unavailable", async () => {
    const transport = new DshTestTransport();
    transport.initial = (endpoint) =>
      endpoint === "$events" ? { type: "ready", clientId: "client-1" } : snapshot([], -1);
    const attached = await attach(transport);
    try {
      transport.streams.get("session/follow")!.error(new Error("Transcript unavailable"));
      transport.send("$events", {
        type: "waterfall",
        event: "user-questions/request",
        eventId: "question",
        agentId: "session-1",
        request: {
          questions: [{ id: "choice", question: "Continue?", options: [{ label: "Yes" }] }],
        },
      });
      await attached.session.respondToPermission("question", {
        behavior: "allow",
        updatedInput: { structuredAnswers: { choice: { selected: ["Yes"] } } },
      });
      expect(transport.requests).toEqual([
        {
          endpoint: "$events/result",
          args: {
            clientId: "client-1",
            eventId: "question",
            outcome: {
              kind: "result",
              value: {
                answers: [{ id: "choice", selected: ["Yes"] }],
              },
            },
          },
        },
      ]);
    } finally {
      await attached.close();
    }
  });

  test("ignores frames from a dropped subscription and retains confirmed history", async () => {
    vi.useFakeTimers();
    const transport = new DshTestTransport();
    transport.initial = (endpoint) =>
      endpoint === "$events"
        ? { type: "ready", clientId: "client-1" }
        : snapshot([record(0, "user/message", user("external"))], 0);
    const attached = await attach(transport);
    try {
      const stale = transport.streams.get("session/follow")!;
      stale.error(new Error("offline"));
      await vi.advanceTimersByTimeAsync(100);
      stale.value(record(1, "user/message", { ...user("stale"), id: "stale" }));
      stale.error(new Error("late socket error"));
      await vi.advanceTimersByTimeAsync(0);
      const history = [];
      for await (const event of attached.session.streamHistory()) history.push(event);
      expect(
        history.flatMap((event) =>
          event.type === "timeline" && event.item.type === "user_message"
            ? [event.item.messageId]
            : [],
        ),
      ).toEqual(["message-1"]);
      expect((await attached.session.getRuntimeInfo()).extra.connection).toBe("connected");
    } finally {
      await attached.close();
      vi.useRealTimers();
    }
  });

  test("backs off failed transcript reconnects and releases the retry on close", async () => {
    vi.useFakeTimers();
    const transport = new DshTestTransport();
    transport.initial = (endpoint) =>
      endpoint === "$events" ? { type: "ready", clientId: "client-1" } : snapshot([], -1);
    const attached = await attach(transport);
    try {
      let attempts = 0;
      transport.initial = () => null;
      transport.opened = (endpoint) => {
        attempts++;
        transport.streams.get(endpoint)!.error(new Error("offline"));
      };
      transport.streams.get("session/follow")!.error(new Error("offline"));
      await vi.advanceTimersByTimeAsync(100);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(199);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toBe(2);
      await attached.close();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(attempts).toBe(2);
    } finally {
      await attached.close();
      vi.useRealTimers();
    }
  });

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

test("uses Host permission projections for external knob changes and command results", async () => {
  const transport = new DshTestTransport();
  let cut = -1;
  let currentValue = "policy-reviewed";
  const options = [
    { value: "policy-reviewed", name: "Policy reviewed" },
    { value: "read-only", name: "Read only" },
  ];
  transport.initial = (endpoint) =>
    endpoint === "$events"
      ? { type: "ready", clientId: "client" }
      : {
          ...snapshot([], cut),
          projections: { asOfSeq: cut, values: { permissions: { currentValue, options } } },
        };
  const attached = await attach(transport);
  const main = transport.streams.get("session/follow")!;
  try {
    expect(await attached.session.getCurrentMode()).toBe("policy-reviewed");
    currentValue = "custom";
    cut = 0;
    main.value(record(0, "sandbox/mode", { mode: "read-only" }));
    await vi.waitFor(async () => expect(await attached.session.getCurrentMode()).toBe("custom"));
    transport.respond = () => ({ result: { kind: "success" } });
    // A concurrent Host-side change wins over the requested mode.
    currentValue = "read-only";
    cut = 1;
    await attached.session.setMode("policy-reviewed");
    expect(await attached.session.getCurrentMode()).toBe("read-only");
    expect(transport.closedStreams.filter((name) => name === "session/follow")).toHaveLength(2);
    transport.respond = () => ({ result: { kind: "error", text: "Rejected" } });
    await expect(attached.session.setMode("policy-reviewed")).rejects.toThrow("Rejected");
    expect(await attached.session.getCurrentMode()).toBe("read-only");
    await expect(attached.session.setMode("custom")).rejects.toThrow("does not offer");
  } finally {
    await attached.close();
  }
});

test.each(["detach", "timeout"])(
  "closes a late control reader after %s without cancelling the Session",
  async (ending) => {
    vi.useFakeTimers();
    const transport = new DshTestTransport();
    transport.initial = (endpoint) =>
      endpoint === "$events"
        ? { type: "ready", clientId: "client" }
        : {
            ...snapshot([], -1),
            projections: {
              asOfSeq: -1,
              values: {
                permissions: {
                  currentValue: "read-only",
                  options: [{ value: "read-only", name: "Read only" }],
                },
              },
            },
          };
    const attached = await attach(transport);
    let finishOpen!: (reader: { close: () => void }) => void;
    let started!: () => void;
    const opened = new Promise<void>((resolve) => {
      started = resolve;
    });
    const closeReader = vi.fn();
    transport.respond = () => ({ result: { kind: "success" } });
    transport.open = () =>
      new Promise((resolve) => {
        finishOpen = resolve;
        started();
      });
    const changing = expect(attached.session.setMode("read-only")).rejects.toThrow(
      ending === "detach" ? "detached" : "timed out",
    );
    try {
      await opened;
      if (ending === "detach") await attached.close();
      else await vi.advanceTimersByTimeAsync(config.requestTimeoutMs);
      await changing;
      finishOpen({ close: closeReader });
      await Promise.resolve();
      expect(closeReader).toHaveBeenCalledTimes(1);
      expect(transport.requests.map((request) => request.endpoint)).toEqual(["commands/execute"]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await attached.close();
      vi.useRealTimers();
    }
  },
);
