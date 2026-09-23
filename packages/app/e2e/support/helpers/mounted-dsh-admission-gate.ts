import type { Page, Request, Route, WebSocketRoute } from "@playwright/test";
import { z } from "zod";

type Phase = "open" | "unknown" | "reconnect-held" | "ready-only" | "history";
const frameSchema = z.object({
  type: z.string(),
  streamId: z.string().optional(),
  value: z.unknown().optional(),
});
const openSchema = z.object({
  type: z.literal("open"),
  streamId: z.string(),
  endpoint: z.string(),
});
const readySchema = z.object({ type: z.literal("ready"), clientId: z.string().min(1) });
const baselineSchema = z.object({
  type: z.literal("baseline"),
  value: z.object({
    queues: z.record(z.string(), z.array(z.object({ rpcId: z.string().optional() }))),
  }),
});
const queueSchema = z.object({
  type: z.literal("queue"),
  sessionId: z.string(),
  items: z.array(z.object({ rpcId: z.string().optional() })),
});
const snapshotSchema = z.object({ type: z.literal("snapshot"), records: z.array(z.unknown()) });
const recordSchema = z.object({
  type: z.literal("event"),
  event: z.object({ seq: z.number().int(), type: z.string(), data: z.unknown() }),
});
const userSchema = z.object({ source: z.object({ kind: z.literal("user"), rpcId: z.string() }) });
interface Packet {
  raw: string | Buffer;
  frame: z.infer<typeof frameSchema>;
  endpoint: string;
}
interface Channel {
  id: number;
  socket: WebSocketRoute;
  server: WebSocketRoute;
  streams: Map<string, string>;
  pending: Packet[];
}
interface Delivery {
  channel: number;
  endpoint: string;
  phase: Phase;
  type: string;
  users: { seq: number; type: string; data: unknown }[];
  matchingQueueItems: number;
}
interface HttpRead {
  path: string;
  held: boolean;
  delivered: boolean;
  cancelled: boolean;
  phase?: Phase;
}

function decode(raw: string | Buffer): unknown {
  return JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
}
function users(packet: Packet) {
  if (packet.endpoint !== "session/follow") return [];
  const snapshot = snapshotSchema.safeParse(packet.frame.value);
  const records = snapshot.success ? snapshot.data.records : [packet.frame.value];
  const result: { seq: number; type: string; data: unknown }[] = [];
  for (const record of records) {
    const parsed = recordSchema.safeParse(record);
    if (!parsed.success || parsed.data.event.type !== "user/message") continue;
    if (!userSchema.safeParse(parsed.data.event.data).success) continue;
    result.push({
      seq: parsed.data.event.seq,
      type: parsed.data.event.type,
      data: parsed.data.event.data,
    });
  }
  return result;
}
function matches(data: unknown, requestId: string): boolean {
  return userSchema.parse(data).source.rpcId === requestId;
}
function readinessPath(path: string): boolean {
  return path === "/api/connection/identity" || path === "/api/$capabilities";
}

/** Buffers real transport data, never manufactures a Session baseline or calls a product owner. */
export class MountedDshAdmissionGate {
  private phase: Phase = "open";
  private target: { sessionId: string; requestId: string } | undefined;
  private nextChannel = 0;
  private readonly channels = new Set<Channel>();
  private readonly ids: string[] = [];
  private readonly deliveries: Delivery[] = [];
  private readonly http: HttpRead[] = [];
  private readonly httpTasks = new Set<Promise<void>>();
  private readonly closeTasks = new Set<Promise<void>>();
  private readonly failedRequests = new WeakSet<Request>();
  private readonly requestFailed = (request: Request): void => {
    this.failedRequests.add(request);
  };
  private readonly failures: unknown[] = [];
  private readonly httpWaiters = new Set<() => void>();
  private readonly historyStreams = new Set<string>();
  private discardedPackets = 0;

  private constructor(private readonly page: Page) {}

  static async install(page: Page): Promise<MountedDshAdmissionGate> {
    const gate = new MountedDshAdmissionGate(page);
    page.on("requestfailed", gate.requestFailed);
    await page.route("**/api/**", gate.routeHttp);
    await page.routeWebSocket("**/api/remote.mux", gate.routeSocket);
    return gate;
  }

