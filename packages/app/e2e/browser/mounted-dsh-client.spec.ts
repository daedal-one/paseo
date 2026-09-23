import type { Page, Route } from "@playwright/test";
import { z } from "zod";
import { expect, metroTest as test } from "../support/fixtures";
import {
  attachDshSession,
  createHostSession,
  launchMountedDshHost,
} from "../support/helpers/mounted-dsh-host";

const WIDTHS = [390, 1280];

async function openOnlySession(page: Page, url: string): Promise<string> {
  await page.goto(url);
  await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
  const open = page.locator('[data-testid^="dsh-open-session-"]');
  const testId = await open.getAttribute("data-testid");
  if (testId === null) throw new Error("Missing Session identity");
  await open.click();
  await expect(page.getByTestId("dsh-conversation")).toBeVisible();
  return testId.slice("dsh-open-session-".length);
}

async function expectReachableComposer(page: Page): Promise<void> {
  const send = await page.getByTestId("dsh-prompt-send").boundingBox();
  expect(send).not.toBeNull();
  expect(send!.y).toBeGreaterThanOrEqual(0);
  expect(send!.y + send!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

const QUESTION_CALL = "concurrent-question-batch";
const WINNER = {
  answers: [
    { id: "choice", selected: ["First (Recommended)"] },
    { id: "multi", selected: ["Alpha", "Beta"], custom: "winner detail" },
    { id: "skip", selected: [] },
  ],
};

/** Only the model is scripted: the actual Host tool, waterfall and Session log remain live. */
function questionReplay(): string {
  const args = JSON.stringify({
    questions: [
      {
        id: "choice",
        question: "Choose a route?",
        options: [{ label: "First (Recommended)" }, { label: "Second" }],
      },
      {
        id: "multi",
        question: "Which checks?",
        multi_select: true,
        options: [{ label: "Alpha" }, { label: "Beta" }],
      },
      { id: "skip", question: "Optional note?" },
    ],
  });
  const call = { type: "tool-call", id: QUESTION_CALL, name: "ask_user_question", arguments: args };
  return JSON.stringify([
    {
      kind: "chunks",
      chunks: [
        { type: "block-start", index: 0, blockType: "tool-call" },
        {
          type: "tool-call-delta",
          index: 0,
          id: QUESTION_CALL,
          name: "ask_user_question",
          argumentsDelta: args,
        },
        { type: "block-end", index: 0, block: call },
        { type: "finish", reason: { kind: "tool-calls" } },
      ],
    },
    {
      kind: "chunks",
      chunks: [
        { type: "block-start", index: 0, blockType: "text" },
        { type: "text-delta", index: 0, text: "QUESTION_DONE" },
        { type: "block-end", index: 0, block: { type: "text", text: "QUESTION_DONE" } },
        { type: "finish", reason: { kind: "stop" } },
      ],
    },
  ]);
}

const answerSchema = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      selected: z.array(z.string()),
      custom: z.string().optional(),
    }),
  ),
});
const eventAnswerSchema = z.object({
  payload: z.object({
    args: z.object({
      clientId: z.string(),
      eventId: z.string(),
      outcome: z.object({ kind: z.literal("result"), value: answerSchema }),
    }),
  }),
});
const questionResultSchema = z.object({
  type: z.literal("tool/result"),
  data: z.object({
    message: z.object({
      source: z.object({ kind: z.literal("tool"), callId: z.literal(QUESTION_CALL) }),
      content: z.array(
        z.object({
          type: z.literal("tool-result"),
          toolCallId: z.literal(QUESTION_CALL),
          isError: z.boolean(),
          content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
        }),
      ),
    }),
  }),
});

const questionResultIdentity = z.object({
  type: z.literal("tool/result"),
  data: z.object({ message: z.object({ source: z.object({ callId: z.literal(QUESTION_CALL) }) }) }),
});

function questionResults(rows: unknown[]) {
  const candidates = rows.filter((row) => questionResultIdentity.safeParse(row).success);
  return candidates.map((row) => {
    // Identify first, then parse every matching event: malformed duplicates must fail loudly.
    const result = questionResultSchema.parse(row);
    expect(result.data.message.content).toHaveLength(1);
    const block = result.data.message.content[0]!;
    return {
      callId: block.toolCallId,
      isError: block.isError,
      answer: answerSchema.parse(JSON.parse(block.content.map((part) => part.text).join(""))),
    };
  });
}

