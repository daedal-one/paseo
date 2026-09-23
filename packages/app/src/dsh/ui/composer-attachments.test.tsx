/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { DshPrompt, type DshPromptImage } from "../prompt";
import { Composer } from "./composer";

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  const AdaptiveModalSheet = () => null;
  const AdaptiveTextInput = ReactModule.forwardRef<HTMLInputElement, Record<string, unknown>>(
    (props, ref) => {
      const p = props as {
        initialValue?: string;
        editable?: boolean;
        testID?: string;
        accessibilityLabel?: string;
        onChangeText?: (next: string) => void;
      };
      return ReactModule.createElement("input", {
        ref,
        defaultValue: p.initialValue ?? "",
        disabled: p.editable === false,
        "data-testid": p.testID,
        "aria-label": p.accessibilityLabel,
        onChange: (e: { target: { value: string } }) => p.onChangeText?.(e.target.value),
      });
    },
  );
  return { AdaptiveModalSheet, AdaptiveTextInput };
});

const PNG: DshPromptImage = { mediaType: "image/png", data: "iVBORw0KGgo=", name: "shot.png" };
const JPEG: DshPromptImage = { mediaType: "image/jpeg", data: "/9j/4AAQ" };

/** The real prompt owner over a Session and event source that never confirm anything by themselves. */
function promptOwner(
  reply: () => Promise<unknown> = async () => ({ ok: true, value: { accepted: true } }),
) {
  const sent: { content: unknown }[] = [];
  const sessionSnapshot = {
    subagent: null,
    removed: false,
    openState: "open",
    queue: [] as unknown[],
  };
  const session = {
    subscribe: () => () => {},
    getSnapshot: () => sessionSnapshot,
    prompt: async (content: unknown) => {
      sent.push({ content });
      return await reply();
    },
  };
  const eventSource = {
    subscribe: () => () => {},
    getSnapshot: () => ({ revision: 1, change: { kind: "settle-assistant" }, entries: [] }),
  };
  const connection = {
    generation: { subscribe: () => () => {}, getSnapshot: () => "generation-1" },
  };
  let next = 0;
  const prompt = new DshPrompt(
    { session: session as never, eventSource: eventSource as never },
    connection as never,
    () => `request-${++next}` as never,
  );
  return { prompt, sent };
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

function render(prompt: DshPrompt, pickImages: () => Promise<readonly DshPromptImage[]>) {
  act(() => root.render(<Composer model={prompt} pickImages={pickImages} />));
}
function testID(id: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-testid=${id}]`);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found;
}
function all(id: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-testid=${id}]`)];
}
function click(id: string): void {
  act(() => testID(id).click());
}
function disabled(id: string): boolean {
  const element = testID(id);
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    element.getAttribute("data-disabled") === "true"
  );
}
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("native DSH composer attachments", () => {
  it("attaches picked images as ordered chips and allows an image-only send", async () => {
    const { prompt } = promptOwner();
    render(prompt, async () => [PNG, JPEG]);
    expect(disabled("dsh-prompt-send")).toBe(true);
    click("dsh-prompt-attach");
    await flush();
    expect(prompt.getSnapshot().images).toEqual([PNG, JPEG]);
    expect(container.textContent).toContain("Images to send: 2");
    expect(container.textContent).toContain("shot.png · image/png");
    expect(container.textContent).toContain("image/jpeg");
    expect(disabled("dsh-prompt-send")).toBe(false);
  });

  it("removes a single attachment and disables the image-only send again", async () => {
    const { prompt } = promptOwner();
    render(prompt, async () => [PNG]);
    click("dsh-prompt-attach");
    await flush();
    expect(all("dsh-prompt-attachment")).toHaveLength(1);
    click("dsh-prompt-attachment-remove");
    expect(prompt.getSnapshot()).toMatchObject({ images: [], canSend: false });
    expect(all("dsh-prompt-attachment")).toHaveLength(0);
    expect(disabled("dsh-prompt-send")).toBe(true);
  });

  it("shows a visible failure and attaches nothing when the picker cannot read a selection", async () => {
    const { prompt } = promptOwner();
    render(prompt, async () => {
      throw new Error("unreadable selection");
    });
    click("dsh-prompt-attach");
    await flush();
    expect(testID("dsh-prompt-attach-failed").textContent).not.toBe("");
    expect(prompt.getSnapshot().images).toEqual([]);
    expect(all("dsh-prompt-attachment")).toHaveLength(0);
    expect(disabled("dsh-prompt-send")).toBe(true);
  });

  it("freezes the attach control and keeps retained images visible while an outcome is unknown", async () => {
    const { prompt, sent } = promptOwner(async () => {
      throw new Error("Reply lost after dispatch");
    });
    render(prompt, async () => [PNG]);
    click("dsh-prompt-attach");
    await flush();
    await act(async () => {
      await prompt.send();
    });
    expect(sent).toHaveLength(1);
    expect(prompt.getSnapshot().submission.kind).toBe("unknown");
    expect(testID("dsh-prompt-unconfirmed-images").textContent).toContain("1");
    expect(disabled("dsh-prompt-attach")).toBe(true);
    click("dsh-prompt-attach");
    await flush();
    expect(prompt.getSnapshot().images).toEqual([PNG]);
    expect(sent).toHaveLength(1);
  });
});