  /** Called synchronously before the intercepted prompt is forwarded to the real Host. */
  arm(sessionId: string, requestId: string): void {
    if (this.target !== undefined) throw new Error("Admission gate cannot admit another prompt");
    this.target = { sessionId, requestId };
    this.phase = "unknown";
  }

  private readonly routeHttp = async (route: Route): Promise<void> => {
    const task = this.handleHttp(route);
    this.httpTasks.add(task);
    try {
      await task;
    } catch (error) {
      this.failures.push(error);
      throw error;
    } finally {
      this.httpTasks.delete(task);
    }
  };

  private async handleHttp(route: Route): Promise<void> {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const entry: HttpRead = { path, held: false, delivered: false, cancelled: false };
    this.http.push(entry);
    // Decide at RESPONSE delivery, not request start: an older in-flight read cannot leak evidence.
    const response = await route.fetch({ maxRetries: 0 });
    if (this.phase !== "open" && !readinessPath(path)) {
      entry.held = true;
      await new Promise<void>((resolve) => {
        this.httpWaiters.add(resolve);
      });
    }
    if (this.failedRequests.has(route.request())) {
      entry.cancelled = true;
      await route.abort("aborted");
      return;
    }
    entry.phase = this.phase;
    await route.fulfill({ response });
    entry.delivered = true;
  }

  private readonly routeSocket = (socket: WebSocketRoute): void => {
    const server = socket.connectToServer();
    const channel: Channel = {
      id: ++this.nextChannel,
      socket,
      server,
      streams: new Map(),
      pending: [],
    };
    this.channels.add(channel);
    socket.onMessage((raw) => {
      const opening = openSchema.safeParse(decode(raw));
      if (opening.success) channel.streams.set(opening.data.streamId, opening.data.endpoint);
      server.send(raw);
    });
    server.onMessage((raw) => {
      if (!this.channels.has(channel)) return;
      const frame = frameSchema.parse(decode(raw));
      const endpoint =
        frame.streamId === undefined ? "transport" : channel.streams.get(frame.streamId);
      if (endpoint === undefined) throw new Error("Unidentified mux stream in admission fixture");
      const packet = { raw, frame, endpoint };
      if (this.allowed(channel, packet)) this.forward(channel, packet);
      else channel.pending.push(packet);
    });
    socket.onClose((code, reason) => {
      if (!this.drop(channel)) return;
      this.trackClose(server.close({ code, reason }));
    });
    server.onClose((code, reason) => {
      if (!this.drop(channel)) return;
      this.trackClose(socket.close({ code, reason }));
    });
  };

  /** Playwright does not await onClose callbacks; own and observe their work explicitly. */
  private trackClose(task: Promise<void>): void {
    this.closeTasks.add(task);
    void task.then(
      () => this.closeTasks.delete(task),
      (error: unknown) => {
        this.failures.push(error);
        return this.closeTasks.delete(task);
      },
    );
  }

  private drop(channel: Channel): boolean {
    if (!this.channels.delete(channel)) return false;
    this.discardedPackets += channel.pending.length;
    channel.pending.length = 0;
    return true;
  }

  private emptyControl(packet: Packet): boolean {
    if (packet.endpoint !== "session/control" || this.target === undefined) return false;
    const baseline = baselineSchema.safeParse(packet.frame.value);
    return baseline.success && baseline.data.value.queues[this.target.sessionId]?.length === 0;
  }

  private allowed(channel: Channel, packet: Packet): boolean {
    if (this.phase === "open" || packet.frame.type === "pong") return true;
    if (this.phase === "unknown" || this.phase === "reconnect-held") return false;
    if (packet.endpoint === "$events" && readySchema.safeParse(packet.frame.value).success)
      return true;
    return this.historyStreams.has(`${channel.id}:${packet.frame.streamId}`);
  }

  private matchingQueue(packet: Packet): number {
    if (packet.endpoint !== "session/control" || this.target === undefined) return 0;
    const baseline = baselineSchema.safeParse(packet.frame.value);
    const queue = queueSchema.safeParse(packet.frame.value);
    const items = baseline.success ? baseline.data.value.queues[this.target.sessionId] : [];
    const updates =
      queue.success && queue.data.sessionId === this.target.sessionId ? queue.data.items : [];
    return [...(items ?? []), ...updates].filter((item) => item.rpcId === this.target!.requestId)
      .length;
  }

