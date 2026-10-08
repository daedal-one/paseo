import type { DshCreationStorage } from "./creation-journal";
/** Platform entry points provide persistent storage; unsupported runtimes fail closed. */
export function createDshCreationStorage(_databaseName?: string): DshCreationStorage {
  return {
    async transact() {
      throw new Error("Creation storage is unavailable");
    },
  };
}
