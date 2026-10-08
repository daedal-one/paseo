import type { DshCreationStorage } from "./creation-journal";
/** Separate from replica caches: unresolved requests must survive cache invalidation. */
export function createDshCreationStorage(databaseName = "daedal-dsh-creation"): DshCreationStorage {
  return {
    async transact(hostId, update) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        let blocked = false;
        request.addEventListener("upgradeneeded", () =>
          request.result.createObjectStore("attempts"),
        );
        request.addEventListener("error", () => reject(request.error));
        request.addEventListener("blocked", () => {
          blocked = true;
          reject(new Error("Creation storage upgrade blocked"));
        });
        request.addEventListener("success", () => {
          if (blocked) request.result.close();
          else resolve(request.result);
        });
      });
      try {
        return await new Promise<{ before: string | null; after: string | null }>(
          (resolve, reject) => {
            const tx = db.transaction("attempts", "readwrite", { durability: "strict" });
            const store = tx.objectStore("attempts");
            let result: { before: string | null; after: string | null };
            let failure: unknown;
            tx.addEventListener("complete", () => resolve(result));
            tx.addEventListener("abort", () =>
              reject(failure ?? tx.error ?? new Error("Creation storage transaction aborted")),
            );
            tx.addEventListener("error", () => {
              failure ??= tx.error;
            });
            const read = store.get(hostId);
            read.addEventListener("success", () => {
              try {
                const before: unknown = read.result ?? null;
                if (before !== null && typeof before !== "string")
                  throw new Error("Invalid creation record");
                const after = update(before);
                result = { before, after };
                if (after !== before) {
                  if (after === null) store.delete(hostId);
                  else store.put(after, hostId);
                }
              } catch (error) {
                failure = error;
                tx.abort();
              }
            });
          },
        );
      } finally {
        db.close();
      }
    },
  };
}
