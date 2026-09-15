import { expect, test } from "vitest";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { DshInteractions, questionAnswer } from "./interactions.js";
import { DshTestTransport } from "./test-transport.js";
import type { DshWaterfall } from "./wire.js";

const approval: DshWaterfall = {
  type: "waterfall",
  event: "approval/request",
  eventId: "approval-1",
  agentId: "session-1",
  request: { toolName: "bash", callId: "call-1", reason: "Write the requested file" },
};

test("an approval answered on another device cannot be answered again", async () => {
  const transport = new DshTestTransport();
  const interactions = new DshInteractions(transport, 100);
  const events: AgentStreamEvent[] = [];
  await interactions.register("session-1", (event) => events.push(event));
  try {
    transport.send("$events", approval);
    expect(interactions.list("session-1").map((request) => request.id)).toEqual(["approval-1"]);
    transport.send("$events", { type: "cancel", eventId: "approval-1" });
    await expect(
      interactions.respond("session-1", "approval-1", { behavior: "allow" }),
    ).rejects.toThrow("expired or was answered");
    expect(events.map((event) => event.type)).toEqual([
      "permission_requested",
      "permission_resolved",
    ]);
    expect(transport.requests).toEqual([]);
  } finally {
    interactions.close();
  }
});

test("approval grants only this call and unrelated sessions are delegated", async () => {
  const transport = new DshTestTransport();
  const interactions = new DshInteractions(transport, 100);
  await interactions.register("session-1", () => {});
  try {
    transport.send("$events", { ...approval, agentId: "another-session", eventId: "unattached" });
    transport.send("$events", approval);
    await interactions.respond("session-1", "approval-1", { behavior: "allow" });
    expect(transport.requests).toEqual([
      {
        endpoint: "$events/result",
        args: { clientId: "client-1", eventId: "unattached", outcome: { kind: "next" } },
      },
      {
        endpoint: "$events/result",
        args: {
          clientId: "client-1",
          eventId: "approval-1",
          outcome: { kind: "result", value: "allowed-once" },
        },
      },
    ]);
    expect(interactions.list("session-1")).toEqual([]);
  } finally {
    interactions.close();
  }
});

test("structured multi-select answers retain comma-containing labels", () => {
  const question: DshWaterfall = {
    ...approval,
    event: "user-questions/request",
    request: {
      questions: [
        {
          id: "choice",
          question: "Choose",
          multiSelect: true,
          options: [{ label: "A, B" }, { label: "C" }],
        },
      ],
    },
  };
  expect(
    questionAnswer(question, { structuredAnswers: { choice: { selected: ["A, B", "C"] } } }),
  ).toEqual({
    answers: [{ id: "choice", selected: ["A, B", "C"] }],
  });
  expect(() =>
    questionAnswer(question, { structuredAnswers: { choice: { selected: ["A"] } } }),
  ).toThrow("do not match");
});
