import type { DshCreationStorage } from "./creation-journal";
export interface CreationSqliteConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, params: string[]): Promise<void>;
  get(sql: string, params: string[]): Promise<{ payload: string } | null>;
  close(): Promise<void>;
}
/** Dedicated connections keep each claim inside its own SQLite write transaction. */
export function createSqliteCreationStorage(
  open: () => Promise<CreationSqliteConnection>,
): DshCreationStorage {
  return {
    async transact(hostId, update) {
      const db = await open();
      try {
        await db.exec(
          "PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS attempts (host_id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
        );
        await db.exec("BEGIN IMMEDIATE");
        try {
          const before =
            (await db.get("SELECT payload FROM attempts WHERE host_id = ?", [hostId]))?.payload ??
            null;
          const after = update(before);
          if (after !== before) {
            if (after === null) await db.run("DELETE FROM attempts WHERE host_id = ?", [hostId]);
            else
              await db.run(
                "INSERT INTO attempts (host_id, payload) VALUES (?, ?) ON CONFLICT(host_id) DO UPDATE SET payload = excluded.payload",
                [hostId, after],
              );
          }
          await db.exec("COMMIT");
          return { before, after };
        } catch (error) {
          await db.exec("ROLLBACK");
          throw error;
        }
      } finally {
        await db.close();
      }
    },
  };
}
