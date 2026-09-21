import { createDshCreationStorage } from "../creation-storage.web";
import { brandString } from "@deepseek-ai/dsh-brand";
import {
  createConnectionRpc,
  readHostIdentity,
  type RpcId,
  type ConnectionHostId,
  type SessionSelectionStore,
} from "@deepseek-ai/dsh-client";
import { DshAccessError } from "../access-error";
import { createDshHostRuntime, type DshHostRuntime } from "../runtime";
import { createBrowserDshTransport } from "./transport";

/** Opens the page's authenticated Host; no device grant is read or stored by JavaScript. */
export async function openBrowserDshHost(options: {
  hostId: ConnectionHostId;
  selection: SessionSelectionStore;
  signal: AbortSignal;
}): Promise<DshHostRuntime> {
  const transport = createBrowserDshTransport();
  let runtime: DshHostRuntime | undefined;
  try {
    if (options.signal.aborted) throw new DshAccessError("request-cancelled");
    const rpc = createConnectionRpc({
      baseUrl: transport.origin,
      fetch: transport.fetch,
      randomId: () => brandString<RpcId>(crypto.randomUUID()),
    });
    const identity = await readHostIdentity(rpc, options.signal);
    if (!identity.ok || identity.value.hostId !== options.hostId)
      throw new DshAccessError("runtime-unavailable");
    if (options.signal.aborted) throw new DshAccessError("request-cancelled");
    runtime = await createDshHostRuntime({
      creationStorage: createDshCreationStorage(),
      registrationStorage: createDshCreationStorage("daedal-dsh-registration"),
      hostId: identity.value.hostId,
      baseUrl: transport.origin,
      isLocal: ["localhost", "127.0.0.1", "[::1]"].includes(new URL(transport.origin).hostname),
      fetch: transport.fetch,
      createSocket: transport.createSocket,
      randomId: () => crypto.randomUUID(),
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      selection: options.selection,
      network: {
        getSnapshot: () => window.navigator.onLine,
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
          transport.dispose();
        }
      },
    };
  } catch (error) {
    try {
      await runtime?.dispose();
    } finally {
      transport.dispose();
    }
    if (error instanceof DshAccessError) throw error;
    throw new DshAccessError("runtime-unavailable");
  }
}

export async function readBrowserDshHost(
  signal: AbortSignal,
): Promise<{ hostId: ConnectionHostId; origin: string }> {
  const transport = createBrowserDshTransport();
  try {
    const rpc = createConnectionRpc({
      baseUrl: transport.origin,
      fetch: transport.fetch,
      randomId: () => brandString<RpcId>(crypto.randomUUID()),
    });
    const identity = await readHostIdentity(rpc, signal);
    if (!identity.ok) throw new DshAccessError("runtime-unavailable");
    return { hostId: identity.value.hostId, origin: transport.origin };
  } catch (error) {
    if (error instanceof DshAccessError) throw error;
    throw new DshAccessError("runtime-unavailable");
  } finally {
    transport.dispose();
  }
}
