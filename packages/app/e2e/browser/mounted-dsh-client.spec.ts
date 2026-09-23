import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { APIRequestContext, Page, Request, Route } from "@playwright/test";
import { z } from "zod";
import { expect, metroTest as test } from "../support/fixtures";
import {
  APPROVAL_MARKER_CONTENT,
  APPROVAL_MARKER_NAME,
  APPROVAL_MARKER_REASON,
  attachDshSession,
  createHostSession,
  launchMountedDshHost,
  mountedDshImageFixturePaths,
  WORKSPACE_PROVENANCE_ID,
  WORKSPACE_PROVENANCE_PROMPT,
  WORKSPACE_PROVENANCE_REPLY,
} from "../support/helpers/mounted-dsh-host";

import { detectPromptImageMediaType } from "../../src/dsh/ui/prompt-image-bytes";

const WIDTHS = [390, 1280];

const imageRefSchema = z.object({
  attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mediaType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  name: z.string(),
});
// Native user/message also carries plugin context. Count every actual user-source message,
// then strictly validate its identity and content (never select by the expected image shape).
const imageMessageIdentity = z.object({
  type: z.literal("user/message"),
  data: z.object({ source: z.object({ kind: z.literal("user") }) }),
});
const imageMessageSchema = imageMessageIdentity.extend({
  seq: z.number(),
  data: z.object({
    source: z.object({ kind: z.literal("user"), rpcId: z.string() }),
    content: z.tuple([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("image"), attachment: imageRefSchema }),
      z.object({ type: z.literal("image"), attachment: imageRefSchema }),
    ]),
  }),
});
const imagePromptSchema = z.object({
  payload: z.object({
    args: z.object({
      request: z.object({
        sessionId: z.string(),
        requestId: z.string(),
        mode: z.literal("queue"),
        content: z.tuple([
          z.object({ type: z.literal("text"), text: z.string() }),
          z.object({
            type: z.literal("image"),
            mediaType: z.literal("image/png"),
            data: z.string(),
            name: z.string(),
          }),
          z.object({
            type: z.literal("image"),
            mediaType: z.literal("image/png"),
            data: z.string(),
            name: z.string(),
          }),
        ]),
      }),
    }),
  }),
});

function imageMessages(rows: unknown[]) {
  return rows
    .filter((row) => imageMessageIdentity.safeParse(row).success)
    .map((row) => imageMessageSchema.parse(row));
}
function observeImageMutations(page: Page, requests: Request[]) {
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      (pathname === "/api/session/prompt" || /fileUploads|uploadFile/.test(pathname))
    )
      requests.push(request);
  });
}
interface PickerFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}
async function selectImages(page: Page, files: PickerFile[]) {
  const attach = page.getByTestId("dsh-prompt-attach");
  await expect(attach).toBeEnabled();
  const pending = page.waitForEvent("filechooser");
  await attach.click();
  const chooser = await pending;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(files);
  await expect(attach).toBeEnabled();
}
async function expectImageChips(page: Page, names: string[]) {
  const chips = page.getByTestId("dsh-prompt-attachment");
  await expect(chips).toHaveCount(names.length);
  for (const [index, name] of names.entries())
    await expect(chips.nth(index)).toContainText(`${name} · image/png`);
}
async function expectImageTranscript(page: Page, refs: z.infer<typeof imageRefSchema>[]) {
  const blocks = page.getByTestId("dsh-block-image");
  await expect(blocks).toHaveCount(refs.length);
  for (const [index, ref] of refs.entries()) {
    await expect(blocks.nth(index)).toContainText(
      `${ref.name} · ${ref.mediaType} · ${ref.width}×${ref.height} · ${ref.bytes} bytes`,
    );
  }
}
async function readBackImage(
  request: APIRequestContext,
  origin: string,
  sessionId: string,
  ref: z.infer<typeof imageRefSchema>,
) {
  const rpcId = `read-${ref.attachmentId}`;
  const response = await request.post(`${origin}/api/session/attachment`, {
    data: {
      type: "client-request",
      rpcId,
      method: "session/attachment",
      payload: { args: { request: { sessionId, attachmentId: ref.attachmentId } } },
    },
  });
  expect(response.status()).toBe(200);
  const body = z
    .object({
      type: z.literal("server-response"),
      rpcId: z.literal(rpcId),
      result: z.object({
        ok: z.literal(true),
        value: z.object({ attachment: imageRefSchema, data: z.string() }),
      }),
    })
    .parse(await response.json());
  expect(body.result.value.attachment).toEqual(ref);
  const bytes = Buffer.from(body.result.value.data, "base64");
  expect(bytes.length).toBe(ref.bytes);
  expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(ref.attachmentId);
  expect(detectPromptImageMediaType(body.result.value.data)).toBe(ref.mediaType);
  return {
    attachment: body.result.value.attachment,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

function observeImageReads(page: Page, reads: Request[]) {
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/session/attachment") reads.push(request);
  });
}
async function expectDecodedPreview(page: Page, ref: z.infer<typeof imageRefSchema>) {
  const preview = page.getByTestId("dsh-image-preview");
  await expect(preview).toHaveCount(1);
  const image = preview.locator("img");
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => ({
        complete: element.complete,
        width: element.naturalWidth,
        height: element.naturalHeight,
      })),
    )
    .toEqual({ complete: true, width: ref.width, height: ref.height });
  const uri = await image.getAttribute("src");
  expect(uri).toMatch(new RegExp(`^data:${ref.mediaType};base64,`));
  const bytes = Buffer.from(uri!.split(",")[1]!, "base64");
  expect(bytes.length).toBe(ref.bytes);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  expect(digest).toBe(ref.attachmentId);
  return { attachmentId: digest, bytes: bytes.length, width: ref.width, height: ref.height };
}
async function exerciseImagePreview(
  page: Page,
  sessionId: string,
  refs: z.infer<typeof imageRefSchema>[],
  reads: Request[],
) {
  const endpoint = "**/api/session/attachment";
  const blocks = page.getByTestId("dsh-block-image");
  expect(reads).toHaveLength(0);
  await expect(page.getByTestId("dsh-image-load")).toHaveCount(refs.length);
  await expect(page.getByTestId("dsh-image-preview")).toHaveCount(0);
  let capture!: (route: Route) => void;
  const held = new Promise<Route>((resolve) => {
    capture = resolve;
  });
  await page.route(endpoint, (route) => capture(route));
  await blocks.nth(0).getByTestId("dsh-image-load").click();
  const route = await held;
  await blocks.nth(0).getByTestId("dsh-image-hide").click();
  for (const button of await page.getByTestId("dsh-image-load").all())
    await expect(button).toBeDisabled();
  // Internal view replacement retains the same Host runtime/physical read gate.
  await page.getByRole("button", { name: "Back to sessions", exact: true }).click();
  await expect(page.getByTestId("dsh-session-list")).toBeVisible();
  await page.getByTestId(`dsh-open-session-${sessionId}`).click();
  await expectImageTranscript(page, refs);
  await expect(page.getByTestId("dsh-image-load")).toHaveCount(refs.length);
  for (const button of await page.getByTestId("dsh-image-load").all())
    await expect(button).toBeDisabled();
  expect(reads).toHaveLength(1);
  await route.fulfill({ response: await route.fetch() });
  await page.unroute(endpoint);
  for (const button of await page.getByTestId("dsh-image-load").all())
    await expect(button).toBeEnabled();
  await expect(page.getByTestId("dsh-image-preview")).toHaveCount(0);
  expect(reads).toHaveLength(1);
  await blocks.nth(0).getByTestId("dsh-image-load").click();
  const first = await expectDecodedPreview(page, refs[0]!);
  await blocks.nth(1).getByTestId("dsh-image-load").click();
  const second = await expectDecodedPreview(page, refs[1]!);
  await expect(blocks.nth(0).getByTestId("dsh-image-preview")).toHaveCount(0);
  await blocks.nth(1).getByTestId("dsh-image-hide").click();
  await expect(page.getByTestId("dsh-image-preview")).toHaveCount(0);
  expect(reads).toHaveLength(3);
  await page.route(endpoint, (request) =>
    request.fulfill({ status: 503, body: "Controlled read failure" }),
  );
  await blocks.nth(0).getByTestId("dsh-image-load").click();
  await expect(blocks.nth(0).getByTestId("dsh-image-error")).toContainText("could not be loaded");
  await expect(page.getByTestId("dsh-image-preview")).toHaveCount(0);
  expect(reads).toHaveLength(4);
  await page.unroute(endpoint);
  await blocks.nth(0).getByTestId("dsh-image-load").click();
  const retry = await expectDecodedPreview(page, refs[0]!);
  expect(reads).toHaveLength(5);
  return { first, second, retry, heldViewReplacementReadCount: 1, failureStatus: 503 };
}