  private forward(channel: Channel, packet: Packet): void {
    const ready = readySchema.safeParse(packet.frame.value);
    if (packet.endpoint === "$events" && ready.success) this.ids.push(ready.data.clientId);
    this.deliveries.push({
      channel: channel.id,
      endpoint: packet.endpoint,
      phase: this.phase,
      type: packet.frame.type,
      users: users(packet),
      matchingQueueItems: this.matchingQueue(packet),
    });
    channel.socket.send(packet.raw);
  }

  private drain(): void {
    for (const channel of this.channels) {
      const pending = channel.pending;
      channel.pending = [];
      for (const packet of pending) {
        if (this.allowed(channel, packet)) this.forward(channel, packet);
        else channel.pending.push(packet);
      }
    }
  }

  opened(): number {
    return this.nextChannel;
  }
  deliveredClientIds(): readonly string[] {
    return [...this.ids];
  }

  async disconnectAndHold(): Promise<void> {
    this.phase = "reconnect-held";
    if (this.channels.size === 0) throw new Error("No live mux to disconnect");
    const before = [...this.channels];
    for (const channel of before) {
      this.drop(channel);
      const close = { code: 4002, reason: "Prompt admission recovery fixture" };
      await channel.socket.close(close);
      await channel.server.close(close);
    }
  }

  /** Session follow restarts independently; control and every unary history read stay held. */
  releaseReady(): void {
    this.phase = "ready-only";
    this.drain();
  }

  heldHistory() {
    const result: { channel: number; streamId: string; users: ReturnType<typeof users> }[] = [];
    for (const channel of this.channels)
      for (const packet of channel.pending) {
        if (packet.frame.streamId === undefined) continue;
        const messages = users(packet);
        if (messages.length > 0)
          result.push({ channel: channel.id, streamId: packet.frame.streamId, users: messages });
      }
    return result;
  }

  releaseExactHistory(): void {
    if (this.target === undefined || this.phase !== "ready-only")
      throw new Error("History release out of order");
    const target = this.target;
    const packets = this.heldHistory().filter((packet) =>
      packet.users.some((message) => matches(message.data, target.requestId)),
    );
    if (packets.length !== 1) throw new Error("Expected one live exact-admission history snapshot");
    this.historyStreams.add(`${packets[0]!.channel}:${packets[0]!.streamId}`);
    this.phase = "history";
    this.drain();
  }

  releaseAll(): void {
    this.phase = "open";
    this.drain();
    for (const resolve of this.httpWaiters) resolve();
    this.httpWaiters.clear();
  }

  snapshot() {
    const target = this.target;
    let heldEmptyControlBaselines = 0;
    for (const channel of this.channels)
      for (const packet of channel.pending)
        if (this.emptyControl(packet)) heldEmptyControlBaselines += 1;
    const matchingUsers = this.deliveries
      .flatMap((delivery) => delivery.users)
      .filter((message) => target !== undefined && matches(message.data, target.requestId));
    return {
      phase: this.phase,
      forwardedClientIds: [...this.ids],
      physicalChannels: this.nextChannel,
      matchingUsers,
      matchingQueueItems: this.deliveries.reduce(
        (total, delivery) => total + delivery.matchingQueueItems,
        0,
      ),
      deliveries: [...this.deliveries],
      http: this.http.map((entry) => ({ ...entry })),
      heldPackets: [...this.channels].reduce((total, channel) => total + channel.pending.length, 0),
      discardedPackets: this.discardedPackets,
      heldEmptyControlBaselines,
      controlDuringHold: this.deliveries.filter(
        (delivery) => delivery.phase !== "open" && delivery.endpoint === "session/control",
      ).length,
    };
  }

  private async settleOwned(): Promise<void> {
    while (this.httpTasks.size > 0 || this.closeTasks.size > 0) {
      const pending = [...this.httpTasks, ...this.closeTasks];
      await Promise.allSettled(pending);
    }
  }

  /** Drain HTTP first, then close this fixture-owned Page and join its socket-close callbacks. */
  async dispose(): Promise<void> {
    await this.page.unroute("**/api/**", this.routeHttp);
    this.releaseAll();
    await this.settleOwned();
    this.page.off("requestfailed", this.requestFailed);
    await this.page.close();
    await this.settleOwned();
    if (this.failures.length > 0)
      throw new AggregateError(this.failures, "Admission fixture transport handlers failed");
  }
}
