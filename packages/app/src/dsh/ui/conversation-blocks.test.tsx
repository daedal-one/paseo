/** @vitest-environment jsdom */
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as dsh from "@deepseek-ai/dsh-client";
import { brandString } from "@deepseek-ai/dsh-brand";
import { i18n } from "@/i18n/i18next";
import type { DshHistory } from "../history";
import { ChatContent } from "./conversation";
import { Queue } from "./queue";

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));

/** The block renderers never reach the deferred-detail reader, so a read-only stub is enough. */
const history = {
  subscribe: () => () => {},
  getSnapshot: () => ({ details: new Map(), detail: "available", older: "available" }),
  loadDetail: () => Promise.resolve(),
} as unknown as DshHistory;

type QueueItems = ComponentProps<typeof Queue>["queue"];
type QueueImage = Extract<QueueItems[number]["content"][number], { type: "image" }>;
type QueueAvailability = ComponentProps<typeof Queue>["availability"];

const queueFixture: QueueItems = [
  {
    id: "queued-first",
    messageId: "message-first",
    placement: "queued",
    content: [{ type: "text", text: "First queued message" }],
    preview: "First queued message",
    text: "First queued message",
  },
  {
    id: "steering-image",
    messageId: "message-image",
    placement: "steering",
    content: [
      {
        type: "image",
        attachment: {
          attachmentId: brandString<QueueImage["attachment"]["attachmentId"]>("queued-image"),
          mediaType: "image/png",
          bytes: 2048,
          width: 640,
          height: 480,
          name: "diagram.png",
        },
      },
    ],
    preview: "diagram.png",
    text: null,
  },
  {
    id: "context-last",
    messageId: "message-last",
    placement: "context",
    content: [{ type: "text", text: "Last context message" }],
    preview: "Last context message",
    text: "Last context message",
  },
];

/** One synthetic conversation row; the presentation contract is what this harness exercises. */
function row(kind: string, data: unknown): dsh.ChatConversationViewNode {
  return { kind, data, target: "chat", anchorSeq: 1, visibility: "visible" } as never;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(node: dsh.ChatConversationViewNode): void {
  act(() => root.render(<ChatContent node={node} history={history} />));
}
function renderQueue(queue: QueueItems, availability: QueueAvailability): void {
  act(() => root.render(<Queue queue={queue} availability={availability} />));
}
function all(selector: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(selector)];
}
function text(selector: string): string {
  const found = container.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Missing block: ${selector}`);
  return found.textContent ?? "";
}
function click(selector: string): void {
  const found = container.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Missing control: ${selector}`);
  act(() => found.click());
}
function queueItem(index: number): HTMLElement {
  const item = all("[data-testid=dsh-queue-item]")[index];
  if (item === undefined) throw new Error(`Missing queue item: ${index}`);
  return item;
}
function queueItemText(index: number): string {
  return queueItem(index).textContent ?? "";
}