function observeClientIds(page: Page): string[] {
  const ids: string[] = [];
  const ready = z.object({
    type: z.literal("item"),
    value: z.object({ type: z.literal("ready"), clientId: z.string() }),
  });
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload.toString("utf8");
      const frame = ready.safeParse(JSON.parse(text));
      if (frame.success) ids.push(frame.data.value.clientId);
    });
  });
  return ids;
}

async function openQuestionResult(page: Page): Promise<void> {
  await page
    .getByTestId("dsh-tool-result")
    .getByRole("button", { name: "Load full result", exact: true })
    .click();
  await expect(page.getByTestId("dsh-tool-result")).toContainText("winner detail");
  await expect(page.getByTestId("dsh-tool-result")).not.toContainText("loser detail");
}

async function holdAnswer(page: Page) {
  let capture: (route: Route) => void = () => {
    throw new Error("Answer gate not initialized");
  };
  const request = new Promise<Route>((resolve) => {
    capture = resolve;
  });
  await page.route("**/api/$events/result", (route) => {
    capture(route);
  });
  return { request };
}

function observeAnswers(page: Page, attempts: string[], errors: string[]): void {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/$events/result"))
      attempts.push(request.postData() ?? "");
  });
}

async function answerBatch(page: Page, choice: string, detail: string): Promise<void> {
  await expect(page.getByTestId("dsh-interaction")).toBeVisible();
  await expect(page.getByTestId("dsh-question-submit")).toBeDisabled();
  await page.getByRole("button", { name: choice, exact: true }).click();
  await page.getByRole("button", { name: "Alpha", exact: true }).click();
  await page.getByRole("button", { name: "Beta", exact: true }).click();
  await page.getByTestId("dsh-answer-1").fill(detail);
  await expect(page.getByTestId("dsh-question-submit")).toBeDisabled();
  await page.getByRole("button", { name: "Skip this question", exact: true }).nth(2).click();
  await expect(page.getByTestId("dsh-question-submit")).toBeEnabled();
}

