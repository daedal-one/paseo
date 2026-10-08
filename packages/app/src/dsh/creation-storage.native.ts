import { openDatabaseAsync } from "expo-sqlite";
import { createSqliteCreationStorage } from "./creation-storage-sqlite";
export function createDshCreationStorage(databaseName = "daedal-dsh-creation.db") {
  return createSqliteCreationStorage(async () => {
    const db = await openDatabaseAsync(databaseName, { useNewConnection: true });
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