describe("transcript content blocks", () => {
  it("renders text and reasoning assistant blocks", () => {
    render(
      row("assistant-step", {
        status: "settled",
        turn: 1,
        step: 1,
        blocks: [
          { kind: "text", text: "answer text" },
          { kind: "reasoning", text: "private thinking" },
        ],
        time: 1,
      }),
    );
    expect(text("[data-testid=dsh-block-text]")).toBe("answer text");
    expect(text("[data-testid=dsh-block-reasoning]")).toContain("private thinking");
    expect(all("[data-testid=dsh-block-unsupported]")).toHaveLength(0);
  });

  it("renders an image block by its stored metadata instead of a placeholder", () => {
    render(
      row("assistant-step", {
        status: "settled",
        turn: 1,
        step: 1,
        blocks: [
          {
            kind: "image",
            attachment: {
              attachmentId: "a",
              mediaType: "image/png",
              bytes: 2048,
              width: 640,
              height: 480,
              name: "diagram.png",
            },
          },
        ],
        time: 1,
      }),
    );
    const rendered = text("[data-testid=dsh-block-image]");
    expect(rendered).toContain("diagram.png");
    expect(rendered).toContain("image/png");
    expect(rendered).toContain("640×480");
    expect(rendered).toContain("2048");
    expect(all("[data-testid=dsh-block-unsupported]")).toHaveLength(0);
  });

  it("names an unnamed image and renders a file block with its size", () => {
    render(
      row("user", {
        seq: 1,
        time: 1,
        content: [
          {
            type: "image",
            attachment: {
              attachmentId: "b",
              mediaType: "image/jpeg",
              bytes: 10,
              width: 2,
              height: 3,
            },
          },
          { type: "file", attachment: { attachmentId: "c", name: "notes.md", bytes: 4096 } },
        ],
      }),
    );
    expect(text("[data-testid=dsh-block-image]")).toContain("Attached image");
    const file = text("[data-testid=dsh-block-file]");
    expect(file).toContain("notes.md");
    expect(file).toContain("4096");
  });

  it("renders a tool call and a tool result separately, labelling a failure", () => {
    render(
      row("user", {
        seq: 1,
        time: 1,
        content: [
          { type: "tool-call", id: "call-1", name: "bash", arguments: '{"command":"echo hi"}' },
          {
            type: "tool-result",
            toolCallId: "call-1",
            content: [{ type: "text", text: "hi" }],
            isError: true,
          },
        ],
      }),
    );
    expect(text("[data-testid=dsh-block-tool-call]")).toContain("bash");
    expect(text("[data-testid=dsh-block-tool-call]")).toContain("echo hi");
    const result = text("[data-testid=dsh-block-tool-result]");
    expect(result).toContain("Tool failed");
    expect(result).toContain("hi");
  });

  it("renders a settled tool row with its status and result content", () => {
    render(
      row("tool-call", {
        root: {
          kind: "tool-result",
          seq: 4,
          time: 2,
          callId: "call-1",
          call: { name: "bash", argsRaw: '{"command":"echo hi"}' },
          callTime: 1,
          content: [{ type: "text", text: "hi from bash" }],
          isError: false,
          subCalls: [],
        },
      }),
    );
    expect(text("[data-testid=dsh-tool-result]")).toContain("bash");
    expect(text("[data-testid=dsh-tool-status]")).toBe("Tool finished");
    expect(text("[data-testid=dsh-tool-result]")).toContain("hi from bash");
    expect(all("[data-testid=dsh-tool-subcalls]")).toHaveLength(0);
  });

  it("counts dispatched subcalls and reports the subagent total on the process row", () => {
    render(
      row("tool-call", {
        root: {
          kind: "tool-result",
          seq: 4,
          time: 2,
          callId: "call-1",
          call: { name: "dispatch", argsRaw: "{}" },
          callTime: 1,
          content: [],
          isError: false,
          subCalls: [{ kind: "running", call: { name: "child", argsRaw: "{}" } }],
        },
      }),
    );
    render(
      row("turn-process", {
        turn: 1,
        controlAnchorSeq: 1,
        processStartSeq: 1,
        answerAnchorSeq: null,
        answerStep: null,
        inlineReasoning: false,
        messageCount: 3,
        toolCallCount: 2,
        subagentCount: 2,
      }),
    );
    expect(text("[data-testid=dsh-turn-process]")).toContain("2 agents");
  });

  it("labels an unknown block or node instead of dropping it silently", () => {
    render(row("user", { seq: 1, time: 1, content: [{ type: "hologram", data: 1 }] }));
    expect(all("[data-testid=dsh-block-unsupported]")).toHaveLength(1);
    render(row("some-future-node", {}));
    expect(all("[data-testid=dsh-node-unsupported]")).toHaveLength(1);
  });

  it("renders a turn error row with its message", () => {
    render(row("turn-error", { message: "provider refused", name: "Failure", code: "x" }));
    const rendered = text("[data-testid=dsh-turn-error]");
    expect(rendered).toContain("provider refused");
  });
});

