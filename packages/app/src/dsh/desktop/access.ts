import { createDshCreationStorage } from "../creation-storage.web";
import type { ConnectionHostId, SessionSelectionStore } from "@deepseek-ai/dsh-client";
import { desktopDshHostsSchema, DshAccessError } from "@getpaseo/protocol/dsh-access";
import { createDshHostRuntime, type DshHostRuntime } from "../runtime";
import { parseDshPairing } from "../pairing";
import { desktopDshRequest } from "./bridge";
import { openDesktopDshTransport } from "./transport";

export async function listDesktopDshHosts() {
  try {
    return desktopDshHostsSchema.parse(await desktopDshRequest({ type: "list" }));
  } catch (error) {
    if (error instanceof DshAccessError) throw error;
    throw new DshAccessError("invalid-response");
  }
}
export async function pairDesktopDshHost(options: {
  pairing: unknown;
  deviceLabel: string;
  signal: AbortSignal;
}): Promise<void> {
  const pairing = parseDshPairing(options.pairing);
  if (options.signal.aborted) throw new DshAccessError("request-cancelled");
  const claimId = crypto.randomUUID();
  const cancel = () => {
    void desktopDshRequest({ type: "cancel-pair", claimId }).catch(() => {});
  };
  options.signal.addEventListener("abort", cancel, { once: true });
  try {
    await desktopDshRequest({ type: "pair", claimId, pairing, label: options.deviceLabel });
  } finally {
    options.signal.removeEventListener("abort", cancel);
  }
}
export async function openDesktopDshHost(options: {
  hostId: ConnectionHostId;
  selection: SessionSelectionStore;
  signal: AbortSignal;
}): Promise<DshHostRuntime> {
  const transport = await openDesktopDshTransport(options.hostId, options.signal);
  let runtime: DshHostRuntime | undefined;
  try {
    runtime = await createDshHostRuntime({
      creationStorage: createDshCreationStorage(),
      registrationStorage: createDshCreationStorage("daedal-dsh-registration"),
      hostId: options.hostId,
      selection: options.selection,
      baseUrl: transport.origin,
      isLocal: ["localhost", "127.0.0.1", "[::1]"].includes(new URL(transport.origin).hostname),
      fetch: transport.fetch,
      createSocket: transport.createSocket,
      randomId: () => crypto.randomUUID(),
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      network: {
        getSnapshot: () => navigator.onLine,
        subscribe(listener) {
          window.addEventListener("online", listener);
          window.addEventListener("offline", listener);
          return () => {
            window.removeEventListener("online", listener);
            window.removeEventListener("offline", listener);
          };
        },
      },
    });
    if (options.signal.aborted) throw new DshAccessError("request-cancelled");
    const opened = runtime;
    return {
      ...opened,
      async dispose() {
        try {
          await opened.dispose();
        } finally {
          await transport.dispose();
        }
      },
    };
  } catch (error) {
    try {
      await runtime?.dispose();
    } finally {
      await transport.dispose();
    }
    throw error;
  }
}