test.describe("mounted native DSH image admission and preview", () => {
  for (const width of WIDTHS) {
    test(`persists actual picker images without partial selection or replay at ${width}px`, async ({
      page,
      context,
      browser,
    }, testInfo) => {
      test.setTimeout(120_000);
      const host = await launchMountedDshHost();
      const freshContext = await browser.newContext({ viewport: { width, height: 844 } });
      try {
        await page.setViewportSize({ width, height: 844 });
        await attachDshSession(context, host.config);
        await attachDshSession(freshContext, host.config);
        const mutations: Request[] = [];
        observeImageMutations(page, mutations);
        const imageReads: Request[] = [];
        observeImageReads(page, imageReads);
        const clients = observeClientIds(page);
        await page.goto(host.companionUrl);
        await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
        await createHostSession(page, host.workspaceDir);
        const sessionId = await openOnlySession(page, host.companionUrl);
        await page.getByTestId("dsh-prompt-text").fill(host.prompt);
        const paths = mountedDshImageFixturePaths();
        const first = {
          name: "misnamed.jpeg",
          mimeType: "image/jpeg",
          buffer: await readFile(paths.light),
        };
        const second = {
          name: "second.png",
          mimeType: "image/png",
          buffer: await readFile(paths.dark),
        };
        await selectImages(page, [first, second]);
        await expectImageChips(page, [first.name, second.name]);
        const abandonedChoice = page.waitForEvent("filechooser");
        await page.getByTestId("dsh-prompt-attach").click();
        const abandoned = await abandonedChoice;
        await expect(page.getByTestId("dsh-prompt-send")).toBeDisabled();
        await page.getByTestId("dsh-prompt-discard-selection").click();
        await expect(page.getByTestId("dsh-prompt-send")).toBeEnabled();
        // Deliver a controlled late picker result, not a claimed OS-dialog cancellation.
        await abandoned.setFiles([first]);
        await expect(page.getByTestId("file-input")).toHaveCount(0);
        await expectImageChips(page, [first.name, second.name]);
        await page.getByTestId("dsh-prompt-attachment-remove").first().click();
        await expectImageChips(page, [second.name]);
        const svg = {
          name: "unsupported.svg",
          mimeType: "image/svg+xml",
          buffer: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>',
          ),
        };
        await selectImages(page, [first, svg]);
        await expect(page.getByTestId("dsh-prompt-attach-failed")).toBeVisible();
        await expectImageChips(page, [second.name]);
        await expect(page.getByTestId("dsh-prompt-text")).toHaveValue(host.prompt);
        expect(mutations).toHaveLength(0);
        expect(await host.imageObjectIds()).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`images-rejected-selection-${width}.png`),
          fullPage: true,
        });
        await selectImages(page, [first]);
        await expect(page.getByTestId("dsh-prompt-attach-failed")).toHaveCount(0);
        await expectImageChips(page, [second.name, first.name]);
        expect(mutations).toHaveLength(0);
        expect(await host.imageObjectIds()).toEqual([]);
        await expectReachableComposer(page);
        await page.screenshot({
          path: testInfo.outputPath(`images-selected-${width}.png`),
          fullPage: true,
        });
        await page.getByTestId("dsh-prompt-send").click();
        await expect(page.getByText("PONG", { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("dsh-prompt-attachment")).toHaveCount(0);
        expect(mutations).toHaveLength(1);
        expect(new URL(mutations[0]!.url()).pathname).toBe("/api/session/prompt");
        const wire = imagePromptSchema.parse(mutations[0]!.postDataJSON()).payload.args.request;
        expect(wire.sessionId).toBe(sessionId);
        expect(wire.content).toEqual([
          { type: "text", text: host.prompt },
          {
            type: "image",
            mediaType: "image/png",
            data: second.buffer.toString("base64"),
            name: second.name,
          },
          {
            type: "image",
            mediaType: "image/png",
            data: first.buffer.toString("base64"),
            name: first.name,
          },
        ]);
        await expect
          .poll(async () => completedTurnCount((await host.readSessionLog()).rows))
          .toBe(1);
        const log = await host.readSessionLog();
        expect(log.sessionId).toBe(sessionId);
        const messages = imageMessages(log.rows);
        expect(messages).toHaveLength(1);
        const ends = log.rows
          .filter((row) => turnEndIdentity.safeParse(row).success)
          .map((row) => turnEndSchema.parse(row));
        expect(ends).toHaveLength(1);
        expect(ends[0]!.seq).toBeGreaterThan(messages[0]!.seq);
        expect(messages[0]!.data.source.rpcId).toBe(wire.requestId);
        expect(messages[0]!.data.content[0]).toEqual({ type: "text", text: host.prompt });
        const refs = [
          messages[0]!.data.content[1].attachment,
          messages[0]!.data.content[2].attachment,
        ];
        expect(refs.map((ref) => ref.name)).toEqual([second.name, first.name]);
        expect(new Set(refs.map((ref) => ref.attachmentId)).size).toBe(2);
        expect(await host.imageObjectIds()).toEqual(refs.map((ref) => ref.attachmentId).sort());
        for (const ref of refs) {
          const stored = await host.readImageObject(ref.attachmentId);
          expect(stored.length).toBe(ref.bytes);
          expect(`sha256:${createHash("sha256").update(stored).digest("hex")}`).toBe(
            ref.attachmentId,
          );
          expect(detectPromptImageMediaType(stored.toString("base64"))).toBe(ref.mediaType);
        }
        await expectImageTranscript(page, refs);
        const previews = await exerciseImagePreview(page, sessionId, refs, imageReads);
        await expectReachableComposer(page);
        await page.screenshot({
          path: testInfo.outputPath(`images-preview-${width}.png`),
          fullPage: true,
        });
        const previousClient = clients.at(-1);
        expect(previousClient).not.toBeUndefined();
        expect(await openOnlySession(page, host.companionUrl)).toBe(sessionId);
        await expect.poll(() => clients.at(-1)).not.toBe(previousClient);
        await expectImageTranscript(page, refs);
        await expect(page.getByTestId("dsh-image-preview")).toHaveCount(0);
        expect(imageReads).toHaveLength(5);
        const fresh = await freshContext.newPage();
        observeImageMutations(fresh, mutations);
        observeImageReads(fresh, imageReads);
        expect(await openOnlySession(fresh, host.companionUrl)).toBe(sessionId);
        await expectImageTranscript(fresh, refs);
        await expect(fresh.getByTestId("dsh-image-preview")).toHaveCount(0);
        expect(imageReads).toHaveLength(5);
        await fresh.getByTestId("dsh-block-image").nth(0).getByTestId("dsh-image-load").click();
        const freshPreview = await expectDecodedPreview(fresh, refs[0]!);
        expect(imageReads).toHaveLength(6);
        const previewRequests = imageReads.map(
          (request) =>
            z
              .object({
                method: z.literal("session/attachment"),
                payload: z.object({
                  args: z.object({
                    request: z.object({
                      sessionId: z.literal(sessionId),
                      attachmentId: z.string(),
                    }),
                  }),
                }),
              })
              .parse(request.postDataJSON()).payload.args.request,
        );
        expect(previewRequests.map((request) => request.attachmentId)).toEqual([
          refs[0]!.attachmentId,
          refs[0]!.attachmentId,
          refs[1]!.attachmentId,
          refs[0]!.attachmentId,
          refs[0]!.attachmentId,
          refs[0]!.attachmentId,
        ]);
        const readbacks = [];
        for (const ref of refs)
          readbacks.push(
            await readBackImage(freshContext.request, host.config.url, sessionId, ref),
          );
        expect(imageMessages((await host.readSessionLog()).rows)).toEqual(messages);
        expect(await host.imageObjectIds()).toEqual(refs.map((ref) => ref.attachmentId).sort());
        expect(mutations).toHaveLength(1);
        await expectReachableComposer(fresh);
        await fresh.screenshot({
          path: testInfo.outputPath(`images-restored-${width}.png`),
          fullPage: true,
        });
        const artifact = testInfo.outputPath(`durable-images-${width}.json`);
        await writeFile(
          artifact,
          JSON.stringify({
            sessionId,
            requestId: wire.requestId,
            messages,
            completedTurn: ends[0],
            readbacks,
            previews,
            freshPreview,
            previewRequests,
            browserMutationAttempts: mutations.length,
            clientIds: clients,
          }),
        );
        await testInfo.attach("durable-image-admission", {
          path: artifact,
          contentType: "application/json",
        });
      } finally {
        await freshContext.close();
        await host.close();
      }
    });
  }
});

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

