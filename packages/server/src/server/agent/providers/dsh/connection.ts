import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { WebSocket } from "ws";
import { z } from "zod";

export const DshConfigSchema = z.strictObject({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "Use the DSH Web origin without a token, path, or credentials"),
  cookieFile: z.string().min(1).optional(),
  requestTimeoutMs: z.number().int().positive().max(120_000).default(30_000),
  reconnectDelayMs: z.number().int().min(100).max(60_000).default(1000),
  reconnectMaxDelayMs: z.number().int().min(100).max(120_000).default(30_000),
  maxToolTextChars: z.number().int().min(256).max(1_048_576).default(16_384),
});
export type DshConfig = z.infer<typeof DshConfigSchema>;
export const DshAuthSchema = z.object({
  origin: z.url(),
  cookie: z.string().regex(/^dsh-auth-[A-Za-z0-9_-]+=[A-Za-z0-9_.-]+$/),
});
const FailureSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
const ResponseSchema = z.object({
  type: z.literal("server-response"),
  rpcId: z.string(),
  result: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: z.unknown().optional() }),
    z.object({ ok: z.literal(false), error: FailureSchema }),
  ]),
});
const StreamSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("item"), streamId: z.string(), value: z.unknown() }),
  z.object({ type: z.literal("end"), streamId: z.string() }),
  z.object({ type: z.literal("error"), streamId: z.string(), error: FailureSchema }),
]);

export class DshConnectionError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DshConnectionError";
  }
}

export interface DshSubscription {
  close(): void;
}

export interface DshStreamObserver {
  value(value: unknown): void;
  error(error: Error): void;
}

export interface DshTransport {
  request(endpoint: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  open(
    endpoint: string,
    args: Record<string, unknown>,
    observer: DshStreamObserver,
  ): Promise<DshSubscription>;
  close(): Promise<void>;
}

export class DshConnection implements DshTransport {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private readonly streams = new Map<string, DshStreamObserver>();
  private readonly lifetime = new AbortController();

  constructor(readonly config: DshConfig) {}

  async request(
    endpoint: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const rpcId = randomUUID();
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
    const signals = [this.lifetime.signal, timeout];
    if (signal) signals.push(signal);
    const response = await fetch(new URL(`/api/${endpoint}`, this.config.url), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.any(signals),
      headers: { "content-type": "application/json", ...(await this.headers()) },
      body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload: { args } }),
    });
    if (!response.ok) {
      throw new DshConnectionError(
        response.status === 401
          ? "DSH authentication expired. Reconnect using the URL printed by dsh web."
          : `DSH request failed (HTTP ${response.status}).`,
        `http/${response.status}`,
      );
    }
    const envelope = ResponseSchema.parse(await response.json());
    if (envelope.rpcId !== rpcId)
      throw new DshConnectionError("DSH response identity mismatch", "protocol");
    if (!envelope.result.ok) {
      throw new DshConnectionError(envelope.result.error.message, envelope.result.error.code);
    }
    return envelope.result.value;
  }

  async open(
    endpoint: string,
    args: Record<string, unknown>,
    observer: DshStreamObserver,
  ): Promise<DshSubscription> {
    const socket = await this.connected();
    this.lifetime.signal.throwIfAborted();
    const streamId = randomUUID();
    this.streams.set(streamId, observer);
    socket.send(JSON.stringify({ type: "open", streamId, endpoint, payload: { args } }));
    return {
      close: () => {
        if (!this.streams.delete(streamId)) return;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "cancel", streamId }));
        }
      },
    };
  }

  async close(): Promise<void> {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    this.streams.clear();
    this.socket?.terminate();
    await this.connecting?.catch(() => undefined);
    this.socket = null;
  }

  private async headers(): Promise<Record<string, string>> {
    const origin = new URL(this.config.url).origin;
    if (!this.config.cookieFile) return { origin };
    const stored = DshAuthSchema.parse(JSON.parse(await readFile(this.config.cookieFile, "utf8")));
    if (stored.origin !== origin) {
      throw new DshConnectionError("DSH credentials belong to a different host", "auth/origin");
    }
    return { origin, cookie: stored.cookie };
  }

  private connected(): Promise<WebSocket> {
    this.lifetime.signal.throwIfAborted();
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async connect(): Promise<WebSocket> {
    const headers = await this.headers();
    this.lifetime.signal.throwIfAborted();
    const url = new URL("/api/remote.mux", this.config.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers,
        handshakeTimeout: this.config.requestTimeoutMs,
        maxPayload: 16 * 1024 * 1024,
      });
      this.socket = socket;
      const abort = () => socket.terminate();
      this.lifetime.signal.addEventListener("abort", abort, { once: true });
      socket.once("open", () => resolve(socket));
      socket.on("message", (raw, binary) => {
        try {
          if (binary)
            throw new DshConnectionError("DSH sent an unsupported binary frame", "protocol");
          const frame = StreamSchema.parse(JSON.parse(raw.toString()));
          const observer = this.streams.get(frame.streamId);
          if (!observer) return;
          if (frame.type === "item") {
            observer.value(frame.value);
          } else {
            this.streams.delete(frame.streamId);
            observer.error(
              frame.type === "error"
                ? new DshConnectionError(frame.error.message, frame.error.code)
                : new DshConnectionError("DSH live stream ended", "stream/ended"),
            );
          }
        } catch {
          this.fail(new DshConnectionError("DSH sent an invalid live update", "protocol"));
          socket.terminate();
        }
      });
      socket.on("error", () => {
        const error = new DshConnectionError(
          "Cannot connect to DSH Web. Check the host and authentication.",
          "connection",
        );
        reject(error);
        if (this.socket === socket) this.fail(error);
      });
      socket.once("close", () => {
        this.lifetime.signal.removeEventListener("abort", abort);
        const error = new DshConnectionError("Connection to DSH Web closed", "connection");
        reject(error);
        if (this.socket === socket) {
          this.socket = null;
          this.fail(error);
        }
      });
    });
  }

  private fail(error: Error): void {
    const observers = [...this.streams.values()];
    this.streams.clear();
    for (const observer of observers) observer.error(error);
  }
}
