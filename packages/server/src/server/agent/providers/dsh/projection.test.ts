import { describe, expect, it } from "vitest";
import { DshProjection } from "./projection.js";

describe("DSH transcript projection", () => {
  it("restores a compact live baseline and skips the prefix already received", () => {
    const projection = new DshProjection("session-1");
    const baseline = {
      activeAttempt: {
        attemptId: "attempt-1",
        turn: 1,
        step: 1,
        nextIndex: 2,
        stream: [{ type: "text-chunks", index: 0, time0: 1000, dt: [3], texts: ["Hel", "lo"] }],
      },
    };
    expect(
      projection
        .restoreStream(baseline)
        .flatMap((event) =>
          event.type === "timeline" && event.item.type === "assistant_message"
            ? [event.item.text]
            : [],
        ),
    ).toEqual(["Hel", "lo"]);
    expect(projection.restoreStream(baseline)).toEqual([]);
  });
  it("preserves native message identity and only echoes human input", () => {
    const projection = new DshProjection("session-1");
    expect(
      projection.accept({
        type: "user/message",
        seq: 0,
        time: 1000,
        data: {
          id: "message-1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
          source: { type: "user-rpc", kind: "user", rpcId: "phone-1" },
        },
      }),
    ).toEqual([
      {
        type: "timeline",
        provider: "dsh",
        timestamp: "1970-01-01T00:00:01.000Z",
        item: { type: "user_message", text: "Hello", messageId: "message-1" },
      },
    ]);
    expect(
      projection.accept({
        type: "user/message",
        seq: 1,
        time: 1001,
        data: {
          id: "context-1",
          role: "user",
          content: [{ type: "text", text: "Injected context" }],
          source: { type: "context", kind: "context" },
        },
      }),
    ).toEqual([]);
  });

  it("does not duplicate streamed text when the committed message arrives", () => {
    const projection = new DshProjection("session-1");
    projection.accept({ type: "turn/start", seq: 0, time: 1000, data: { turn: 1 } });
    projection.acceptStream({ type: "start", attemptId: "attempt-1", turn: 1, step: 1 });
    expect(
      projection
        .acceptStream({
          type: "chunk",
          attemptId: "attempt-1",
          index: 0,
          chunk: { type: "text-delta", index: 0, text: "Hel" },
        })
        .map((event) => event.type),
    ).toEqual(["timeline"]);
    expect(
      projection.accept({
        type: "assistant/message",
        seq: 1,
        time: 1001,
        data: {
          turn: 1,
          step: 1,
          message: { id: "answer-1", content: [{ type: "text", text: "Hello" }] },
        },
      }),
    ).toEqual([
      {
        type: "timeline",
        provider: "dsh",
        turnId: "session-1:1",
        timestamp: "1970-01-01T00:00:01.001Z",
        item: { type: "assistant_message", text: "lo", messageId: "attempt-1" },
      },
    ]);
  });

  it("reports native cancellation instead of success", () => {
    const projection = new DshProjection("session-1");
    expect(
      projection.accept({
        type: "turn/end",
        seq: 0,
        time: 1000,
        data: { turn: 2, reason: { kind: "aborted", reason: { kind: "user" } } },
      }),
    ).toEqual([
      { type: "turn_canceled", provider: "dsh", turnId: "session-1:2", reason: "aborted" },
    ]);
  });
});