for (const width of WIDTHS) {
  for (const reply of ["delivered", "lost"] as const) {
    test(`concurrent question batch keeps one durable winner with ${reply} reply at ${width}px`, async ({
      browser,
      context,
      page,
    }, testInfo) => {
      test.setTimeout(180_000);
      const winnerClientIds = observeClientIds(page);
      const host = await launchMountedDshHost({ replayOverride: questionReplay() });
      const otherContext = await browser.newContext({ viewport: { width, height: 844 } });
      const attempts: string[] = [];
      const errors: string[] = [];
      try {
        await attachDshSession(context, host.config);
        await attachDshSession(otherContext, host.config);
        await page.setViewportSize({ width, height: 844 });
        observeAnswers(page, attempts, errors);
        await page.goto(host.companionUrl);
        await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
        await createHostSession(page, host.workspaceDir);
        await page.getByTestId("dsh-create-open").click();
        const other = await otherContext.newPage();
        observeAnswers(other, attempts, errors);
        const sessionId = await openOnlySession(other, host.companionUrl);
        await other.getByLabel("Message").fill("Retained unsent composer draft");
        const winnerGate = await holdAnswer(page);
        const loserGate = await holdAnswer(other);
        await page.getByLabel("Message").fill(host.prompt);
        await page.getByTestId("dsh-prompt-send").click();
        await answerBatch(page, "First (Recommended)", "winner detail");
        await answerBatch(other, "Second", "loser detail");
        await page.screenshot({
          path: testInfo.outputPath(`question-${width}-${reply}-pending.png`),
        });
        await Promise.all([
          page.getByTestId("dsh-question-submit").click(),
          other.getByTestId("dsh-question-submit").click(),
        ]);
        const winnerRoute = await winnerGate.request;
        const loserRoute = await loserGate.request;
        const winner = eventAnswerSchema.parse(winnerRoute.request().postDataJSON()).payload.args;
        const loser = eventAnswerSchema.parse(loserRoute.request().postDataJSON()).payload.args;
        expect(winner.eventId).toBe(loser.eventId);
        expect(winner.clientId).not.toBe(loser.clientId);
        expect(winner.outcome.value).toEqual(WINNER);
        expect(loser.outcome.value).toEqual({
          answers: [
            { id: "choice", selected: ["Second"] },
            { id: "multi", selected: ["Alpha", "Beta"], custom: "loser detail" },
            { id: "skip", selected: [] },
          ],
        });

        // Both browser answers are captured before this first Host delivery.
        const response = await winnerRoute.fetch();
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({ result: { ok: true } });
        if (reply === "lost") await winnerRoute.abort("failed");
        else await winnerRoute.fulfill({ response });
        await expect(page.getByText("QUESTION_DONE", { exact: true }).first()).toBeVisible({
          timeout: 60_000,
        });
        const log = await host.readSessionLog();
        expect(log.sessionId).toBe(sessionId);
        expect(questionResults(log.rows)).toEqual([
          { callId: QUESTION_CALL, isError: false, answer: WINNER },
        ]);

        // Host cancellation may abort the losing browser fetch. This controlled late wire
        // delivery sends that captured packet ONCE, independently of its cancelled signal.
        const late = await otherContext.request.post(loserRoute.request().url(), {
          data: loserRoute.request().postData(),
          headers: { "content-type": "application/json", origin: host.config.url },
        });
        expect(late.status()).toBe(200);
        expect(await late.json()).toMatchObject({ result: { ok: true } });
        await loserRoute.abort("failed");
        await expect(page.getByTestId("dsh-interaction")).toHaveCount(0);
        await expect(other.getByTestId("dsh-interaction")).toHaveCount(0);
        await expect(other.getByLabel("Message")).toHaveValue("Retained unsent composer draft");
        await expect(other.getByTestId("dsh-tool-result")).toContainText("winner detail");
        await expect(other.getByTestId("dsh-tool-result")).not.toContainText("loser detail");
        await expectReachableComposer(other);
        expect(winnerClientIds).toContain(winner.clientId);
        await page.unroute("**/api/$events/result");
        expect(await openOnlySession(page, host.companionUrl)).toBe(sessionId);
        await expect.poll(() => winnerClientIds.at(-1)).not.toBe(winner.clientId);
        await openQuestionResult(page);
        await expect(page.getByTestId("dsh-interaction")).toHaveCount(0);
        await other.close();
        const fresh = await otherContext.newPage();
        observeAnswers(fresh, attempts, errors);
        expect(await openOnlySession(fresh, host.companionUrl)).toBe(sessionId);
        await openQuestionResult(fresh);
        await expect(fresh.getByTestId("dsh-interaction")).toHaveCount(0);
        expect(attempts).toHaveLength(2);
        const finalLog = await host.readSessionLog();
        expect(questionResults(finalLog.rows)).toEqual([
          { callId: QUESTION_CALL, isError: false, answer: WINNER },
        ]);
        await testInfo.attach("durable-question-winner.json", {
          body: JSON.stringify({
            sessionId,
            result: questionResults(finalLog.rows),
            browserAnswerAttempts: attempts.length,
            controlledLateDeliveries: 1,
            winnerClientIds,
          }),
          contentType: "application/json",
        });
        await fresh.screenshot({
          path: testInfo.outputPath(`question-${width}-${reply}-settled.png`),
        });
        expect(errors).toEqual([]);
      } finally {
        await otherContext.close();
        await host.close();
      }
    });
  }
}

