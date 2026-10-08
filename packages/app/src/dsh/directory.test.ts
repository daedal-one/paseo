import { describe, expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { ConnectionHostId, SessionId } from "@deepseek-ai/dsh-client";
import { DshDirectory, savedDraft, type DshDirectoryAccess } from "./directory";
import { DshContinuum } from "./continuum";
import { createDshHostRuntime } from "./runtime";
const hostId = brandString<ConnectionHostId>("26e99520-f2d3-4874-84b5-07c5ef24775d");
const sessionId = brandString<SessionId>("remembered-session");
function fixture() {
  const values = new Map<string, string>();
  const storage = {
    async getItem(key: string) {
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
    async removeItem(key: string) {
      values.delete(key);
    },
  };
  const fetch = vi.fn();
  const access: DshDirectoryAccess = {
    async list() {
      return [{ hostId, origin: "https://paired.example", label: "Mac", status: "paired" }];
    },
    async pair() {},
    async forget() {},
    open: vi.fn(async (options) =>
      createDshHostRuntime({
        hostId: options.hostId,
        selection: options.selection,
        baseUrl: "https://paired.example",
        isLocal: false,
        fetch,
        createSocket: () => ({
          readyState: 0,
          send() {},
          close() {},
          addEventListener() {},
          removeEventListener() {},
        }),
        randomId: () => crypto.randomUUID(),
        timeZone: () => "UTC",
        network: { getSnapshot: () => false, subscribe: () => () => {} },
      }),
    ),
  };
  return { storage, access, fetch, values };
}
describe("restorable prompt drafts", () => {
  it("excludes sending, unconfirmed and locked text while retaining ordinary unsent text", () => {
    const base = {
      text: "local draft",
      draftLocked: false,
      submission: { kind: "idle" },
    } as import("./prompt").DshPromptSnapshot;
    expect(savedDraft(base)).toBe("local draft");
    expect(savedDraft({ ...base, draftLocked: true })).toBe("");
    expect(
      savedDraft({ ...base, submission: { kind: "sending", text: base.text, images: [] } }),
    ).toBe("");
    expect(
      savedDraft({ ...base, submission: { kind: "unknown", text: base.text, images: [] } }),
    ).toBe("");
  });
});
describe("remembered DSH directory", () => {
  it("opens the remembered offline Host and keeps a cached selection without importing or downloading history", async () => {
    const { storage, access, fetch } = fixture();
    const cache = new DshContinuum(hostId, storage);
    cache.selection.set({ sessionId });
    cache.save(sessionId, "Research", "Confirmed history", "Unsent", 10);
    await cache.flush();
    await storage.setItem("daedal-dsh:last-host:v1", hostId);
    const directory = new DshDirectory(access, storage);
    try {
      await directory.reload();
      expect(access.open).toHaveBeenCalledOnce();
      expect(directory.getSnapshot().cachedSessionId).toBe(sessionId);
      expect(directory.getSnapshot().cache?.getSnapshot().rows[0].text).toBe("Confirmed history");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await directory.dispose();
    }
  });
  it("does not substitute another Host when the remembered Host is missing", async () => {
    const { storage, access } = fixture();
    await storage.setItem("daedal-dsh:last-host:v1", "missing-host");
    const directory = new DshDirectory(access, storage);
    try {
      await directory.reload();
      expect(access.open).not.toHaveBeenCalled();
      expect(directory.getSnapshot().runtime).toBeNull();
    } finally {
      await directory.dispose();
    }
  });
  it("switches the offline preview and remembered selection without reading or submitting", async () => {
    const { storage, access, fetch } = fixture();
    const other = brandString<SessionId>("other-session");
    const cache = new DshContinuum(hostId, storage);
    cache.selection.set({ sessionId });
    cache.save(sessionId, "First", "First history", "First draft", 10);
    cache.save(other, "Second", "Second history", "Second draft", 11);
    await cache.flush();
    const directory = new DshDirectory(access, storage);
    try {
      await directory.reload();
      await directory.openConversation(other, null);
      expect(directory.getSnapshot().cachedSessionId).toBe(other);
      expect(directory.getSnapshot().conversation).toBeNull();
      await directory.suspend();
      const reopened = new DshContinuum(hostId, storage);
      await reopened.restore();
      expect(reopened.selection.getSnapshot()).toEqual({ sessionId: other });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await directory.dispose();
    }
  });
  it("forgets the Host's cached conversation and remembered selection", async () => {
    const { storage, access, values } = fixture();
    const cache = new DshContinuum(hostId, storage);
    cache.save(sessionId, "Research", "Private text", "Draft", 10);
    await cache.flush();
    access.list = async () => [];
    const directory = new DshDirectory(access, storage);
    try {
      await directory.forget(hostId);
      expect(values.size).toBe(0);
    } finally {
      await directory.dispose();
    }
  });
});