const APPROVAL_CALL_IDS = ["approval-first", "approval-second"] as const;
const APPROVAL_FIRST_CALL = APPROVAL_CALL_IDS[0];
const APPROVAL_SECOND_CALL = APPROVAL_CALL_IDS[1];
const approvalCallIdSchema = z.enum(APPROVAL_CALL_IDS);
const APPROVAL_WRITE_ARGS = {
  file_path: APPROVAL_MARKER_NAME,
  content: APPROVAL_MARKER_CONTENT,
};

function approvalToolReplay(callId: (typeof APPROVAL_CALL_IDS)[number]) {
  const args = JSON.stringify(APPROVAL_WRITE_ARGS);
  const call = { type: "tool-call", id: callId, name: "write", arguments: args };
  return {
    kind: "chunks",
    chunks: [
      { type: "block-start", index: 0, blockType: "tool-call" },
      { type: "tool-call-delta", index: 0, id: callId, name: "write", argumentsDelta: args },
      { type: "block-end", index: 0, block: call },
      { type: "finish", reason: { kind: "tool-calls" } },
    ],
  };
}

function approvalReplay(): string {
  return JSON.stringify([
    approvalToolReplay(APPROVAL_FIRST_CALL),
    approvalToolReplay(APPROVAL_SECOND_CALL),
    {
      kind: "chunks",
      chunks: [
        { type: "block-start", index: 0, blockType: "text" },
        { type: "text-delta", index: 0, text: "APPROVAL_DONE" },
        { type: "block-end", index: 0, block: { type: "text", text: "APPROVAL_DONE" } },
        { type: "finish", reason: { kind: "stop" } },
      ],
    },
  ]);
}

const approvalAnswerSchema = z.object({
  payload: z.object({
    args: z.object({
      clientId: z.string(),
      eventId: z.string(),
      outcome: z.object({
        kind: z.literal("result"),
        value: z.enum(["allowed-once", "rejected"]),
      }),
    }),
  }),
});
const approvalToolCallIdentity = z.object({
  type: z.literal("tool/call"),
  data: z.object({ callId: approvalCallIdSchema }),
});
const approvalToolCallSchema = z.object({
  type: z.literal("tool/call"),
  data: z.object({
    callId: approvalCallIdSchema,
    name: z.literal("write"),
    arguments: z.string(),
  }),
});
const approvalToolResultIdentity = z.object({
  type: z.literal("tool/result"),
  data: z.object({ message: z.object({ source: z.object({ callId: approvalCallIdSchema }) }) }),
});
const approvalToolResultSchema = z.object({
  type: z.literal("tool/result"),
  data: z.object({
    message: z.object({
      source: z.object({ kind: z.literal("tool"), callId: approvalCallIdSchema }),
      content: z.array(
        z.object({
          type: z.literal("tool-result"),
          toolCallId: approvalCallIdSchema,
          isError: z.boolean(),
          content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
        }),
      ),
    }),
  }),
});
const approvalRequestFrameSchema = z.object({
  type: z.literal("item"),
  value: z.object({
    type: z.literal("waterfall"),
    event: z.literal("approval/request"),
    eventId: z.string(),
    agentId: z.string(),
    request: z.object({
      toolName: z.literal("write"),
      callId: approvalCallIdSchema,
      reason: z.literal(APPROVAL_MARKER_REASON),
    }),
  }),
});