test.describe("mounted native DSH queue readers", () => {
  test.describe.configure({ timeout: 300_000 });
  for (const width of WIDTHS) {
    test(`shares the Host queue without replay at ${width}px`, async ({
      browser,
      context,
      page,
    }, testInfo) => {
      const errors: string[] = [];
      const mutations: string[] = [];
      const observe = (client: Page) => {
        client.on("pageerror", (error) => errors.push(error.message));
        client.on("request", (request) => {
          if (/\/session\/(prompt|updateQueue|cancel)$/.test(new URL(request.url()).pathname))
            mutations.push(new URL(request.url()).pathname);
        });
      };
      observe(page);
      const host = await launchMountedDshHost({ holdTurn: true });
      const readerContext = await browser.newContext({ viewport: { width, height: 844 } });
      try {
        await attachDshSession(context, host.config);
        await attachDshSession(readerContext, host.config);
        await page.setViewportSize({ width, height: 844 });
        await page.goto(host.companionUrl);
        await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
        await createHostSession(page, host.workspaceDir);
        await page.getByTestId("dsh-create-open").click();
        await page.getByLabel("Message").fill(host.prompt);
        await page.getByTestId("dsh-prompt-send").click();
        await expect(page.getByText("partial", { exact: true }).first()).toBeVisible({
          timeout: 120_000,
        });
        const reader = await readerContext.newPage();
        observe(reader);
        await openOnlySession(reader, host.companionUrl);
        await page.getByTestId("dsh-queue-toggle").click();
        await reader.getByTestId("dsh-queue-toggle").click();
        await expect(page.getByTestId("dsh-queue-item")).toHaveCount(0);

        // Separate real clients submit to the same running Host Session, in explicit order.
        await page.getByLabel("Message").fill("First queued follow-up");
        await page.getByTestId("dsh-prompt-send").click();
        await expect(reader.getByTestId("dsh-queue-item")).toHaveCount(1);
        await reader.getByLabel("Message").fill("Second queued follow-up");
        await reader.getByTestId("dsh-prompt-send").click();
        for (const client of [page, reader]) {
          await expect(client.getByTestId("dsh-queue-item")).toHaveCount(2);
          await expect(client.getByTestId("dsh-queue-item").nth(0)).toContainText(
            "First queued follow-up",
          );
          await expect(client.getByTestId("dsh-queue-item").nth(1)).toContainText(
            "Second queued follow-up",
          );
          await expectReachableComposer(client);
        }
        await page.getByLabel("Message").fill("Unsent draft stays local");
        await page.getByTestId("dsh-queue-toggle").click();
        await page.getByTestId("dsh-queue-toggle").click();
        await expect(page.getByLabel("Message")).toHaveValue("Unsent draft stays local");

        // A fresh reader gets the Host control baseline, not a persisted frontend queue.
        await reader.close();
        const replacement = await readerContext.newPage();
        observe(replacement);
        await openOnlySession(replacement, host.companionUrl);
        await replacement.getByTestId("dsh-queue-toggle").click();
        await expect(replacement.getByTestId("dsh-queue-item")).toHaveCount(2);
        await expect(replacement.getByTestId("dsh-queue-item").nth(0)).toContainText(
          "First queued follow-up",
        );
        await expect(replacement.getByTestId("dsh-queue-item").nth(1)).toContainText(
          "Second queued follow-up",
        );
        expect(mutations.filter((value) => value.endsWith("/prompt"))).toHaveLength(3);
        expect(mutations.filter((value) => !value.endsWith("/prompt"))).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`queue-${width}.png`) });
        expect(errors).toEqual([]);
      } finally {
        await readerContext.close();
        await host.close();
      }
    });
  }
});

/**
 * Production-browser qualification of the visible native fork. The real Host serves the built
 * companion export from its own origin, so the browser edition's same-origin owner session is
 * exercised end to end instead of a stand-in.
 *
 * A fork inherits a completed turn, so the flow creates a Host Session through the app's own
 * form, drives one recorded turn to completion, then forks from that completed conversation.
 */
test.describe("mounted native DSH fork in the production browser", () => {
  test.describe.configure({ timeout: 300_000 });

  for (const width of WIDTHS) {
    test(`forks a completed Host conversation and reviews it at ${width}px`, async ({
      context,
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const host = await launchMountedDshHost();
      try {
        await attachDshSession(context, host.config);
        await page.setViewportSize({ width, height: 844 });
        const response = await page.goto(host.companionUrl);
        expect(response?.status()).toBe(200);
        await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });

        // The replay fixture persists no Session, so create the subject through the app form.
        await createHostSession(page, host.workspaceDir);
        await page.getByTestId("dsh-create-open").click();
        await expect(page.getByTestId("dsh-conversation")).toBeVisible({ timeout: 60_000 });

        // A retained fork needs a completed turn to inherit.
        await page.getByLabel("Message").fill(host.prompt);
        await page.getByRole("button", { name: "Send message" }).click();
        await expect(page.getByText("PONG", { exact: true }).first()).toBeVisible({
          timeout: 120_000,
        });

        await expect(page.getByTestId("dsh-fork-session")).toBeVisible({ timeout: 30_000 });
        await page.getByTestId("dsh-fork-session").click();
        const source = page.getByTestId("dsh-fork-source");
        await source.waitFor({ state: "visible", timeout: 30_000 });
        await expect(source).not.toBeEmpty();
        await page.screenshot({ path: testInfo.outputPath(`fork-${width}-offer.png`) });

        await page.getByTestId("dsh-fork-submit").click();
        await expect(page.getByTestId("dsh-fork-outcome-confirmed")).toBeVisible({
          timeout: 60_000,
        });
        // The child identity is the ones the Host confirmed, and the attempt cannot be resent.
        await expect(page.getByTestId("dsh-fork-request-child")).not.toBeEmpty();
        await expect(page.getByTestId("dsh-fork-retained-child")).not.toBeEmpty();
        await expect(page.getByTestId("dsh-fork-submit")).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`fork-${width}-confirmed.png`) });
        expect(errors).toEqual([]);
      } finally {
        await host.close();
      }
    });
  }
});
