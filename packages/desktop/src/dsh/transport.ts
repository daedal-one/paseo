import { WebSocket } from "ws";
import type { RpcFetch } from "@deepseek-ai/dsh-client";
import { DshAccessError, parseDshOrigin } from "@getpaseo/protocol/dsh-access";

export interface DesktopDshTransport {
  readonly origin: string;
  fetch: RpcFetch;
  openSocket(url: string): WebSocket;
  dispose(): Promise<void>;
}

/** Authenticated carriers stay in the main process and never use Chromium's cookie jar. */
export function createDesktopDshTransport(options: {
  origin: string;
  credential: string | null;
}): DesktopDshTransport {
  const origin = parseDshOrigin(options.origin);
  const socketOrigin = origin.replace(/^http/, "ws");
  const controllers = new Set<AbortController>();
  const requests = new Set<Promise<unknown>>();
  const sockets = new Set<WebSocket>();
  let disposed = false;
  let closing: Promise<void> | null = null;
  function target(value: string, expected: string): URL {
    if (disposed) throw new DshAccessError("transport-disposed");
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new DshAccessError("invalid-origin");
    }
    if (url.origin !== expected || url.username || url.password || url.href.includes("#"))
      throw new DshAccessError("invalid-origin");
    return url;
  }
  const fetch: RpcFetch = (input, init) => {
    const task = (async () => {
      const url = target(input.href, origin);
      if (init.signal?.aborted) throw new DshAccessError("request-cancelled");
      const controller = new AbortController();
      const cancel = () => controller.abort();
      init.signal?.addEventListener("abort", cancel, { once: true });
      controllers.add(controller);
      try {
        const incoming = new Headers(init.headers);
        const headers = new Headers({ origin });
        for (const name of ["content-type", "accept"]) {
          const value = incoming.get(name);
          if (value !== null) headers.set(name, value);
        }
        if (options.credential !== null)
          headers.set("authorization", `Bearer ${options.credential}`);
        const response = await globalThis.fetch(url, {
          ...init,
          headers,
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (controller.signal.aborted) throw new DshAccessError("request-cancelled");
        return { ok: response.ok, status: response.status, json: async () => body };
      } catch {
        throw new DshAccessError(
          controller.signal.aborted ? "request-cancelled" : "transport-failed",
        );
      } finally {
        init.signal?.removeEventListener("abort", cancel);
        controllers.delete(controller);
      }
    })();
    requests.add(task);
    const settled = () => {
      requests.delete(task);
    };
    void task.then(settled, settled);
    return task;
  };
  return {
    origin,
    fetch,
    openSocket(value) {
      const url = target(value, socketOrigin);
      const headers: Record<string, string> = { origin };
      if (options.credential !== null) headers.authorization = `Bearer ${options.credential}`;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url, { headers, followRedirects: false });
      } catch {
        throw new DshAccessError("transport-failed");
      }
      // Closing a CONNECTING ws reports an error; the owner receives only the fixed IPC event.
      socket.on("error", () => {});
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      return socket;
    },
    dispose() {
      if (closing !== null) return closing;
      disposed = true;
      for (const controller of controllers) controller.abort();
      const closed = [...sockets].map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (socket.readyState === WebSocket.CLOSED) {
              resolve();
              return;
            }
            socket.once("close", () => resolve());
            socket.terminate();
          }),
      );
      closing = Promise.allSettled([...requests, ...closed]).then(() => undefined);
      return closing;
    },
  };
}
