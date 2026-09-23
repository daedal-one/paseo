/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { DshPrompt, type DshPromptImage } from "../prompt";
import { Composer } from "./composer";
import { brandString } from "@deepseek-ai/dsh-brand";
import { selectRemoteCapabilities, type HostCapabilities } from "@deepseek-ai/dsh-client";
import {
  validateDshFileUploadValue,
  type DshPromptFilePort,
  type DshPromptFileSource,
  type DshFileUploadOperation,
} from "../files";

vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));

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
  uploadPort?: DshPromptFilePort,
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
  const listeners = new Set<() => void>();
  let generation = { id: 1, host: { home: "/private/test" } };
  const connection = {
    generation: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => generation,
    },
  };
  let next = 0;
  const prompt = new DshPrompt(
    { session: session as never, eventSource: eventSource as never },
    connection as never,
    () => `request-${++next}` as never,
    uploadPort,
  );
  return {
    prompt,
    sent,
    advanceGeneration() {
      generation = { ...generation, id: generation.id + 1 };
      for (const listener of listeners) listener();
    },
  };
}

function deferredValue<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function localFile(name = "first.bin") {
  return { name, bytes: 1, read: vi.fn(async (_signal: AbortSignal) => "YQ=="), dispose: vi.fn() };
}
function filePort(reply?: () => DshFileUploadOperation["result"]) {
  const uploads: unknown[] = [];
  const port: DshPromptFilePort = {
    capabilities: () => ({
      version: 3,
      identity: {
        version: 1,
        hostId: brandString<HostCapabilities["identity"]["hostId"]>(
          "26e99520-f2d3-4874-84b5-07c5ef24775d",
        ),
        activationId: brandString<HostCapabilities["identity"]["activationId"]>(
          "f5292bdb-ebda-41ba-b473-6c587a3c1d02",
        ),
      },
      capabilities: selectRemoteCapabilities(["fileUploads/upload"]).map((capability) =>
        Object.assign({}, capability, { availability: "available" as const }),
      ),
    }),
    start(request) {
      uploads.push(request);
      const controller = new AbortController();
      const value = validateDshFileUploadValue(
        {
          receiptId: `7ab06782-f7f6-4ad4-b6c2-${String(uploads.length).padStart(12, "0")}`,
          file: {
            attachmentId: `sha256:${"a".repeat(64)}`,
            name: request.name ?? "file",
            bytes: 1,
          },
        },
        1,
      );
      if (value === undefined) throw new Error("Invalid fixture receipt");
      return {
        signal: controller.signal,
        abort: () => controller.abort(),
        result: reply ? reply() : Promise.resolve({ ok: true, value }),
      };
    },
  };
  return { port, uploads };
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

function render(
  prompt: DshPrompt,
  pickImages: () => Promise<readonly DshPromptImage[]>,
  pickFiles: () => Promise<readonly DshPromptFileSource[]> = async () => [],
) {
  act(() => root.render(<Composer model={prompt} pickImages={pickImages} pickFiles={pickFiles} />));
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
    // The new owner epoch invalidates this picker when the other admission starts.
    expect(all("dsh-prompt-discard-selection")).toHaveLength(0);
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

describe("native DSH composer local file selection", () => {
  it("selects only metadata, removes locally and disposes without reading or uploading", async () => {
    const transport = filePort();
    const owner = promptOwner(undefined, transport.port);
    const source = localFile();
    render(
      owner.prompt,
      async () => [],
      async () => [source],
    );
    click("dsh-prompt-attach-files");
    await flush();
    expect(all("dsh-prompt-file")).toHaveLength(1);
    expect(testID("dsh-prompt-file").textContent).toContain("first.bin · 1 bytes");
    expect(source.read).not.toHaveBeenCalled();
    expect(transport.uploads).toEqual([]);
    expect(owner.sent).toEqual([]);
    expect(disabled("dsh-prompt-send")).toBe(false);
    click("dsh-prompt-file-remove");
    expect(all("dsh-prompt-file")).toHaveLength(0);
    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(disabled("dsh-prompt-send")).toBe(true);
  });

  it.each(["discard", "model", "generation"])(
    "disposes a late file picker after %s replacement",
    async (replacement) => {
      const transport = filePort();
      const owner = promptOwner(undefined, transport.port);
      const next = promptOwner(undefined, transport.port);
      const pick = deferredValue<readonly DshPromptFileSource[]>();
      const source = localFile();
      render(
        owner.prompt,
        async () => [],
        () => pick.promise,
      );
      click("dsh-prompt-attach-files");
      expect(disabled("dsh-prompt-send")).toBe(true);
      if (replacement === "discard") click("dsh-prompt-discard-selection");
      if (replacement === "model") render(next.prompt, async () => []);
      if (replacement === "generation") act(() => owner.advanceGeneration());
      await act(async () => {
        pick.resolve([source]);
        await pick.promise;
      });
      expect(owner.prompt.getSnapshot().selectedFiles).toEqual([]);
      expect(next.prompt.getSnapshot().selectedFiles).toEqual([]);
      expect(source.dispose).toHaveBeenCalledTimes(1);
      expect(source.read).not.toHaveBeenCalled();
      expect(transport.uploads).toEqual([]);
      expect(all("dsh-prompt-discard-selection")).toHaveLength(0);
    },
  );

  it("keeps the prior selection through cancellation and invalid whole batches", async () => {
    const transport = filePort();
    const owner = promptOwner(undefined, transport.port);
    const old = localFile("old.bin");
    const good = localFile("new.bin");
    const bad = { ...localFile("bad.bin"), bytes: -1 };
    const picker = vi
      .fn<() => Promise<readonly DshPromptFileSource[]>>()
      .mockResolvedValueOnce([old])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([good, bad]);
    render(owner.prompt, async () => [], picker);
    click("dsh-prompt-attach-files");
    await flush();
    click("dsh-prompt-attach-files");
    await flush();
    expect(owner.prompt.getSnapshot().selectedFiles.map((file) => file.name)).toEqual(["old.bin"]);
    expect(all("dsh-prompt-file-pick-failed")).toHaveLength(0);
    click("dsh-prompt-attach-files");
    await flush();
    expect(owner.prompt.getSnapshot().selectedFiles.map((file) => file.name)).toEqual(["old.bin"]);
    expect(all("dsh-prompt-file-pick-failed")).toHaveLength(1);
    expect(good.dispose).toHaveBeenCalledTimes(1);
    expect(bad.dispose).toHaveBeenCalledTimes(1);
    expect(old.dispose).not.toHaveBeenCalled();
    expect(old.read).not.toHaveBeenCalled();
    expect(transport.uploads).toEqual([]);
  });

  it("freezes every editor/remover during preflight and ignores a double Send", async () => {
    const transport = filePort();
    const owner = promptOwner(undefined, transport.port);
    const read = deferredValue<string>();
    const source = localFile();
    source.read.mockReturnValue(read.promise);
    owner.prompt.setText("Frozen mixed draft");
    owner.prompt.setImages([PNG]);
    render(
      owner.prompt,
      async () => [],
      async () => [source],
    );
    click("dsh-prompt-attach-files");
    await flush();
    click("dsh-prompt-send");
    expect(testID("dsh-prompt-file-status").textContent).toContain("Reading selected files");
    for (const id of [
      "dsh-prompt-text",
      "dsh-prompt-file-remove",
      "dsh-prompt-attachment-remove",
      "dsh-prompt-attach-files",
      "dsh-prompt-attach",
      "dsh-prompt-send",
    ])
      expect(disabled(id)).toBe(true);
    click("dsh-prompt-send");
    expect(transport.uploads).toEqual([]);
    expect(owner.sent).toEqual([]);
    await act(async () => {
      read.resolve("YQ==");
      await owner.prompt.send();
    });
    expect(source.read).toHaveBeenCalledTimes(1);
    expect(transport.uploads).toHaveLength(1);
    expect(owner.sent).toHaveLength(1);
    expect(owner.prompt.getSnapshot().selectedFiles).toEqual([]);
    expect(source.dispose).toHaveBeenCalledTimes(1);
  });

  it("shows pre-upload read failure and only retries on another explicit Send", async () => {
    const transport = filePort();
    const owner = promptOwner(undefined, transport.port);
    const source = localFile();
    source.read.mockRejectedValueOnce(new Error("Read failed"));
    render(
      owner.prompt,
      async () => [],
      async () => [source],
    );
    click("dsh-prompt-attach-files");
    await flush();
    await act(async () => {
      click("dsh-prompt-send");
      await owner.prompt.send();
    });
    expect(testID("dsh-prompt-file-status").textContent).toContain("Nothing was uploaded");
    expect(disabled("dsh-prompt-send")).toBe(false);
    expect(source.read).toHaveBeenCalledTimes(1);
    expect(source.dispose).not.toHaveBeenCalled();
    expect(transport.uploads).toEqual([]);
    expect(owner.sent).toEqual([]);
    await act(async () => {
      click("dsh-prompt-send");
      await owner.prompt.send();
    });
    expect(source.read).toHaveBeenCalledTimes(2);
    expect(transport.uploads).toHaveLength(1);
    expect(owner.sent).toHaveLength(1);
  });

  it("shows upload uncertainty across reconnect, blocks Send and offers explicit abandonment", async () => {
    const transport = filePort(async () => {
      throw new Error("Upload reply lost");
    });
    const owner = promptOwner(undefined, transport.port);
    const source = localFile();
    render(
      owner.prompt,
      async () => [],
      async () => [source],
    );
    click("dsh-prompt-attach-files");
    await flush();
    await act(async () => {
      click("dsh-prompt-send");
      await owner.prompt.send();
    });
    expect(testID("dsh-prompt-file-status").textContent).toContain("upload is unconfirmed");
    expect(disabled("dsh-prompt-send")).toBe(true);
    expect(disabled("dsh-prompt-text")).toBe(true);
    act(() => owner.advanceGeneration());
    expect(testID("dsh-prompt-file-status").textContent).toContain("upload is unconfirmed");
    expect(transport.uploads).toHaveLength(1);
    expect(owner.sent).toEqual([]);
    click("dsh-prompt-files-discard");
    expect(all("dsh-prompt-file")).toHaveLength(0);
    expect(owner.prompt.getSnapshot().fileUpload.kind).toBe("idle");
    expect(transport.uploads).toHaveLength(1);
    expect(owner.sent).toEqual([]);
  });

  it("describes a dispatched Host refusal separately from an unsent interrupted file intent", async () => {
    const transport = filePort();
    const owner = promptOwner(
      async () => ({
        ok: false,
        error: { code: "session/model-unavailable", message: "Model unavailable", details: {} },
      }),
      transport.port,
    );
    owner.prompt.setText("Retain this refused draft");
    render(
      owner.prompt,
      async () => [],
      async () => [localFile()],
    );
    click("dsh-prompt-attach-files");
    await flush();
    await act(async () => {
      click("dsh-prompt-send");
      await owner.prompt.send();
    });
    expect(owner.sent).toHaveLength(1);
    expect(transport.uploads).toHaveLength(1);
    const notice = testID("dsh-prompt-file-status").textContent;
    expect(notice).toContain("The Host refused this message");
    expect(notice).toContain("uploaded file references are retired");
    expect(notice).toContain("select them again before another Send");
    expect(notice).not.toContain("No message was sent");
    expect(disabled("dsh-prompt-send")).toBe(true);
    expect(disabled("dsh-prompt-files-discard")).toBe(false);
    click("dsh-prompt-files-discard");
    expect(owner.prompt.getSnapshot().selectedFiles).toEqual([]);
    expect(owner.sent).toHaveLength(1);
    expect(transport.uploads).toHaveLength(1);
  });

  it("keeps unknown file prompts locked without a discard or retry action", async () => {
    const transport = filePort();
    const owner = promptOwner(async () => {
      throw new Error("Prompt reply lost");
    }, transport.port);
    render(
      owner.prompt,
      async () => [],
      async () => [localFile()],
    );
    click("dsh-prompt-attach-files");
    await flush();
    await act(async () => {
      click("dsh-prompt-send");
      await owner.prompt.send();
    });
    expect(testID("dsh-prompt-file-status").textContent).toContain("file message is unconfirmed");
    expect(all("dsh-prompt-files-discard")).toHaveLength(0);
    expect(disabled("dsh-prompt-send")).toBe(true);
    expect(disabled("dsh-prompt-file-remove")).toBe(true);
    expect(owner.sent).toHaveLength(1);
    expect(transport.uploads).toHaveLength(1);
  });

  it("keeps text/image controls available without the optional file operation", () => {
    const owner = promptOwner();
    owner.prompt.setText("Ordinary text");
    render(owner.prompt, async () => []);
    expect(disabled("dsh-prompt-attach-files")).toBe(true);
    expect(disabled("dsh-prompt-attach")).toBe(false);
    expect(disabled("dsh-prompt-send")).toBe(false);
    expect(testID("dsh-prompt-file-status").textContent).toContain("unavailable");
  });

  it("disables the new file picker during an ordinary text send without freezing text/image editing", async () => {
    const transport = filePort();
    const reply = deferredValue<unknown>();
    const owner = promptOwner(() => reply.promise, transport.port);
    owner.prompt.setText("Ordinary text");
    render(owner.prompt, async () => []);
    click("dsh-prompt-send");
    expect(disabled("dsh-prompt-attach-files")).toBe(true);
    expect(disabled("dsh-prompt-text")).toBe(false);
    expect(disabled("dsh-prompt-attach")).toBe(false);
    await act(async () => {
      reply.resolve({ ok: true, value: { accepted: true } });
      await owner.prompt.send();
    });
  });
});