interface ApprovalResult {
  callId: (typeof APPROVAL_CALL_IDS)[number];
  isError: boolean;
  text: string;
}
interface ObservedApproval {
  eventId: string;
  callId: (typeof APPROVAL_CALL_IDS)[number];
}

function approvalToolCalls(rows: unknown[]): (typeof APPROVAL_CALL_IDS)[number][] {
  const candidates = rows.filter((row) => approvalToolCallIdentity.safeParse(row).success);
  return candidates.map((row) => {
    const call = approvalToolCallSchema.parse(row);
    expect(JSON.parse(call.data.arguments)).toEqual(APPROVAL_WRITE_ARGS);
    return call.data.callId;
  });
}

function approvalToolResults(rows: unknown[]): ApprovalResult[] {
  const candidates = rows.filter((row) => approvalToolResultIdentity.safeParse(row).success);
  return candidates.map((row) => {
    const result = approvalToolResultSchema.parse(row);
    expect(result.data.message.content).toHaveLength(1);
    const block = result.data.message.content[0]!;
    expect(block.toolCallId).toBe(result.data.message.source.callId);
    return {
      callId: block.toolCallId,
      isError: block.isError,
      text: block.content.map((part) => part.text).join(""),
    };
  });
}

interface ApprovalExpectation {
  outcome: "allowed-once" | "rejected";
  workspaceDir: string;
}

function expectApprovalResult(result: ApprovalResult, expected: ApprovalExpectation): void {
  const texts = {
    "allowed-once": `<path>${path.join(expected.workspaceDir, APPROVAL_MARKER_NAME)}</path>\n<type>file</type>\n<content>\nCreated file\n</content>`,
    rejected: 'Error: the user rejected tool "write"',
  };
  expect(result.isError).toBe(expected.outcome === "rejected");
  expect(result.text).toBe(texts[expected.outcome]);
}

const approvalFrameIdentity = z.object({
  type: z.literal("item"),
  value: z.object({ type: z.literal("waterfall"), event: z.literal("approval/request") }),
});
const authorityEvent = z.object({
  type: z.enum(["sandbox/mode", "approval/policy", "permission/preset"]),
});
const approvalAuditIdentity = z.object({ type: z.enum(["approval/asked", "approval/decided"]) });
const approvalAuditSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("approval/asked"),
    seq: z.number(),
    data: z.object({
      id: z.string(),
      callId: approvalCallIdSchema,
      toolName: z.literal("write"),
      reason: z.literal(APPROVAL_MARKER_REASON),
    }),
  }),
  z.object({
    type: z.literal("approval/decided"),
    seq: z.number(),
    data: z.object({
      id: z.string(),
      outcome: z.enum(["allowed-once", "rejected"]),
    }),
  }),
]);

function approvalAudit(rows: unknown[]) {
  return rows
    .filter((row) => approvalAuditIdentity.safeParse(row).success)
    .map((row) => approvalAuditSchema.parse(row));
}

const turnEndIdentity = z.object({ type: z.literal("turn/end") });
function completedTurnCount(rows: unknown[]): number {
  return rows.filter((row) => turnEndIdentity.safeParse(row).success).length;
}
const turnStartIdentity = z.object({ type: z.literal("turn/start") });
const turnStartSchema = turnStartIdentity.extend({
  seq: z.number(),
  data: z.object({ turn: z.number() }),
});
const turnEndSchema = turnEndIdentity.extend({
  seq: z.number(),
  data: z.object({ turn: z.number(), reason: z.object({ kind: z.literal("completed") }) }),
});
const sequencedApprovalCall = approvalToolCallSchema.extend({ seq: z.number() });
const sequencedApprovalResult = approvalToolResultSchema.extend({ seq: z.number() });

function pendingApprovalLogState(rows: unknown[]) {
  const audit = approvalAudit(rows);
  return {
    calls: approvalToolCalls(rows),
    results: approvalToolResults(rows).map((result) => result.callId),
    asks: audit.filter((row) => row.type === "approval/asked").length,
    decisions: audit.filter((row) => row.type === "approval/decided").length,
  };
}

function assertApprovalDecisions(rows: unknown[], firstOutcome: "allowed-once" | "rejected") {
  const starts = rows
    .filter((row) => turnStartIdentity.safeParse(row).success)
    .map((row) => turnStartSchema.parse(row));
  const ends = rows
    .filter((row) => turnEndIdentity.safeParse(row).success)
    .map((row) => turnEndSchema.parse(row));
  expect(starts).toHaveLength(1);
  expect(ends).toHaveLength(1);
  expect(ends[0]!.data.turn).toBe(starts[0]!.data.turn);
  const calls = rows
    .filter((row) => approvalToolCallIdentity.safeParse(row).success)
    .map((row) => sequencedApprovalCall.parse(row));
  const results = rows
    .filter((row) => approvalToolResultIdentity.safeParse(row).success)
    .map((row) => sequencedApprovalResult.parse(row));
  const audit = approvalAudit(rows);
  const asks = audit.filter((row) => row.type === "approval/asked");
  const decisions = audit.filter((row) => row.type === "approval/decided");
  expect(asks.map((row) => row.data.callId)).toEqual(APPROVAL_CALL_IDS);
  expect(decisions).toHaveLength(2);
  expect(new Set(asks.map((row) => row.data.id)).size).toBe(2);
  const outcomes = asks.map((ask) => {
    const matches = decisions.filter((decision) => decision.data.id === ask.data.id);
    expect(matches).toHaveLength(1);
    const call = calls.find((row) => row.data.callId === ask.data.callId)!;
    const result = results.find((row) => row.data.message.source.callId === ask.data.callId)!;
    expect(call.seq).toBeGreaterThan(starts[0]!.seq);
    expect(ask.seq).toBeGreaterThan(call.seq);
    expect(matches[0]!.seq).toBeGreaterThan(ask.seq);
    expect(result.seq).toBeGreaterThan(matches[0]!.seq);
    expect(ends[0]!.seq).toBeGreaterThan(result.seq);
    return matches[0]!.data.outcome;
  });
  expect(outcomes).toEqual([firstOutcome, "rejected"]);
  return audit;
}

function observeApprovalRequests(page: Page) {
  const requests: ObservedApproval[] = [];
  const errors: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload.toString("utf8");
      const frame: unknown = JSON.parse(text);
      if (!approvalFrameIdentity.safeParse(frame).success) return;
      const approval = approvalRequestFrameSchema.safeParse(frame);
      if (!approval.success) {
        errors.push(approval.error.message);
        return;
      }
      requests.push({
        eventId: approval.data.value.eventId,
        callId: approval.data.value.request.callId,
      });
    });
  });
  return { requests, errors };
}

async function approvalDelivery(
  observed: ReturnType<typeof observeApprovalRequests>,
  callId: (typeof APPROVAL_CALL_IDS)[number],
): Promise<ObservedApproval> {
  await expect
    .poll(() => observed.requests.filter((request) => request.callId === callId).length, {
      timeout: 60_000,
    })
    .toBe(1);
  return observed.requests.find((request) => request.callId === callId)!;
}

