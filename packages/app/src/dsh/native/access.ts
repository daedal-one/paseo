import { randomUUID } from "expo-crypto";
import { getCalendars } from "expo-localization";
import {
  claimDeviceEnrollment,
  type ConnectionHostId,
  type SessionSelectionStore,
  type ConnectionNetworkSource,
} from "@deepseek-ai/dsh-api-remotes-client";
import { createDshHostRuntime, type DshHostRuntime } from "../runtime";
import { DshAccessError } from "../access-error";
import { parseDshPairing } from "../pairing";
export type { DshPairing } from "../pairing";
import { dshDeviceStore, type StoredDshHost } from "./device-store";
import { createNativeDshTransport } from "./transport";

export interface PairDshHostOptions {
  pairing: unknown;
  deviceLabel: string;
  signal: AbortSignal;
}
export interface OpenDshHostOptions {
  hostId: ConnectionHostId;
  selection: SessionSelectionStore;
  network?: ConnectionNetworkSource;
}
let pendingPairing: Promise<unknown> = Promise.resolve();

/** Consumes one claim. A lost response requires owner inspection or a new enrollment. */
export function pairDshHost(options: PairDshHostOptions): Promise<StoredDshHost> {
  const result = pendingPairing.then(() => claimAndStore(options));
  pendingPairing = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function claimAndStore(options: PairDshHostOptions): Promise<StoredDshHost> {
  const { enrollment, origin } = parseDshPairing(options.pairing);
  const label = options.deviceLabel.trim();
  if (label.length < 1 || label.length > 80) throw new DshAccessError("invalid-enrollment");
  if ((await dshDeviceStore.load(enrollment.hostId)) !== null)
    throw new DshAccessError("already-paired");
  if (options.signal.aborted) throw new DshAccessError("request-cancelled");
  const transport = createNativeDshTransport({ origin, credential: null });
  let response: Awaited<ReturnType<typeof claimDeviceEnrollment>>;
  try {
    response = await claimDeviceEnrollment({
      baseUrl: origin,
      expectedHostId: enrollment.hostId,
      challenge: enrollment.challenge,
      label,
      fetch: transport.fetch,
      signal: options.signal,
    });
  } catch {
    // Dispatch may have consumed the challenge even when cancellation or decoding lost its result.
    throw new DshAccessError("enrollment-outcome-unknown");
  } finally {
    transport.dispose();
  }
  if (!response.ok) {
    const uncertain =
      response.error.code === "connection/invalid-enrollment-response" ||
      response.error.code === "connection/enrollment-host-mismatch";
    if (uncertain) throw new DshAccessError("enrollment-outcome-unknown");
    throw new DshAccessError("enrollment-rejected");
  }
  const record: StoredDshHost = { version: 1, origin, grant: response.value };
  try {
    await dshDeviceStore.save(record);
  } catch {
    throw new DshAccessError("enrollment-save-failed");
  }
  return record;
}

/** The app owns one active runtime per Host and disposes it before forgetting local access. */
export async function openSavedDshHost(options: OpenDshHostOptions): Promise<DshHostRuntime> {
  const record = await dshDeviceStore.load(options.hostId);
  if (record === null) throw new DshAccessError("not-paired");
  const transport = createNativeDshTransport({
    origin: record.origin,
    credential: record.grant.credential,
  });
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(record.origin).hostname);
  let runtime: DshHostRuntime;
  try {
    runtime = await createDshHostRuntime({
      ...options,
      baseUrl: record.origin,
      isLocal,
      fetch: transport.fetch,
      createSocket: transport.createSocket,
      randomId: randomUUID,
      timeZone: () => getCalendars()[0]?.timeZone ?? "UTC",
    });
  } catch (error) {
    transport.dispose();
    throw error;
  }
  return {
    ...runtime,
    async dispose() {
      try {
        await runtime.dispose();
      } finally {
        transport.dispose();
      }
    },
  };
}
