import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import {
  connectionDeviceGrantSchema,
  connectionHostIdSchema,
  type ConnectionHostId,
} from "@deepseek-ai/dsh-api-remotes-client";
import { DshAccessError } from "../access-error";
import { parseDshOrigin } from "../host-origin";

const indexKey = "daedal.dsh.host-index.v1";
const protectedOptions: SecureStore.SecureStoreOptions = {
  keychainService: "daedal.dsh.device-access.v1",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};
const indexSchema = z
  .array(connectionHostIdSchema)
  .refine((ids) => new Set(ids).size === ids.length);
const recordSchema = z
  .object({
    version: z.literal(1),
    origin: z.string(),
    grant: connectionDeviceGrantSchema,
  })
  .strict();
export type StoredDshHost = z.infer<typeof recordSchema>;
let pending: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation).catch((error) => {
    if (error instanceof DshAccessError) throw error;
    throw new DshAccessError("storage-unavailable");
  });
  // Each caller retains its rejection; a failed operation does not poison later recovery.
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new DshAccessError("invalid-record");
  }
}

function validateId(value: ConnectionHostId): ConnectionHostId {
  const result = connectionHostIdSchema.safeParse(value);
  if (!result.success) throw new DshAccessError("invalid-record");
  return result.data;
}

function validateRecord(value: unknown): StoredDshHost {
  const result = recordSchema.safeParse(value);
  if (!result.success) throw new DshAccessError("invalid-record");
  return { ...result.data, origin: parseDshOrigin(result.data.origin) };
}

async function readIndex(): Promise<ConnectionHostId[]> {
  const text = await AsyncStorage.getItem(indexKey);
  if (text === null) return [];
  const result = indexSchema.safeParse(parseJson(text));
  if (!result.success) throw new DshAccessError("invalid-record");
  return result.data;
}

function secretKey(hostId: ConnectionHostId): string {
  return `daedal.dsh.host.${hostId}`;
}

async function readSecret(hostId: ConnectionHostId): Promise<StoredDshHost | null> {
  const text = await SecureStore.getItemAsync(secretKey(hostId), protectedOptions);
  if (text === null) return null;
  const record = validateRecord(parseJson(text));
  if (record.grant.hostId !== hostId) throw new DshAccessError("invalid-record");
  return record;
}

/** One process-wide writer; the public index never contains credentials or origins. */
export const dshDeviceStore = {
  list(): Promise<ConnectionHostId[]> {
    return serialize(readIndex);
  },
  load(hostId: ConnectionHostId): Promise<StoredDshHost | null> {
    return serialize(async () => {
      validateId(hostId);
      const ids = await readIndex();
      // iOS keychain values can survive uninstall; an absent index must not resurrect access.
      if (!ids.includes(hostId)) return null;
      return readSecret(hostId);
    });
  },
  save(value: StoredDshHost): Promise<void> {
    return serialize(async () => {
      const record = validateRecord(value);
      const hostId = record.grant.hostId;
      const ids = await readIndex();
      if (ids.includes(hostId)) {
        const previous = await readSecret(hostId);
        if (previous !== null && previous.grant.credential !== record.grant.credential) {
          throw new DshAccessError("already-paired");
        }
      }
      // Interrupted saves remain visible as unpaired entries, without an orphaned new secret.
      if (!ids.includes(hostId))
        await AsyncStorage.setItem(indexKey, JSON.stringify([...ids, hostId]));
      await SecureStore.setItemAsync(secretKey(hostId), JSON.stringify(record), protectedOptions);
    });
  },
  /** Call after disposing the Host runtime. This does not revoke its server-side grant. */
  forget(hostId: ConnectionHostId): Promise<void> {
    return serialize(async () => {
      validateId(hostId);
      const ids = await readIndex();
      await SecureStore.deleteItemAsync(secretKey(hostId), protectedOptions);
      await AsyncStorage.setItem(indexKey, JSON.stringify(ids.filter((id) => id !== hostId)));
    });
  },
};