async function expectPendingApprovalCard(page: Page): Promise<void> {
  const card = page.getByTestId("dsh-interaction");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("write");
  await expect(card).toContainText(APPROVAL_MARKER_REASON);
  await expect(card.getByRole("button")).toHaveCount(2);
  await expect(card.getByTestId("dsh-approval-allow")).toHaveText("Allow once");
  await expect(card.getByTestId("dsh-approval-reject")).toHaveText("Reject");
}

async function openApprovalResults(page: Page, expected: ApprovalResult[]): Promise<void> {
  const results = page.getByTestId("dsh-tool-result");
  await expect(results).toHaveCount(2);
  const loads = results.getByRole("button", { name: "Load full result", exact: true });
  for (let remaining = 2; remaining > 0; remaining -= 1) {
    await expect(loads).toHaveCount(remaining);
    await loads.first().click();
  }
  await expect(loads).toHaveCount(0);
  for (const [index, result] of expected.entries()) {
    await expect(results.nth(index)).toContainText(result.text);
    await expect(results.nth(index)).toContainText(
      result.isError ? "Tool failed" : "Tool finished",
    );
  }
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

test.describe("mounted native DSH concurrent approvals", () => {
  test.describe.configure({ timeout: 300_000 });
  for (const width of WIDTHS) {
    for (const firstOutcome of ["allowed-once", "rejected"] as const) {
      test(`keeps one ${firstOutcome} approval winner at ${width}px`, async ({
        browser,
        context,
        page,
      }, testInfo) => {
        const winnerClientIds = observeClientIds(page);
        const winnerApprovals = observeApprovalRequests(page);
        const host = await launchMountedDshHost({
          replayOverride: approvalReplay(),
          requireMarkerApproval: true,
        });
        const otherContext = await browser.newContext({ viewport: { width, height: 844 } });
        const attempts: string[] = [];
        const errors: string[] = [];
        try {
          expect(await host.readMarker()).toBeNull();
          await attachDshSession(context, host.config);
          await attachDshSession(otherContext, host.config);
          await page.setViewportSize({ width, height: 844 });
          observeAnswers(page, attempts, errors);
          await page.goto(host.companionUrl);
          await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
          await createHostSession(page, host.workspaceDir);
          await page.getByTestId("dsh-create-open").click();
          const other = await otherContext.newPage();
          const otherApprovals = observeApprovalRequests(other);
          observeAnswers(other, attempts, errors);
          const sessionId = await openOnlySession(other, host.companionUrl);
          await other.getByLabel("Message").fill("Retained unsent composer draft");
          const initialLog = await host.readSessionLog();
          const initialAuthority = initialLog.rows.filter(
            (row) => authorityEvent.safeParse(row).success,
          );
          const winnerGate = await holdAnswer(page);
          const loserGate = await holdAnswer(other);
          await page.getByLabel("Message").fill(host.prompt);
          await page.getByTestId("dsh-prompt-send").click();
          await Promise.all([expectPendingApprovalCard(page), expectPendingApprovalCard(other)]);
          const firstWinnerApproval = await approvalDelivery(winnerApprovals, APPROVAL_FIRST_CALL);
          const firstLoserApproval = await approvalDelivery(otherApprovals, APPROVAL_FIRST_CALL);
          expect(firstWinnerApproval.eventId).toBe(firstLoserApproval.eventId);
          await page.screenshot({
            path: testInfo.outputPath(`approval-${width}-${firstOutcome}-pending.png`),
          });
          const loserOutcome = firstOutcome === "allowed-once" ? "rejected" : "allowed-once";
          await Promise.all([
            page
              .getByTestId(
                firstOutcome === "allowed-once" ? "dsh-approval-allow" : "dsh-approval-reject",
              )
              .click(),
            other
              .getByTestId(
                loserOutcome === "allowed-once" ? "dsh-approval-allow" : "dsh-approval-reject",
              )
              .click(),
          ]);
          const winnerRoute = await winnerGate.request;
          const loserRoute = await loserGate.request;
          const winner = approvalAnswerSchema.parse(winnerRoute.request().postDataJSON()).payload
            .args;
          const loser = approvalAnswerSchema.parse(loserRoute.request().postDataJSON()).payload
            .args;
          expect(winner.eventId).toBe(loser.eventId);
          expect(winner.eventId).toBe(firstWinnerApproval.eventId);
          expect(winner.clientId).not.toBe(loser.clientId);
          expect(winner.outcome.value).toBe(firstOutcome);
          expect(loser.outcome.value).toBe(loserOutcome);
          expect(winnerClientIds).toContain(winner.clientId);

          const response = await winnerRoute.fetch();
          expect(response.status()).toBe(200);
          expect(await response.json()).toMatchObject({ result: { ok: true } });
          await winnerRoute.fulfill({ response });
          await Promise.all([expectPendingApprovalCard(page), expectPendingApprovalCard(other)]);
          const secondWinnerApproval = await approvalDelivery(
            winnerApprovals,
            APPROVAL_SECOND_CALL,
          );
          const secondLoserApproval = await approvalDelivery(otherApprovals, APPROVAL_SECOND_CALL);
          expect(secondWinnerApproval.eventId).toBe(secondLoserApproval.eventId);
          expect(secondWinnerApproval.eventId).not.toBe(firstWinnerApproval.eventId);

          // Waterfall visibility precedes the JSONL writer's bounded batch flush.
          await expect
            .poll(async () => {
              const log = await host.readSessionLog();
              return pendingApprovalLogState(log.rows);
            })
            .toEqual({
              calls: [...APPROVAL_CALL_IDS],
              results: [APPROVAL_FIRST_CALL],
              asks: 2,
              decisions: 1,
            });
          const firstLog = await host.readSessionLog();
          expect(firstLog.sessionId).toBe(sessionId);
          expect(approvalToolCalls(firstLog.rows)).toEqual([
            APPROVAL_FIRST_CALL,
            APPROVAL_SECOND_CALL,
          ]);
          const firstResults = approvalToolResults(firstLog.rows);
          expect(firstResults).toHaveLength(1);
          expect(firstResults[0]?.callId).toBe(APPROVAL_FIRST_CALL);
          expectApprovalResult(firstResults[0]!, {
            outcome: firstOutcome,
            workspaceDir: host.workspaceDir,
          });
          const firstMarker = await host.readMarker();
          expect(firstMarker).toBe(
            firstOutcome === "allowed-once" ? APPROVAL_MARKER_CONTENT : null,
          );

          const late = await otherContext.request.post(loserRoute.request().url(), {
            data: loserRoute.request().postData(),
            headers: { "content-type": "application/json", origin: host.config.url },
          });
          expect(late.status()).toBe(200);
          expect(await late.json()).toMatchObject({ result: { ok: true } });
          await loserRoute.abort("failed");
          const afterLateLog = await host.readSessionLog();
          expect(afterLateLog.sessionId).toBe(sessionId);
          expect(approvalToolResults(afterLateLog.rows)).toEqual(firstResults);
          expect(approvalAudit(afterLateLog.rows)).toEqual(approvalAudit(firstLog.rows));
          expect(await host.readMarker()).toBe(firstMarker);
          await Promise.all([expectPendingApprovalCard(page), expectPendingApprovalCard(other)]);
          await Promise.all([
            page.unroute("**/api/$events/result"),
            other.unroute("**/api/$events/result"),
          ]);

          await page.getByTestId("dsh-approval-reject").click();
          await expect(page.getByText("APPROVAL_DONE", { exact: true }).first()).toBeVisible({
            timeout: 60_000,
          });
          await expect(other.getByText("APPROVAL_DONE", { exact: true }).first()).toBeVisible({
            timeout: 60_000,
          });
          await expect
            .poll(async () => {
              const log = await host.readSessionLog();
              return completedTurnCount(log.rows);
            })
            .toBe(1);
          const finalLog = await host.readSessionLog();
          expect(finalLog.sessionId).toBe(sessionId);
          expect(approvalToolCalls(finalLog.rows)).toEqual([
            APPROVAL_FIRST_CALL,
            APPROVAL_SECOND_CALL,
          ]);
          const audit = assertApprovalDecisions(finalLog.rows, firstOutcome);
          expect(finalLog.rows.filter((row) => authorityEvent.safeParse(row).success)).toEqual(
            initialAuthority,
          );
          const finalResults = approvalToolResults(finalLog.rows);
          expect(finalResults).toHaveLength(2);
          expect(finalResults.map((result) => result.callId)).toEqual(APPROVAL_CALL_IDS);
          expectApprovalResult(finalResults[0]!, {
            outcome: firstOutcome,
            workspaceDir: host.workspaceDir,
          });
          expectApprovalResult(finalResults[1]!, {
            outcome: "rejected",
            workspaceDir: host.workspaceDir,
          });
          const finalMarker = await host.readMarker();
          expect(finalMarker).toBe(firstMarker);
          await expect(page.getByTestId("dsh-interaction")).toHaveCount(0);
          await expect(other.getByTestId("dsh-interaction")).toHaveCount(0);
          await expect(other.getByLabel("Message")).toHaveValue("Retained unsent composer draft");
          expect(attempts).toHaveLength(3);
          expect(winnerApprovals.errors).toEqual([]);
          expect(otherApprovals.errors).toEqual([]);

          expect(await openOnlySession(page, host.companionUrl)).toBe(sessionId);
          await expect.poll(() => winnerClientIds.at(-1)).not.toBe(winner.clientId);
          await openApprovalResults(page, finalResults);
          await expect(page.getByTestId("dsh-interaction")).toHaveCount(0);
          await other.close();
          const fresh = await otherContext.newPage();
          const freshApprovals = observeApprovalRequests(fresh);
          observeAnswers(fresh, attempts, errors);
          expect(await openOnlySession(fresh, host.companionUrl)).toBe(sessionId);
          await openApprovalResults(fresh, finalResults);
          await expect(fresh.getByTestId("dsh-interaction")).toHaveCount(0);
          expect(freshApprovals.requests).toEqual([]);
          expect(freshApprovals.errors).toEqual([]);
          const reloadedLog = await host.readSessionLog();
          expect(reloadedLog.sessionId).toBe(sessionId);
          expect(approvalToolResults(reloadedLog.rows)).toEqual(finalResults);
          expect(assertApprovalDecisions(reloadedLog.rows, firstOutcome)).toEqual(audit);
          expect(reloadedLog.rows.filter((row) => authorityEvent.safeParse(row).success)).toEqual(
            initialAuthority,
          );
          expect(attempts).toHaveLength(3);
          expect(await host.readMarker()).toBe(finalMarker);
          await fresh.screenshot({
            path: testInfo.outputPath(`approval-${width}-${firstOutcome}-settled.png`),
          });
          const evidencePath = testInfo.outputPath(
            `durable-approval-${width}-${firstOutcome}.json`,
          );
          await writeFile(
            evidencePath,
            JSON.stringify({
              sessionId,
              firstOutcome,
              results: finalResults,
              audit,
              authority: initialAuthority,
              marker: finalMarker,
              browserAnswerAttempts: attempts.length,
              controlledLateDeliveries: 1,
              winnerClientIds,
            }),
          );
          await testInfo.attach("durable-approval-results.json", {
            path: evidencePath,
            contentType: "application/json",
          });
          expect(errors).toEqual([]);
        } finally {
          await otherContext.close();
          await host.close();
        }
      });
    }
  }
});

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

const workspaceFixtureRefs = {
  "refs/heads/dsh/fix-recovery-111111111111111111111111/turn-1": "d".repeat(40),
  "refs/heads/dsh/fix-recovery-222222222222222222222222/turn-1": "d".repeat(40),
};
const workspaceEventEnvelope = z.object({
  seq: z.number().int().nonnegative(),
  time: z.number().int(),
  // These are required events. Passing only after a fixture marks them ignorable is not proof.
  ignorable: z.never().optional(),
});
const provenanceEventSchema = workspaceEventEnvelope.extend({
  type: z.literal("workspace/provenance"),
  data: z.object({
    version: z.literal(1),
    id: z.literal(WORKSPACE_PROVENANCE_ID),
    workspaceId: z.literal("a".repeat(32)),
    sessionId: z.string(),
    turn: z.literal(1),
    eventRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    repository: z.literal("/example/repository"),
    baseline: z.literal("b".repeat(40)),
    createdAt: z.literal("2026-09-23T12:00:00Z"),
    refs: z.array(
      z.object({ source: z.string(), branch: z.string(), commit: z.string(), topic: z.string() }),
    ),
    observedCommits: z.array(z.string()),
    createdCommits: z.array(z.string()),
  }),
});
const branchNameEventSchema = workspaceEventEnvelope.extend({
  type: z.literal("workspace/branch-name-request"),
  data: z.object({
    turn: z.literal(1),
    system: z.string().min(1),
    messages: z.tuple([
      z.object({
        role: z.literal("user"),
        source: z.object({
          kind: z.literal("plugin"),
          plugin: z.literal("conversation-workspaces"),
        }),
        content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })]),
      }),
    ]),
    provider: z.literal("deepseek-official"),
    model: z.literal("deepseek-flash"),
    maxTokens: z.literal(128),
  }),
});
const workspaceStateSchema = workspaceEventEnvelope.extend({
  type: z.literal("workspace/state"),
  data: z.object({
    workspaceId: z.literal("a".repeat(32)),
    turn: z.literal(1),
    phase: z.enum(["saving", "pending", "returned"]),
    branches: z.record(z.string(), z.string()),
    error: z.string().optional(),
  }),
});
const workspaceRequiredSchema = z.discriminatedUnion("type", [
  provenanceEventSchema,
  branchNameEventSchema,
]);
const workspaceType = z.object({ type: z.string() });

