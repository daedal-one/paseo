import { DshRegistrationJournal, type RegistrationAttemptId } from "./registration-journal";
import type { WorkspaceId } from "@deepseek-ai/dsh-client";
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

it("atomically claims registration across browser connections without consuming Session creation", async () => {
  const name = `dsh-registration-test-${crypto.randomUUID()}`;
  const sessionName = `${name}-sessions`;
  const host = brandString<ConnectionHostId>("host");
  const one = new DshRegistrationJournal(host, createDshCreationStorage(name));
  const two = new DshRegistrationJournal(host, createDshCreationStorage(name));
  const request = { attemptId: brandString<RegistrationAttemptId>("one"), path: "/host/one" };
  try {
    const session = new DshCreationJournal(host, createDshCreationStorage(sessionName));
    await session.claim({ sessionId: brandString<SessionId>("session") });
    const claims = await Promise.all([
      one.claim(request),
      two.claim({ attemptId: brandString<RegistrationAttemptId>("two"), path: "/host/two" }),
    ]);
    expect(claims.filter((value) => value.claimed)).toHaveLength(1);
    const winner = claims.find((value) => value.claimed)!.outcome.request;
    const cold = new DshRegistrationJournal(host, createDshCreationStorage(name));
    expect(await cold.read()).toEqual({ kind: "unknown", request: winner });
    const workspace = {
      workspaceId: brandString<WorkspaceId>("workspace"),
      path: "/canonical",
      title: "Current",
    };
    await cold.settle({ kind: "adopted", request: winner, workspace });
    await one.settle({ kind: "unknown", request: winner });
    expect((await two.read())?.kind).toBe("adopted");
    expect((await session.read())?.request.sessionId).toBe("session");
    const store = createDshCreationStorage(name);
    await store.transact(host, () => "corrupt");
    await expect(cold.read()).rejects.toThrow();
    await expect(cold.claim(request)).rejects.toThrow();
    expect((await store.transact(host, (value) => value)).after).toBe("corrupt");
  } finally {
    for (const database of [name, sessionName])
      await new Promise<void>((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(database);
        deletion.addEventListener("success", () => resolve());
        deletion.addEventListener("error", () => reject(deletion.error));
      });
  }
});
