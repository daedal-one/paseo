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
