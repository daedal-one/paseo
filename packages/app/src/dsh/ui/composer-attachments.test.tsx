/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { DshPrompt, type DshPromptImage } from "../prompt";
import { Composer } from "./composer";

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  const AdaptiveModalSheet = () => null;
  const AdaptiveTextInput = ReactModule.forwardRef<EditingTextInputHandle, Record<string, unknown>>(
    (props, ref) => {
      const p = props as {
        initialValue?: string;
        editable?: boolean;
        testID?: string;
        accessibilityLabel?: string;
        onChangeText?: (next: string) => void;
      };
      const input = ReactModule.useRef<HTMLInputElement>(null);
      ReactModule.useImperativeHandle(ref, () => ({
        focus: () => input.current?.focus(),
        blur: () => input.current?.blur(),
        isFocused: () => document.activeElement === input.current,
        getText: () => input.current?.value ?? "",
        replaceText: (text) => {
          if (input.current) input.current.value = text;
        },
        reset: () => {
          if (input.current) input.current.value = "";
        },
        getNativeRef: () => input.current,
      }));
      return ReactModule.createElement("input", {
        ref: input,
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

function deferredPick() {
  let resolve: (images: readonly DshPromptImage[]) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<readonly DshPromptImage[]>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const stalePickerOutcomes = [
  { label: "resolve", settle: (pick: ReturnType<typeof deferredPick>) => pick.resolve([PNG]) },
  {
    label: "reject",
    settle: (pick: ReturnType<typeof deferredPick>) =>
      pick.reject(new Error("Late picker failure")),
  },
];

describe("native DSH composer attachments", () => {
  it.each(stalePickerOutcomes)(
    "discards locally and ignores stale $label while a newer picker is pending",
    async ({ settle }) => {
      const { prompt, sent } = promptOwner();
      prompt.setText("Keep existing draft");
      prompt.setImages([JPEG]);
      const old = deferredPick();
      const current = deferredPick();
      const picker = vi
        .fn<() => Promise<readonly DshPromptImage[]>>()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      render(prompt, picker);
      click("dsh-prompt-attach");
      click("dsh-prompt-discard-selection");
      expect(disabled("dsh-prompt-send")).toBe(false);
      expect(prompt.getSnapshot()).toMatchObject({ text: "Keep existing draft", images: [JPEG] });
      expect(sent).toEqual([]);
      click("dsh-prompt-attach");
      await act(async () => {
        settle(old);
        await Promise.resolve();
      });
      expect(disabled("dsh-prompt-send")).toBe(true);
      expect(all("dsh-prompt-discard-selection")).toHaveLength(1);
      expect(all("dsh-prompt-attach-failed")).toHaveLength(0);
      expect(prompt.getSnapshot().images).toEqual([JPEG]);
      await act(async () => {
        current.resolve([PNG]);
        await current.promise;
      });
      expect(prompt.getSnapshot().images).toEqual([JPEG, PNG]);
      expect(disabled("dsh-prompt-send")).toBe(false);
      expect(sent).toEqual([]);
    },
  );

  it("invalidates a pending selection when the model changes", async () => {
    const old = promptOwner();
    const next = promptOwner();
    const pick = deferredPick();
    render(old.prompt, () => pick.promise);
    click("dsh-prompt-attach");
    render(next.prompt, async () => []);
    await act(async () => {
      pick.resolve([PNG]);
      await pick.promise;
    });
    expect(old.prompt.getSnapshot().images).toEqual([]);
    expect(next.prompt.getSnapshot().images).toEqual([]);
    expect(all("dsh-prompt-discard-selection")).toHaveLength(0);
    expect(disabled("dsh-prompt-attach")).toBe(false);
  });

  it("does not release an unknown Host outcome when discarding a local picker", async () => {
    const { prompt, sent } = promptOwner(async () => {
      throw new Error("Reply lost");
    });
    prompt.setImages([JPEG]);
    const pick = deferredPick();
    render(prompt, () => pick.promise);
    click("dsh-prompt-attach");
    // Simulate another owner starting admission while the local picker is pending.
    await act(async () => {
      await prompt.send();
    });
    click("dsh-prompt-discard-selection");
    await act(async () => {
      pick.resolve([PNG]);
      await pick.promise;
    });
    expect(prompt.getSnapshot()).toMatchObject({ images: [JPEG], submission: { kind: "unknown" } });
    expect(disabled("dsh-prompt-send")).toBe(true);
    expect(disabled("dsh-prompt-attach")).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("invalidates a pending selection when the composer unmounts", async () => {
    const { prompt } = promptOwner();
    const pick = deferredPick();
    render(prompt, () => pick.promise);
    click("dsh-prompt-attach");
    act(() => root.render(null));
    await act(async () => {
      pick.resolve([PNG]);
      await pick.promise;
    });
    expect(prompt.getSnapshot().images).toEqual([]);
  });

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

  it("does not send a draft while the picker is still resolving", async () => {
    const { prompt, sent } = promptOwner();
    let finish: (images: readonly DshPromptImage[]) => void = () => {};
    const picked = new Promise<readonly DshPromptImage[]>((resolve) => {
      finish = resolve;
    });
    prompt.setText("Include this image");
    render(prompt, () => picked);
    click("dsh-prompt-attach");
    expect(disabled("dsh-prompt-send")).toBe(true);
    click("dsh-prompt-send");
    await flush();
    expect(sent).toEqual([]);
    await act(async () => {
      finish([PNG]);
      await picked;
    });
    expect(disabled("dsh-prompt-send")).toBe(false);
    click("dsh-prompt-send");
    await flush();
    expect(sent).toEqual([
      {
        content: [
          { type: "text", text: "Include this image" },
          { type: "image", ...PNG },
        ],
      },
    ]);
  });

  it("preserves the previous draft when a new selection fails", async () => {
    const { prompt, sent } = promptOwner();
    prompt.setText("Keep this draft");
    prompt.setImages([JPEG]);
    render(prompt, async () => {
      throw new Error("Mixed selection could not be read");
    });
    click("dsh-prompt-attach");
    await flush();
    expect(prompt.getSnapshot()).toMatchObject({ text: "Keep this draft", images: [JPEG] });
    expect(all("dsh-prompt-attach-failed")).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("preserves the previous draft when image selection is cancelled", async () => {
    const { prompt, sent } = promptOwner();
    prompt.setImages([JPEG]);
    render(prompt, async () => []);
    click("dsh-prompt-attach");
    await flush();
    expect(prompt.getSnapshot().images).toEqual([JPEG]);
    expect(all("dsh-prompt-attach-failed")).toHaveLength(0);
    expect(disabled("dsh-prompt-send")).toBe(false);
    expect(sent).toEqual([]);
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
