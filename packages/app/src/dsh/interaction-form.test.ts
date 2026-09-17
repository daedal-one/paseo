import { describe, expect, it } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import { PendingQuestion, PendingApproval, type SessionId } from "@deepseek-ai/dsh-client";
import { DshInteractionForm } from "./interaction-form";

const sessionId = brandString<SessionId>("question-session");

describe("native DSH interaction form", () => {
  it("submits one whole batch with verbatim labels and an explicit skip", async () => {
    const pending = new PendingQuestion(sessionId, [
      {
        id: "first",
        question: "Choose",
        options: [{ label: "One (Recommended)" }, { label: "Two" }],
      },
      { id: "second", question: "Explain" },
    ]);
    const form = new DshInteractionForm(pending);
    expect(form.getSnapshot().canSubmit).toBe(false);
    form.select(0, "One (Recommended)");
    expect(form.getSnapshot().canSubmit).toBe(false);
    form.skip(1);
    expect(form.getSnapshot().canSubmit).toBe(true);
    expect(await form.submit()).toBe(true);
    expect(await pending.result).toEqual({
      answers: [
        { id: "first", selected: ["One (Recommended)"] },
        { id: "second", selected: [] },
      ],
    });
    expect(form.getSnapshot().status).toBe("settled");
    expect(await form.submit()).toBe(false);
  });
});

it("keeps multiple choices with custom text and replaces a single choice with text", async () => {
  const request = new PendingQuestion(sessionId, [
    {
      id: "multi",
      question: "Which",
      multiSelect: true,
      options: [{ label: "A" }, { label: "B" }],
    },
    { id: "single", question: "Which", options: [{ label: "A" }] },
  ]);
  const form = new DshInteractionForm(request);
  form.select(0, "A");
  form.select(0, "B");
  form.select(0, "A");
  form.setText(0, "  Extra  ");
  form.select(1, "A");
  form.setText(1, "Different");
  expect(await form.submit()).toBe(true);
  expect(await request.result).toEqual({
    answers: [
      { id: "multi", selected: ["B"], custom: "Extra" },
      { id: "single", selected: [], custom: "Different" },
    ],
  });
});

it("revokes a skip when edited and clears custom text when a single option is selected", () => {
  const request = new PendingQuestion(sessionId, [
    { id: "one", question: "Answer", options: [{ label: "Choice" }] },
  ]);
  const form = new DshInteractionForm(request);
  form.skip(0);
  expect(form.getSnapshot().canSubmit).toBe(true);
  form.setText(0, "   ");
  expect(form.getSnapshot().canSubmit).toBe(false);
  form.setText(0, "Draft");
  form.select(0, "Choice");
  expect(form.getSnapshot().drafts).toEqual([{ selected: ["Choice"], custom: "", skipped: false }]);
});

it.each(["allowed-once", "rejected"] as const)(
  "settles an approval once with %s",
  async (decision) => {
    const request = new PendingApproval(sessionId, { toolName: "shell" });
    const form = new DshInteractionForm(request);
    const first = form.approve(decision);
    expect(form.getSnapshot().status).toBe("settling");
    expect(await form.approve(decision)).toBe(false);
    expect(await first).toBe(true);
    expect(await request.result).toBe(decision);
  },
);

it("uses the asker's plan labels even when approval is the second option", async () => {
  const request = new PendingQuestion(sessionId, [
    {
      id: "plan",
      question: "Review",
      detail: "Plan body",
      options: [{ label: "Revise" }, { label: "Proceed" }],
      intent: { kind: "plan-review", approve: "Proceed" },
    },
  ]);
  const form = new DshInteractionForm(request);
  expect(request.kind).toBe("plan-review");
  form.select(0, "Proceed");
  expect(await form.submit()).toBe(true);
  expect(await request.result).toEqual({ answers: [{ id: "plan", selected: ["Proceed"] }] });
});

it("cancels through the shared carrier and prevents a second settlement", async () => {
  const request = new PendingQuestion(sessionId, [{ id: "one", question: "Answer" }]);
  const result = expect(request.result).rejects.toMatchObject({ code: "ASK_CANCELLED" });
  const form = new DshInteractionForm(request);
  expect(await form.cancel()).toBe(true);
  await result;
  expect(await form.cancel()).toBe(false);
});

it("retains a failed answer draft and never retries a cancelled carrier", async () => {
  const controller = new AbortController();
  const request = new PendingQuestion(
    sessionId,
    [{ id: "one", question: "Answer" }],
    controller.signal,
  );
  const ended = expect(request.result).rejects.toMatchObject({ code: "ASK_ABORTED" });
  const form = new DshInteractionForm(request);
  form.setText(0, "Retained");
  controller.abort();
  await ended;
  expect(await form.submit()).toBe(false);
  expect(form.getSnapshot()).toMatchObject({
    status: "failed",
    canSubmit: false,
    drafts: [{ custom: "Retained" }],
  });
  form.setText(0, "Late edit");
  expect(form.getSnapshot().drafts[0].custom).toBe("Retained");
  expect(await form.submit()).toBe(false);
});
