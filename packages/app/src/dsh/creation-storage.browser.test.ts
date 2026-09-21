import { expect, it } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { ConnectionHostId, SessionId } from "@deepseek-ai/dsh-client";
import { DshCreationJournal } from "./creation-journal";
import { createDshCreationStorage } from "./creation-storage.web";
it("serializes competing database connections and restores committed requests", async () => {
  const name = `dsh-creation-test-${crypto.randomUUID()}`;
  const host = brandString<ConnectionHostId>("host");
  const request = { sessionId: brandString<SessionId>("one"), cwd: "/host" };
  const one = new DshCreationJournal(host, createDshCreationStorage(name));
  const two = new DshCreationJournal(host, createDshCreationStorage(name));
  try {
    const claims = await Promise.all([
      one.claim(request),
      two.claim({ sessionId: brandString<SessionId>("two") }),
    ]);
    expect(claims.filter((value) => value.claimed)).toHaveLength(1);
    const winner = claims.find((value) => value.claimed)!.outcome.request;
    const cold = new DshCreationJournal(host, createDshCreationStorage(name));
    expect((await cold.read())?.request).toEqual(winner);
    await cold.settle({ kind: "accepted", request: winner });
    await one.settle({ kind: "unknown", request: winner, published: false });
    expect((await two.read())?.kind).toBe("accepted");
    const storage = createDshCreationStorage(name);
    await storage.transact(host, () => "corrupt");
    await expect(cold.claim(request)).rejects.toThrow();
    expect((await storage.transact(host, (value) => value)).after).toBe("corrupt");
  } finally {
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(name);
      deletion.addEventListener("success", () => resolve());
      deletion.addEventListener("error", () => reject(deletion.error));
    });
  }
});
