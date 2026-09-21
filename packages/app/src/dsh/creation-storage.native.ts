import { openDatabaseAsync } from "expo-sqlite";
import { createSqliteCreationStorage } from "./creation-storage-sqlite";
export function createDshCreationStorage() {
  return createSqliteCreationStorage(async () => {
    const db = await openDatabaseAsync("daedal-dsh-creation.db", { useNewConnection: true });
    return {
      exec: (sql) => db.execAsync(sql),
      run: async (sql, params) => {
        await db.runAsync(sql, params);
      },
      get: (sql, params) => db.getFirstAsync<{ payload: string }>(sql, params),
      close: () => db.closeAsync(),
    };
  });
}
