import type { RpcFetch, RemoteStreamSocket, ConnectionHostId } from "@deepseek-ai/dsh-client";
import {
  DshAccessError,
  desktopDshHostSchema,
  desktopDshFetchSchema,
  desktopDshSocketEventSchema,
} from "@getpaseo/protocol/dsh-access";
import { desktopDshBridge, desktopDshRequest } from "./bridge";

export interface DesktopRendererTransport {
  origin: string;
  fetch: RpcFetch;
  createSocket(url: string): RemoteStreamSocket;
  dispose(): Promise<void>;
}

/** Renderer owns identities and subscriptions; authenticated bytes and grants stay in main. */
export async function openDesktopDshTransport(
  hostId: ConnectionHostId,
  signal: AbortSignal,
): Promise<DesktopRendererTransport> {
  if (signal.aborted) throw new DshAccessError("request-cancelled");
  const ownerId = crypto.randomUUID();
  const cancelOpen = () => {
    void desktopDshRequest({ type: "close", ownerId }).catch(() => {});
  };
  signal.addEventListener("abort", cancelOpen, { once: true });
  let origin: string;
  try {
    const host = desktopDshHostSchema.parse(
      await desktopDshRequest({ type: "open", ownerId, hostId }),
    );
    if (host.hostId !== hostId) throw new DshAccessError("invalid-response");
    if (signal.aborted) throw new DshAccessError("request-cancelled");
    origin = host.origin;
  } catch (error) {
    await desktopDshRequest({ type: "close", ownerId });
    if (error instanceof DshAccessError) throw error;
    throw new DshAccessError("invalid-response");
  } finally {
    signal.removeEventListener("abort", cancelOpen);
  }
  let closed = false;
  let closing: Promise<void> | null = null;
  const sockets = new Map<string, { events: EventTarget; state: number }>();
  const detach = desktopDshBridge().onSocket((value) => {
    const parsed = desktopDshSocketEventSchema.safeParse(value);
    if (!parsed.success || parsed.data.ownerId !== ownerId || closed) return;
    const event = parsed.data;
    const socket = sockets.get(event.socketId);
    if (socket === undefined) return;
    switch (event.type) {
      case "open":
        socket.state = 1;
        socket.events.dispatchEvent(new Event("open"));
        break;
      case "message":
        socket.events.dispatchEvent(new MessageEvent("message", { data: event.data }));
        break;
      case "error":
        socket.events.dispatchEvent(new Event("error"));
        break;
      case "close":
        socket.state = 3;
        socket.events.dispatchEvent(new Event("close"));
        sockets.delete(event.socketId);
        break;
    }
  });
  const fetch: RpcFetch = async (input, init) => {
    if (closed) throw new DshAccessError("transport-disposed");
    if (init.signal?.aborted) throw new DshAccessError("request-cancelled");
    if (init.body != null && typeof init.body !== "string")
      throw new DshAccessError("invalid-response");
    const requestId = crypto.randomUUID();
    const cancel = () => {
      void desktopDshRequest({ type: "abort", ownerId, requestId }).catch(() => {});
    };
    init.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = desktopDshFetchSchema.parse(
        await desktopDshRequest({
          type: "fetch",
          ownerId,
          requestId,
          url: input.href,
          method: "POST",
          headers: Object.fromEntries(new Headers(init.headers)),
          body: init.body ?? "",
        }),
      );
      if (closed || init.signal?.aborted) throw new DshAccessError("request-cancelled");
      return { ok: response.ok, status: response.status, json: async () => response.body };
    } catch (error) {
      if (error instanceof DshAccessError) throw error;
      throw new DshAccessError("invalid-response");
    } finally {
      init.signal?.removeEventListener("abort", cancel);
    }
  };
  return {
    origin,
    fetch,
    createSocket(url) {
      if (closed) throw new DshAccessError("transport-disposed");
      const socketId = crypto.randomUUID();
      const socket = { events: new EventTarget(), state: 0 };
      sockets.set(socketId, socket);
      const fail = () => {
        if (closed || socket.state === 3) return;
        socket.events.dispatchEvent(new Event("error"));
        socket.state = 3;
        socket.events.dispatchEvent(new Event("close"));
        sockets.delete(socketId);
      };
      void desktopDshRequest({ type: "socket-open", ownerId, socketId, url }).catch(fail);
      return {
        get readyState() {
          return socket.state;
        },
        send(data) {
          if (closed || socket.state !== 1) throw new DshAccessError("transport-failed");
          void desktopDshRequest({ type: "socket-send", ownerId, socketId, data }).catch(fail);
        },
        close(code, reason) {
          if (socket.state === 3) return;
          socket.state = 2;
          void desktopDshRequest({ type: "socket-close", ownerId, socketId, code, reason }).catch(
            fail,
          );
        },
        addEventListener(
          type: "open" | "close" | "error" | "message",
          listener: (() => void) | ((event: { readonly data: unknown }) => void),
          options?: { once?: boolean },
        ) {
          // Only the message event carries data; its dispatch above always uses MessageEvent.
          socket.events.addEventListener(type, listener as EventListener, options);
        },
        removeEventListener(type, listener) {
          socket.events.removeEventListener(type, listener as EventListener);
        },
      };
    },
    dispose() {
      if (closing !== null) return closing;
      closed = true;
      detach();
      for (const socket of sockets.values()) {
        socket.state = 3;
        socket.events.dispatchEvent(new Event("close"));
      }
      sockets.clear();
      closing = desktopDshRequest({ type: "close", ownerId }).then(() => undefined);
      return closing;
    },
  };
}
