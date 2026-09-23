/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as dsh from "@deepseek-ai/dsh-client";
import { i18n } from "@/i18n/i18next";
import type { DshHistory } from "../history";
import { ChatContent } from "./conversation";

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));

/** The block renderers never reach the deferred-detail reader, so a read-only stub is enough. */
const history = {
  subscribe: () => () => {},
  getSnapshot: () => ({ details: new Map(), detail: "available", older: "available" }),
  loadDetail: () => Promise.resolve(),
} as unknown as DshHistory;

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
function all(selector: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(selector)];
}
function text(selector: string): string {
  const found = container.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Missing block: ${selector}`);
  return found.textContent ?? "";
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
