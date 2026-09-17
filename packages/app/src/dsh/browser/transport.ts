import type { RemoteStreamSocket, RpcFetch } from "@deepseek-ai/dsh-client";
import { DshAccessError } from "../access-error";

export interface BrowserDshTransport {
  readonly origin: string;
  fetch: RpcFetch;
  createSocket(url: string): RemoteStreamSocket;
  dispose(): void;
}

/** Uses the DSH owner's browser session only on the origin serving this page. */
export function createBrowserDshTransport(): BrowserDshTransport {
  const page = new URL(window.location.href);
  if (page.protocol !== "https:" && page.protocol !== "http:") {
    throw new DshAccessError("unsupported-platform");
  }
  const origin = page.origin;
  const socketOrigin = origin.replace(/^http/, "ws");
  const requests = new Set<AbortController>();
  const sockets = new Set<WebSocket>();
  let disposed = false;

  function assertTarget(url: URL, expected: string): void {
    if (disposed) throw new DshAccessError("transport-disposed");
    if (
      url.origin !== expected ||
      url.username !== "" ||
      url.password !== "" ||
      url.href.includes("#")
    ) {
      throw new DshAccessError("invalid-origin");
    }
  }

  const fetch: RpcFetch = async (input, init) => {
    assertTarget(input, origin);
    if (init.signal?.aborted) throw new DshAccessError("request-cancelled");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    init.signal?.addEventListener("abort", cancel, { once: true });
    requests.add(controller);
    try {
      const headers = new Headers(init.headers);
      for (const name of ["authorization", "cookie", "origin", "host"]) headers.delete(name);
      const response = await window.fetch(input.href, {
        ...init,
        headers,
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) throw new DshAccessError("browser-auth-required");
        return { ok: false, status: response.status, json: async () => null };
      }
      const body: unknown = await response.json();
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
    origin,
    fetch,
    createSocket(value) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new DshAccessError("invalid-origin");
      }
      assertTarget(url, socketOrigin);
      let socket: WebSocket;
      try {
        // Browser WebSocket handshakes include origin cookies and refuse redirects.
        socket = new WebSocket(url.href);
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
          socket.close(code, reason);
        },
        addEventListener: socket.addEventListener.bind(socket),
        removeEventListener: socket.removeEventListener.bind(socket),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const request of requests) request.abort();
      for (const socket of sockets) socket.close(1000);
      sockets.clear();
    },
  };
}
