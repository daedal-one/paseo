import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalCreationTextSchema } from "@getpaseo/protocol/dsh-canonical";

/** SQLite owns atomic claims across windows; nullable rows retain completed legacy migration. */
export class CanonicalCreationStorage {
  constructor(private readonly file: string) {}
  private transaction<T>(operation: (db: DatabaseSync) => T): T {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.file);
    try {
      chmodSync(this.file, 0o600);
      db.exec(
        "PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS attempts (host_id TEXT PRIMARY KEY, payload TEXT)",
      );
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = operation(db);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      db.close();
    }
  }
  importLegacy(hostId: string, text: string | null): void {
    canonicalCreationTextSchema.parse(text);
    this.transaction((db) => {
      db.prepare(
        "INSERT INTO attempts (host_id, payload) VALUES (?, ?) ON CONFLICT(host_id) DO NOTHING",
      ).run(hostId, text);
    });
  }
  read(hostId: string): string | null {
    return this.transaction((db) =>
      canonicalCreationTextSchema.parse(
        db.prepare("SELECT payload FROM attempts WHERE host_id = ?").get(hostId)?.payload ?? null,
      ),
    );
  }
  compareExchange(hostId: string, before: string | null, after: string | null): boolean {
    canonicalCreationTextSchema.parse(before);
    canonicalCreationTextSchema.parse(after);
    return this.transaction((db) => {
      const current = canonicalCreationTextSchema.parse(
        db.prepare("SELECT payload FROM attempts WHERE host_id = ?").get(hostId)?.payload ?? null,
      );
      if (current !== before) return false;
      db.prepare(
        "INSERT INTO attempts (host_id, payload) VALUES (?, ?) ON CONFLICT(host_id) DO UPDATE SET payload = excluded.payload",
      ).run(hostId, after);
      return true;
    });
  }
}
