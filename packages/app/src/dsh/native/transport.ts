import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";
import type {
  ConnectionDeviceCredential,
  RemoteStreamSocket,
  RpcFetch,
} from "@deepseek-ai/dsh-api-remotes-client";
import { createDshAbortController } from "../../runtime/dsh-abort-controller";
import { DshAccessError } from "../access-error";
import { parseDshOrigin } from "../host-origin";

interface NativeSocketOptions {
  headers: Record<string, string>;
}
interface AuthenticatedSocketConstructor {
  new (url: string, protocols: undefined, options: NativeSocketOptions): WebSocket;
}

export interface NativeDshTransportOptions {
  origin: string;
  credential: ConnectionDeviceCredential | null;
}
export interface NativeDshTransport {
  fetch: RpcFetch;
  createSocket(url: string): RemoteStreamSocket;
  dispose(): void;
}

/** iOS SocketRocket refuses handshake redirects; other native carriers need separate qualification. */
export function createNativeDshTransport(options: NativeDshTransportOptions): NativeDshTransport {
  if (Platform.OS !== "ios") throw new DshAccessError("unsupported-platform");
  const origin = parseDshOrigin(options.origin);
  const socketOrigin = origin.replace(/^http/, "ws");
  const requests = new Set<AbortController>();
  const sockets = new Set<WebSocket>();
  let disposed = false;

  function assertTarget(url: URL, expected: string): void {
    if (disposed) throw new DshAccessError("transport-disposed");
    const unsafe =
      url.origin !== expected ||
      url.username !== "" ||
      url.password !== "" ||
      url.href.includes("#");
    if (unsafe) throw new DshAccessError("invalid-origin");
  }

  const fetch: RpcFetch = async (input, init) => {
    assertTarget(input, origin);
    if (init.signal?.aborted) throw new DshAccessError("request-cancelled");
    const controller = createDshAbortController();
    const cancel = () => controller.abort();
    init.signal?.addEventListener("abort", cancel, { once: true });
    requests.add(controller);
    try {
      const headers = new Headers(init.headers);
      headers.delete("cookie");
      headers.delete("authorization");
      headers.delete("host");
      headers.set("origin", origin);
      if (options.credential !== null) headers.set("authorization", `Bearer ${options.credential}`);
      const response = await expoFetch(input.href, {
        ...init,
        body: init.body ?? undefined,
        headers,
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      const body = await readJsonBody(response.body, controller.signal);
      if (controller.signal.aborted) throw new DshAccessError("request-cancelled");
      return { ok: response.ok, status: response.status, json: async () => body };
    } catch (error) {
      if (controller.signal.aborted) throw new DshAccessError("request-cancelled");
      if (error instanceof DshAccessError) throw error;
      throw new DshAccessError("transport-failed");
    } finally {
      init.signal?.removeEventListener("abort", cancel);
      requests.delete(controller);
    }
  };

  return {
    fetch,
    createSocket(value) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new DshAccessError("invalid-origin");
      }
      assertTarget(url, socketOrigin);
      if (options.credential === null) throw new DshAccessError("not-paired");
      let socket: WebSocket;
      try {
        // The shared app typecheck includes DOM's two-argument constructor. RN iOS owns
        // the documented third headers argument; the platform guard precedes this call.
        const NativeWebSocket: AuthenticatedSocketConstructor = WebSocket;
        socket = new NativeWebSocket(url.href, undefined, {
          headers: { Authorization: `Bearer ${options.credential}`, Origin: origin },
        });
      } catch {
        throw new DshAccessError("transport-failed");
      }
      sockets.add(socket);
      socket.addEventListener("close", () => sockets.delete(socket), { once: true });
      return {
        get readyState() {
          return socket.readyState;
        },
        send(data) {
          try {
            socket.send(data);
          } catch {
            throw new DshAccessError("transport-failed");
          }
        },
        close(code, reason) {
          try {
            socket.close(code, reason);
          } catch {
            throw new DshAccessError("transport-failed");
          }
        },
        addEventListener: socket.addEventListener.bind(socket),
        removeEventListener: socket.removeEventListener.bind(socket),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of requests) controller.abort();
      let failed = false;
      for (const socket of sockets) {
        try {
          socket.close(1000);
        } catch {
          failed = true;
        }
      }
      sockets.clear();
      if (failed) throw new DshAccessError("transport-failed");
    },
  };
}

/** Expo SDK 54 native text/json waits only for completion and hangs after body cancellation. */
async function readJsonBody(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
): Promise<unknown> {
  if (body === null) throw new DshAccessError("invalid-response");
  const reader = body.getReader();
  let cancellation: Promise<void> | undefined;
  function cancel(): void {
    // An already-errored reader rejects cancel; the pending read owns that failure.
    cancellation = reader.cancel().catch(() => undefined);
  }
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  try {
    while (true) {
      const item = await reader.read();
      if (signal.aborted) throw new DshAccessError("request-cancelled");
      if (item.done) break;
      chunks.push(decoder.decode(item.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    try {
      return JSON.parse(chunks.join(""));
    } catch {
      throw new DshAccessError("invalid-response");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await cancellation;
    reader.releaseLock();
  }
}