function workspaceRequiredEvents(rows: unknown[]) {
  return rows
    .filter((row) => {
      const type = workspaceType.parse(row).type;
      return type === "workspace/provenance" || type === "workspace/branch-name-request";
    })
    .map((row) => workspaceRequiredSchema.parse(row));
}

function assertWorkspaceLog(rows: unknown[], sessionId: string, requestId: string) {
  const userMessages = rows
    .filter((row) => workspaceType.parse(row).type === "user/message")
    .filter(
      (row) =>
        z.object({ data: z.object({ source: z.object({ kind: z.string() }) }) }).parse(row).data
          .source.kind === "user",
    )
    .map((row) =>
      z
        .object({
          seq: z.number().int(),
          data: z.object({
            source: z.object({ kind: z.literal("user"), rpcId: z.string() }),
            content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })]),
          }),
        })
        .parse(row),
    );
  expect(userMessages).toHaveLength(1);
  expect(userMessages[0]!.data).toEqual({
    source: { kind: "user", rpcId: requestId },
    content: [{ type: "text", text: WORKSPACE_PROVENANCE_PROMPT }],
  });
  const ends = rows
    .filter((row) => turnEndIdentity.safeParse(row).success)
    .map((row) => turnEndSchema.parse(row));
  expect(ends).toHaveLength(1);
  expect(ends[0]!.seq).toBeGreaterThan(userMessages[0]!.seq);
  const provenance = rows
    .filter((row) => workspaceType.parse(row).type === "workspace/provenance")
    .map((row) => provenanceEventSchema.parse(row));
  const naming = rows
    .filter((row) => workspaceType.parse(row).type === "workspace/branch-name-request")
    .map((row) => branchNameEventSchema.parse(row));
  const states = rows
    .filter((row) => workspaceType.parse(row).type === "workspace/state")
    .map((row) => workspaceStateSchema.parse(row));
  expect(provenance).toHaveLength(1);
  expect(naming).toHaveLength(1);
  expect(states.map((event) => event.data.phase)).toEqual(["saving", "pending", "returned"]);
  expect(states[1]!.data.error).toBe("Result branch changed outside this conversation.");
  expect(states[2]!.data.branches).toEqual(workspaceFixtureRefs);
  expect(provenance[0]!.data).toMatchObject({
    sessionId,
    eventRange: [0, ends[0]!.seq],
    refs: Object.entries(workspaceFixtureRefs).map(([branch, commit], index) => ({
      source: index === 0 ? "HEAD" : "refs/heads/main",
      branch,
      commit,
      topic: "fix-recovery",
    })),
    observedCommits: ["d".repeat(40), "e".repeat(40)],
    createdCommits: ["d".repeat(40)],
  });
  expect(provenance[0]!.seq).toBeGreaterThan(ends[0]!.seq);
  expect(states[2]!.seq).toBeGreaterThan(provenance[0]!.seq);
  expect(naming[0]!.seq).toBeGreaterThan(ends[0]!.seq);
  const input = JSON.parse(naming[0]!.data.messages[0].content[0].text);
  expect(input).toEqual({
    refs: ["HEAD", "refs/heads/main"],
    conversation: [{ seq: userMessages[0]!.seq, text: WORKSPACE_PROVENANCE_PROMPT }],
    changes: "Recorded workspace return fixture; no repository mutation is performed.",
  });
  return {
    userMessages,
    ends,
    provenance,
    naming,
    states,
    required: workspaceRequiredEvents(rows),
  };
}

