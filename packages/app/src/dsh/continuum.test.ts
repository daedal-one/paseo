import { describe, expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { ConnectionHostId, SessionId } from "@deepseek-ai/dsh-client";
import { DshContinuum } from "./continuum";
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
  return { storage, values };
}
const host = brandString<ConnectionHostId>("host-a");
const session = brandString<SessionId>("session-a");
describe("DSH continuum", () => {
  it("reports a failed write and recovers when a later complete snapshot is stored", async () => {
    const { storage } = fixture();
    const set = vi
      .spyOn(storage, "setItem")
      .mockRejectedValueOnce(new Error("storage unavailable"));
    const cache = new DshContinuum(host, storage);
    cache.save(session, "Conversation", "History", "First draft", 5);
    await expect(cache.flush()).rejects.toThrow("Continuum storage unavailable");
    cache.save(session, "Conversation", "History", "New draft", 6);
    await cache.flush();
    expect(set).toHaveBeenCalledTimes(2);
    const reopened = new DshContinuum(host, storage);
    await reopened.restore();
    expect(reopened.getSnapshot().rows[0].draft).toBe("New draft");
  });
  it("restores drafts and selection only on their owning Host", async () => {
    const { storage } = fixture();
    const first = new DshContinuum(host, storage);
    first.selection.set({ sessionId: session });
    first.save(session, "Conversation", "History", "Unsent", 5);
    await first.flush();
    const restored = new DshContinuum(host, storage);
    await restored.restore();
    expect(restored.selection.getSnapshot()).toEqual({ sessionId: session });
    expect(restored.getSnapshot().rows[0].draft).toBe("Unsent");
    const other = new DshContinuum(brandString<ConnectionHostId>("host-b"), storage);
    await other.restore();
    expect(other.getSnapshot().rows).toEqual([]);
  });
  it("retains an addressed child without replacing its parent or Host identity", async () => {
    const { storage } = fixture();
    const cache = new DshContinuum(host, storage);
    const subagentAddress = {
      parentSessionId: brandString<SessionId>("parent"),
      childSessionId: session,
      mode: "continuable" as const,
    };
    cache.selection.set({ sessionId: session, subagentAddress });
    await cache.flush();
    const reopened = new DshContinuum(host, storage);
    await reopened.restore();
    expect(reopened.selection.getSnapshot()).toEqual({ sessionId: session, subagentAddress });
  });
  it("bounds recent transcripts and drafts and removes all Host state on forgetting", async () => {
    const { storage, values } = fixture();
    const cache = new DshContinuum(host, storage);
    for (let i = 0; i < 12; i++)
      cache.save(
        brandString<SessionId>(String(i)),
        "Title",
        "x".repeat(150_000),
        "y".repeat(70_000),
        i,
      );
    expect(cache.getSnapshot().rows).toHaveLength(8);
    expect(cache.getSnapshot().rows[0].text).toHaveLength(128_000);
    expect(cache.getSnapshot().rows[0].draft).toHaveLength(64_000);
    await cache.forget();
    expect(values.size).toBe(0);
  });
  it("discards corrupt persisted projections", async () => {
    const { storage, values } = fixture();
    values.set(`daedal-dsh:continuum:v1:${host}`, '{"version":0}');
    const cache = new DshContinuum(host, storage);
    await cache.restore();
    expect(cache.getSnapshot().rows).toEqual([]);
    expect(values.size).toBe(0);
  });
});
