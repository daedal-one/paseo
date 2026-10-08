import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionHostIdSchema } from "@deepseek-ai/dsh-client";
import type {
  DesktopDshCommand,
  DesktopDshReply,
  DesktopDshSocketEvent,
} from "@getpaseo/protocol/dsh-access";
import { openDesktopDshTransport, type DesktopRendererTransport } from "./transport";

const hostId = connectionHostIdSchema.parse("26e99520-f2d3-4874-84b5-07c5ef24775d");
const descriptor = { hostId, origin: "https://host.example", label: "Desktop" };
const transports: DesktopRendererTransport[] = [];
const request = vi.fn<(command: DesktopDshCommand) => Promise<DesktopDshReply>>();
let listener: ((event: DesktopDshSocketEvent) => void) | undefined;
const detach = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  request.mockReset();
  detach.mockReset();
  listener = undefined;
  request.mockImplementation(async (command) => ({
    ok: true,
    value: command.type === "open" ? descriptor : undefined,
  }));
  vi.stubGlobal("window", {
    daedalDsh: {
      request,
      onSocket: (callback: typeof listener) => {
        listener = callback;
        return detach;
      },
    },
  });
});
afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.dispose()));
  vi.unstubAllGlobals();
});
async function open() {
  const transport = await openDesktopDshTransport(hostId, new AbortController().signal);
  transports.push(transport);
  return transport;
}
function latest<T extends DesktopDshCommand["type"]>(
  type: T,
): Extract<DesktopDshCommand, { type: T }> {
  const command = request.mock.calls
    .map(([value]) => value)
    .findLast((value) => value.type === type);
  if (command?.type !== type) throw new Error("Missing command " + type);
  return command as Extract<DesktopDshCommand, { type: T }>;
}

describe("desktop renderer carrier", () => {
  it("routes sockets by owner and socket identity, then removes subscriptions on close", async () => {
    const transport = await open();
    const socket = transport.createSocket("wss://host.example/api/remote.mux");
    const command = latest("socket-open");
    const received: unknown[] = [];
    socket.addEventListener("message", (event) => received.push(event.data));
    const ids = { ownerId: command.ownerId, socketId: command.socketId };
    listener?.({ ...ids, ownerId: crypto.randomUUID(), type: "open" });
    expect(socket.readyState).toBe(0);
    listener?.({ ...ids, type: "open" });
    expect(socket.readyState).toBe(1);
    listener?.({ ...ids, type: "message", data: "hello" });
    expect(received).toEqual(["hello"]);
    socket.send("reply");
    expect(latest("socket-send").data).toBe("reply");
    await transport.dispose();
    expect(detach).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(3);
    listener?.({ ...ids, type: "message", data: "late" });
    expect(received).toEqual(["hello"]);
    expect(latest("close").ownerId).toBe(command.ownerId);
  });
  it("propagates fetch cancellation and rejects a reply arriving after cancellation", async () => {
    const transport = await open();
    const reply = deferred<DesktopDshReply>();
    const controller = new AbortController();
    request.mockImplementation(async (command) =>
      command.type === "fetch" ? reply.promise : { ok: true, value: undefined },
    );
    const fetching = transport.fetch(new URL("/api/session/list", descriptor.origin), {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    const rejected = expect(fetching).rejects.toMatchObject({ code: "request-cancelled" });
    controller.abort();
    expect(latest("abort").requestId).toBe(latest("fetch").requestId);
    reply.resolve({ ok: true, value: { ok: true, status: 200, body: {} } });
    await rejected;
  });
  it("closes an owner whose open reply arrives after navigation cancellation", async () => {
    const reply = deferred<DesktopDshReply>();
    const controller = new AbortController();
    request.mockImplementation(async (command) =>
      command.type === "open" ? reply.promise : { ok: true, value: undefined },
    );
    const opening = openDesktopDshTransport(hostId, controller.signal);
    const rejected = expect(opening).rejects.toMatchObject({ code: "request-cancelled" });
    controller.abort();
    expect(latest("close").ownerId).toBe(latest("open").ownerId);
    reply.resolve({ ok: true, value: descriptor });
    await rejected;
  });
  it("turns socket opening failure into the shared runtime's error and close events", async () => {
    const transport = await open();
    request.mockResolvedValue({ ok: false, error: "transport-failed" });
    const socket = transport.createSocket("wss://host.example/api/remote.mux");
    const events: string[] = [];
    socket.addEventListener("error", () => events.push("error"));
    await new Promise<void>((resolve) => {
      socket.addEventListener("close", () => {
        events.push("close");
        resolve();
      });
    });
    expect(events).toEqual(["error", "close"]);
    expect(socket.readyState).toBe(3);
    request.mockResolvedValue({ ok: true, value: undefined });
  });
});
