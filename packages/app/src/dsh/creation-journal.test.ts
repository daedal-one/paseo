import { DshRegistrationJournal, type RegistrationAttemptId } from "./registration-journal";
import type { WorkspaceId } from "@deepseek-ai/dsh-client";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { ConnectionHostId, SessionId } from "@deepseek-ai/dsh-client";
import { DshCreationJournal, type CreationAttempt } from "./creation-journal";
import { createSqliteCreationStorage } from "./creation-storage-sqlite";
const host = brandString<ConnectionHostId>("host-a");
const request: CreationAttempt = {
  sessionId: brandString<SessionId>("attempt-a"),
  cwd: "/host/project",
};
describe("durable SQLite creation records", () => {
  it("survives connection replacement and protects terminal/replacement identities", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-creation-"));
    const openStore = () =>
      createSqliteCreationStorage(async () => {
        const db = new DatabaseSync(join(home, "attempts.db"));
        return {
          async exec(sql) {
            db.exec(sql);
          },
          async run(sql, params) {
            db.prepare(sql).run(...params);
          },
          async get(sql, params) {
            return (db.prepare(sql).get(...params) as { payload: string } | undefined) ?? null;
          },
          async close() {
            db.close();
          },
        };
      });
    try {
      const store = openStore();
      const first = new DshCreationJournal(host, store);
      expect(await first.read()).toBeNull();
      expect((await first.claim(request)).claimed).toBe(true);
      const cold = new DshCreationJournal(host, openStore());
      expect(await cold.read()).toEqual({ kind: "unknown", request, published: false });
      expect((await cold.claim({ sessionId: brandString<SessionId>("other") })).claimed).toBe(
        false,
      );
      expect(await cold.clear(request.sessionId)).not.toBeNull();
      await cold.settle({ kind: "unknown", request, published: true });
      await first.settle({ kind: "unknown", request, published: false });
      expect(await cold.read()).toMatchObject({ kind: "unknown", published: true });
      await cold.settle({ kind: "attachment-failed", request });
      await first.settle({ kind: "unknown", request, published: false });
      expect((await cold.read())?.kind).toBe("attachment-failed");
      await cold.settle({ kind: "accepted", request });
      await first.settle({ kind: "unknown", request, published: false });
      expect((await cold.read())?.kind).toBe("accepted");
      await cold.clear(request.sessionId);
      const next = { sessionId: brandString<SessionId>("next") };
      await cold.claim(next);
      await first.clear(request.sessionId);
      await first.settle({ kind: "rejected", request, code: "late" });
      expect((await cold.read())?.request).toEqual(next);
      expect(
        await new DshCreationJournal(brandString<ConnectionHostId>("host-b"), store).read(),
      ).toBeNull();
      for (const corrupt of [
        "{",
        JSON.stringify({ version: 2 }),
        JSON.stringify({
          version: 1,
          hostId: "wrong",
          outcome: { kind: "unknown", request, published: false },
        }),
      ]) {
        await store.transact(host, () => corrupt);
        await expect(cold.read()).rejects.toThrow();
        await expect(cold.claim(request)).rejects.toThrow();
        expect((await store.transact(host, (value) => value)).after).toBe(corrupt);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

it("keeps Workspace registration separate and protects durable identity through fresh SQLite connections", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-registration-"));
  function storage(name: string) {
    return createSqliteCreationStorage(async () => {
      const db = new DatabaseSync(join(home, name));
      return {
        async exec(sql) {
          db.exec(sql);
        },
        async run(sql, params) {
          db.prepare(sql).run(...params);
        },
        async get(sql, params) {
          return (db.prepare(sql).get(...params) as { payload: string } | undefined) ?? null;
        },
        async close() {
          db.close();
        },
      };
    });
  }
  const registrationRequest = {
    attemptId: brandString<RegistrationAttemptId>("one"),
    path: "/host/alias",
  };
  const workspace = {
    workspaceId: brandString<WorkspaceId>("workspace"),
    path: "/host/project",
    title: "Project",
  };
  try {
    const session = new DshCreationJournal(host, storage("session.db"));
    await session.claim({ sessionId: brandString<SessionId>("session") });
    const one = new DshRegistrationJournal(host, storage("registration.db"));
    expect((await one.claim(registrationRequest)).claimed).toBe(true);
    const cold = new DshRegistrationJournal(host, storage("registration.db"));
    expect(await cold.read()).toEqual({ kind: "unknown", request: registrationRequest });
    expect(
      (
        await cold.claim({
          ...registrationRequest,
          attemptId: brandString<RegistrationAttemptId>("two"),
        })
      ).claimed,
    ).toBe(false);
    expect((await cold.clear(registrationRequest.attemptId))?.kind).toBe("unknown");
    await cold.settle({ kind: "adopted", request: registrationRequest, workspace });
    await one.settle({ kind: "unknown", request: registrationRequest });
    expect((await cold.read())?.kind).toBe("adopted");
    await cold.clear(registrationRequest.attemptId);
    const next = { ...registrationRequest, attemptId: brandString<RegistrationAttemptId>("next") };
    await cold.claim(next);
    await one.clear(registrationRequest.attemptId);
    await one.settle({ kind: "confirmed", request: registrationRequest, workspace });
    expect((await cold.read())?.request).toEqual(next);
    expect((await session.read())?.request.sessionId).toBe("session");
    expect(
      await new DshRegistrationJournal(
        brandString<ConnectionHostId>("host-b"),
        storage("registration.db"),
      ).read(),
    ).toBeNull();
    const store = storage("registration.db");
    for (const corrupt of [
      "{",
      JSON.stringify({ version: 2 }),
      JSON.stringify({
        version: 1,
        hostId: "wrong",
        outcome: { kind: "unknown", request: registrationRequest },
      }),
      JSON.stringify({
        version: 1,
        hostId: host,
        outcome: { kind: "confirmed", request: registrationRequest },
      }),
    ]) {
      await store.transact(host, () => corrupt);
      await expect(cold.read()).rejects.toThrow();
      await expect(cold.claim(registrationRequest)).rejects.toThrow();
      await expect(
        cold.settle({ kind: "confirmed", request: registrationRequest, workspace }),
      ).rejects.toThrow();
      expect((await store.transact(host, (value) => value)).after).toBe(corrupt);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
