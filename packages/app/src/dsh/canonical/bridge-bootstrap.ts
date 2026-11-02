import type { RemoteStreamSocket } from "@deepseek-ai/dsh-client";
import { stageCanonicalBody } from "./body-staging";
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalSocketEvent,
} from "@getpaseo/protocol/dsh-canonical";

interface NativeBridge {
  request(value: CanonicalRequest): Promise<unknown>;
  subscribe?(listener: (event: CanonicalSocketEvent) => void): void;
}
const page = globalThis as typeof globalThis & {
  __DSH_NATIVE__?: NativeBridge;
  webkit?: {
    messageHandlers?: { dsh?: { postMessage(value: CanonicalRequest): Promise<unknown> } };
  };
  __DSH_REMOTE_ADMISSION__?: unknown;
  __DSH_REMOTE_SOCKET__?: { createSocket(): RemoteStreamSocket };
  __DSH_WORK_CREATION_STORAGE__?: {
    read(): Promise<string | null>;
    compareExchange(before: string | null, after: string | null): Promise<boolean>;
  };
  __DSH_TRANSPORT__?: unknown;
  __DSH_FILE_UPLOAD__?: unknown;
  __DSH_SESSION_EXPORT__?: unknown;
};
const bridge = page.__DSH_NATIVE__ ?? {
  request: (value: CanonicalRequest) => {
    const handler = page.webkit?.messageHandlers?.dsh;
    if (handler === undefined) return Promise.reject(new Error("Native carrier unavailable"));
    // WKScriptMessageHandlerWithReply has no browser targetOrigin argument.
    // eslint-disable-next-line unicorn/require-post-message-target-origin
    return handler.postMessage(value);
  },
};
function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const sockets = new Map<string, EventTarget & { readyState: number }>();
function socketEvent(event: CanonicalSocketEvent) {
  const socket = sockets.get(event.id);
  if (socket === undefined) return;
  if (event.type === "open") socket.readyState = 1;
  if (event.type === "close") {
    socket.readyState = 3;
    sockets.delete(event.id);
  }
  socket.dispatchEvent(
    event.type === "message"
      ? new MessageEvent("message", { data: event.data })
      : new Event(event.type),
  );
}
bridge.subscribe?.(socketEvent);
addEventListener("dsh-native-socket", (event) =>
  socketEvent((event as CustomEvent<CanonicalSocketEvent>).detail),
);
function createSocket(): RemoteStreamSocket {
  const id = randomId();
  const events = Object.assign(new EventTarget(), { readyState: 0 });
  sockets.set(id, events);
  const send = (value: CanonicalRequest) => {
    void bridge.request(value).catch(() => {
      socketEvent({ id, type: "error" });
      socketEvent({ id, type: "close" });
    });
  };
  send({ kind: "socket-open", id });
  return {
    get readyState() {
      return events.readyState;
    },
    addEventListener(type, listener, options?: { once?: boolean }) {
      events.addEventListener(type, listener as EventListener, options);
    },
    removeEventListener(type, listener) {
      events.removeEventListener(type, listener as EventListener);
    },
    send(data: string) {
      send({ kind: "socket-send", id, data });
    },
    close() {
      events.readyState = 2;
      send({ kind: "socket-close", id });
    },
  };
}
function pathOf(value: URL | string): string {
  const url = new URL(value, location.href);
  if (
    !(
      (url.protocol === "dshremote:" && url.hostname === "host" && url.port === "") ||
      url.origin === "http://dsh.internal"
    ) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Foreign native request refused");
  return url.pathname + url.search;
}
async function nativeFetch(input: URL | string, init: RequestInit = {}): Promise<Response> {
  const path = pathOf(input);
  const id = randomId();
  const signal = init.signal;
  signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  let bodyStageId: string | null = null;
  const abort = () => {
    void bridge.request({ kind: "abort", id }).catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    if (init.body !== undefined && init.body !== null) {
      const encoded = new Response(init.body);
      if (encoded.body !== null) {
        bodyStageId = randomId();
        await stageCanonicalBody(bridge, bodyStageId, encoded.body, signal);
      }
      if (!headers.has("content-type") && encoded.headers.has("content-type"))
        headers.set("content-type", encoded.headers.get("content-type")!);
    }
    signal?.throwIfAborted();
    const result = (await bridge.request({
      kind: "fetch",
      id,
      path,
      method: (init.method ?? "GET") as "GET" | "HEAD" | "POST",
      headers: Object.fromEntries(headers),
      bodyStageId,
    })) as CanonicalResponse;
    signal?.throwIfAborted();
    const bytes = Uint8Array.from(atob(result.body), (character) => character.charCodeAt(0));
    return new Response(
      init.method === "HEAD" || [204, 205, 304].includes(result.status) ? null : bytes,
      { status: result.status, headers: result.headers },
    );
  } finally {
    signal?.removeEventListener("abort", abort);
    if (bodyStageId !== null)
      await bridge.request({ kind: "body-discard", id: bodyStageId }).catch(() => {});
  }
}
page.__DSH_REMOTE_SOCKET__ = { createSocket };
page.__DSH_WORK_CREATION_STORAGE__ = {
  async read() {
    return (await bridge.request({ kind: "creation-read", id: randomId() })) as string | null;
  },
  async compareExchange(before, after) {
    return (await bridge.request({
      kind: "creation-cas",
      id: randomId(),
      before,
      after,
    })) as boolean;
  },
};
page.__DSH_TRANSPORT__ = { fetch: nativeFetch, ownsHost: false };
page.__DSH_FILE_UPLOAD__ = { fetch: nativeFetch };
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const value = input instanceof Request ? input.url : input;
  const url = new URL(value, location.href);
  if (url.protocol === "dshremote:" || url.origin === "http://dsh.internal")
    return nativeFetch(String(value), init);
  return originalFetch(input, init);
};
page.__DSH_SESSION_EXPORT__ = {
  async download(url: string, filename: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const id = randomId();
    const cancel = () => {
      void bridge.request({ kind: "abort", id }).catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await bridge.request({ kind: "download", id, path: pathOf(url), filename });
      signal.throwIfAborted();
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  },
};
addEventListener(
  "pagehide",
  () => {
    for (const id of sockets.keys())
      void bridge.request({ kind: "socket-close", id }).catch(() => {});
    sockets.clear();
  },
  { once: true },
);