/** Observe actual follow items/snapshots, without bypassing the installed Client decoder. */
function observeWorkspaceHistory(page: Page) {
  const events: unknown[] = [];
  page.on("websocket", (socket) => {
    const streams = new Set<string>();
    socket.on("framesent", ({ payload }) => {
      const raw = typeof payload === "string" ? payload : payload.toString("utf8");
      const frame = z
        .object({ type: z.string(), streamId: z.string(), endpoint: z.string().optional() })
        .safeParse(JSON.parse(raw));
      if (frame.success && frame.data.type === "open" && frame.data.endpoint === "session/follow")
        streams.add(frame.data.streamId);
    });
    socket.on("framereceived", ({ payload }) => {
      const raw = typeof payload === "string" ? payload : payload.toString("utf8");
      const frame = z
        .object({ type: z.literal("item"), streamId: z.string(), value: z.unknown() })
        .safeParse(JSON.parse(raw));
      if (!frame.success || !streams.has(frame.data.streamId)) return;
      const snapshot = z
        .object({ type: z.literal("snapshot"), records: z.array(z.unknown()) })
        .safeParse(frame.data.value);
      const records = snapshot.success ? snapshot.data.records : [frame.data.value];
      for (const record of records) {
        const entry = z
          .object({ type: z.literal("event"), event: z.object({ type: z.string() }).passthrough() })
          .safeParse(record);
        if (entry.success && entry.data.event.type.startsWith("workspace/"))
          events.push(entry.data.event);
      }
    });
  });
  return events;
}

/** Delay real workspace follow packets so draft preservation is tested across actual updates. */
async function holdWorkspaceUpdates(page: Page) {
  const pending: (() => void)[] = [];
  let released = false;
  await page.routeWebSocket("**/api/remote.mux", (socket) => {
    const server = socket.connectToServer();
    const heldStreams = new Set<string>();
    server.onMessage((message) => {
      const raw = typeof message === "string" ? message : message.toString("utf8");
      const frame = z
        .object({ type: z.string(), streamId: z.string(), value: z.unknown().optional() })
        .safeParse(JSON.parse(raw));
      if (frame.success && !released) {
        const item = z
          .object({ type: z.literal("event"), event: z.object({ type: z.string() }) })
          .safeParse(frame.data.value);
        if (item.success && item.data.event.type.startsWith("workspace/"))
          heldStreams.add(frame.data.streamId);
        if (heldStreams.has(frame.data.streamId)) {
          pending.push(() => socket.send(message));
          return;
        }
      }
      socket.send(message);
    });
  });
  return {
    count: () => pending.length,
    release() {
      released = true;
      for (const deliver of pending.splice(0)) deliver();
    },
  };
}

function observeWorkspaceMutations(page: Page, mutations: Request[]) {
  const sessionMutations = new Set([
    "create",
    "prompt",
    "cancel",
    "rename",
    "fork",
    "forkTo",
    "updateQueue",
    "selectModel",
  ]);
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.startsWith("/api/workspace/") ||
      sessionMutations.has(pathname.replace(/^\/api\/session\//, "")) ||
      /fileUploads|uploadFile/.test(pathname)
    )
      mutations.push(request);
  });
}