describe("native queue visibility", () => {
  it("keeps Host queue rows collapsed until expanded and preserves their order and metadata", () => {
    renderQueue(queueFixture, "available");
    expect(text("[data-testid=dsh-queue-toggle]")).toBe("Last observed queue (3)");
    expect(all("[data-testid=dsh-queue]")).toHaveLength(0);
    expect(all("[data-testid=dsh-queue-item]")).toHaveLength(0);

    click("[data-testid=dsh-queue-toggle]");

    expect(all("[data-testid=dsh-queue-item]")).toHaveLength(3);
    expect(queueItemText(0)).toContain("Queued");
    expect(queueItemText(0)).toContain("First queued message");
    expect(queueItemText(1)).toContain("Steering");
    expect(queueItemText(1)).toContain("diagram.png");
    expect(queueItemText(1)).toContain("image/png");
    expect(queueItemText(1)).toContain("640×480");
    expect(queueItemText(1)).toContain("2048");
    expect(queueItemText(2)).toContain("Context");
    expect(queueItemText(2)).toContain("Last context message");
    expect(container.textContent).toContain("Queue editing is unavailable here");
    expect(all("[data-testid=dsh-queue-edit]")).toHaveLength(0);
    expect(all("[data-testid=dsh-queue-remove]")).toHaveLength(0);
    expect(all("[data-testid=dsh-queue-move]")).toHaveLength(0);
  });

  it("does not render a large Host queue until the user expands it", () => {
    const first = queueFixture[0];
    if (first === undefined) throw new Error("Missing queue fixture");
    const largeQueue: QueueItems = Array.from({ length: 200 }, (_, index) => ({
      ...first,
      id: `queued-${index}`,
      messageId: `message-${index}`,
    }));
    renderQueue(largeQueue, "available");

    expect(all("[data-testid=dsh-queue-item]")).toHaveLength(0);

    click("[data-testid=dsh-queue-toggle]");

    expect(all("[data-testid=dsh-queue-item]")).toHaveLength(20);
    expect(text("[data-testid=dsh-queue-overflow]")).toContain("first 20 of 200");
  });

  it("replaces and withdraws rows directly from the latest Host snapshot", () => {
    const replacement = queueFixture.find((item) => item.id === "steering-image");
    if (replacement === undefined) throw new Error("Missing queue fixture");
    renderQueue(queueFixture, "available");
    click("[data-testid=dsh-queue-toggle]");

    renderQueue([replacement], "available");

    expect(all("[data-testid=dsh-queue-item]")).toHaveLength(1);
    expect(text("[data-testid=dsh-queue]")).toContain("diagram.png");
    expect(text("[data-testid=dsh-queue]")).not.toContain("First queued message");

    renderQueue([], "available");

    expect(all("[data-testid=dsh-queue-item]")).toHaveLength(0);
    expect(text("[data-testid=dsh-queue]")).toContain("No entries in the last observed queue");
  });

  it("distinguishes stale and unavailable snapshots from an observed empty queue", () => {
    renderQueue([], "stale");
    click("[data-testid=dsh-queue-toggle]");

    expect(text("[data-testid=dsh-queue]")).toContain("Queued message state may be out of date");
    expect(text("[data-testid=dsh-queue]")).not.toContain("No entries in the last observed queue");

    renderQueue([], "unavailable");

    expect(text("[data-testid=dsh-queue]")).toContain("Queued message state is unavailable");
    expect(text("[data-testid=dsh-queue]")).not.toContain("No entries in the last observed queue");

    renderQueue([], "available");

    expect(text("[data-testid=dsh-queue]")).toContain("No entries in the last observed queue");
  });

  it("labels content without a text or preview representation as unavailable here", () => {
    const unsupported: QueueItems = [
      {
        id: "unsupported",
        messageId: "unsupported-message",
        placement: "queued",
        content: [],
        preview: "",
        text: null,
      },
    ];
    renderQueue(unsupported, "available");
    click("[data-testid=dsh-queue-toggle]");

    expect(text("[data-testid=dsh-queue]")).toContain(
      "Open the current DSH interface to inspect this queued content",
    );
  });
});