async function expectWorkspaceOutcome(page: Page) {
  const outcome = page
    .getByTestId("dsh-workspace-outcome")
    .filter({ hasText: "Changes saved to host branches" });
  await expect(outcome).toHaveCount(1);
  for (const branch of Object.keys(workspaceFixtureRefs)) {
    const label = outcome.getByText(branch.replace(/^refs\/heads\//, ""), { exact: true });
    await expect(label).toBeVisible();
    await expect(label).toHaveCSS("user-select", "text");
  }
  await expect(page.getByText(WORKSPACE_PROVENANCE_REPLY, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Could not read this conversation. Reconnect and try again.", { exact: true }),
  ).toHaveCount(0);
  await expectReachableComposer(page);
}

/** Storage receipts are fixture-backed; naming input and both durable event envelopes are real. */
test.describe("mounted native DSH workspace provenance compatibility", () => {
  for (const width of WIDTHS) {
    test(`reads required workspace events across reload and a fresh client at ${width}px`, async ({
      context,
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(180_000);
      const host = await launchMountedDshHost({ workspaceProvenance: true });
      const freshContext = await browser.newContext({ viewport: { width, height: 844 } });
      const mutations: Request[] = [];
      const errors: string[] = [];
      try {
        await page.setViewportSize({ width, height: 844 });
        await attachDshSession(context, host.config);
        await attachDshSession(freshContext, host.config);
        observeWorkspaceMutations(page, mutations);
        page.on("pageerror", (error) => errors.push(error.message));
        const clientIds = observeClientIds(page);
        const wireEvents = observeWorkspaceHistory(page);
        const gate = await holdWorkspaceUpdates(page);
        await page.goto(host.companionUrl);
        await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
        await createHostSession(page, host.workspaceDir);
        const sessionId = await openOnlySession(page, host.companionUrl);
        await page.getByLabel("Message").fill(host.prompt);
        await page.getByTestId("dsh-prompt-send").click();
        await expect(page.getByText(WORKSPACE_PROVENANCE_REPLY, { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        await expect.poll(gate.count).toBeGreaterThan(0);
        const draft = "Unsent draft survives required workspace events";
        await page.getByLabel("Message").fill(draft);
        await expect(page.getByTestId("dsh-workspace-outcome")).toHaveCount(0);
        await expect
          .poll(() => host.readWorkspaceNaming())
          .toEqual({ HEAD: "fix-recovery", "refs/heads/main": "fix-recovery" });
        const promptRequests = mutations.filter(
          (request) => new URL(request.url()).pathname === "/api/session/prompt",
        );
        expect(promptRequests).toHaveLength(1);
        const prompt = z
          .object({
            payload: z.object({
              args: z.object({
                request: z.object({
                  sessionId: z.string(),
                  requestId: z.string(),
                  mode: z.literal("queue"),
                  content: z.tuple([
                    z.object({
                      type: z.literal("text"),
                      text: z.literal(WORKSPACE_PROVENANCE_PROMPT),
                    }),
                  ]),
                }),
              }),
            }),
          })
          .parse(promptRequests[0]!.postDataJSON()).payload.args.request;
        expect(prompt.sessionId).toBe(sessionId);
        await expect
          .poll(async () => {
            const log = await host.readSessionLog();
            return workspaceRequiredEvents(log.rows).length;
          })
          .toBe(2);
        const log = await host.readSessionLog();
        expect(log.sessionId).toBe(sessionId);
        const evidence = assertWorkspaceLog(log.rows, sessionId, prompt.requestId);
        const heldPackets = gate.count();
        gate.release();
        await expectWorkspaceOutcome(page);
        await expect(page.getByLabel("Message")).toHaveValue(draft);
        await expect.poll(() => workspaceRequiredEvents(wireEvents)).toEqual(evidence.required);
        await page.screenshot({
          path: testInfo.outputPath(`workspace-provenance-${width}-live.png`),
        });
        const liveClientId = clientIds.at(-1);
        const liveHistory = workspaceRequiredEvents(wireEvents);
        expect(liveClientId).toBeTruthy();
        wireEvents.splice(0);
        await page.reload();
        await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
        await page.getByTestId(`dsh-open-session-${sessionId}`).click();
        await expectWorkspaceOutcome(page);
        await expect.poll(() => clientIds.at(-1)).not.toBe(liveClientId);
        await expect.poll(() => workspaceRequiredEvents(wireEvents)).toEqual(evidence.required);
        await page.screenshot({
          path: testInfo.outputPath(`workspace-provenance-${width}-reloaded.png`),
        });
        const fresh = await freshContext.newPage();
        const freshClientIds = observeClientIds(fresh);
        const freshEvents = observeWorkspaceHistory(fresh);
        observeWorkspaceMutations(fresh, mutations);
        fresh.on("pageerror", (error) => errors.push(error.message));
        expect(await openOnlySession(fresh, host.companionUrl)).toBe(sessionId);
        await expectWorkspaceOutcome(fresh);
        await expect.poll(() => workspaceRequiredEvents(freshEvents)).toEqual(evidence.required);
        expect(freshClientIds.at(-1)).toBeTruthy();
        expect(clientIds).not.toContain(freshClientIds.at(-1));
        expect(mutations.map((request) => new URL(request.url()).pathname)).toEqual([
          "/api/session/create",
          "/api/session/prompt",
        ]);
        const finalLog = await host.readSessionLog();
        expect(assertWorkspaceLog(finalLog.rows, sessionId, prompt.requestId)).toEqual(evidence);
        await fresh.screenshot({
          path: testInfo.outputPath(`workspace-provenance-${width}-fresh.png`),
        });
        const artifact = testInfo.outputPath(`workspace-provenance-${width}.json`);
        await writeFile(
          artifact,
          JSON.stringify({
            width,
            sessionId,
            requestId: prompt.requestId,
            clientIds,
            freshClientIds,
            requiredEvents: evidence.required,
            states: evidence.states,
            userMessages: evidence.userMessages,
            completedTurns: evidence.ends,
            namingTopics: await host.readWorkspaceNaming(),
            mutations: mutations.map((request) => new URL(request.url()).pathname),
            counts: {
              create: mutations.filter(
                (request) => new URL(request.url()).pathname === "/api/session/create",
              ).length,
              prompt: promptRequests.length,
              cancel: mutations.filter(
                (request) => new URL(request.url()).pathname === "/api/session/cancel",
              ).length,
              workspaceMutations: mutations.filter((request) =>
                new URL(request.url()).pathname.startsWith("/api/workspace/"),
              ).length,
              humanMessages: evidence.userMessages.length,
              completedTurns: evidence.ends.length,
              namingRequests: evidence.naming.length,
              provenance: evidence.provenance.length,
              workspaceStates: evidence.states.length,
              heldPackets,
            },
            rawReadback: {
              live: liveHistory,
              reloaded: workspaceRequiredEvents(wireEvents),
              fresh: workspaceRequiredEvents(freshEvents),
            },
            fixtureBoundary:
              "Committed storage-outcome fixture; actual naming helper with replay-only provider. No physical Git publication or receipt-store algorithm qualification.",
          }),
        );
        await testInfo.attach("workspace-provenance-compatibility", {
          path: artifact,
          contentType: "application/json",
        });
        expect(errors).toEqual([]);
      } finally {
        await freshContext.close();
        await host.close();
      }
    });
  }
});
