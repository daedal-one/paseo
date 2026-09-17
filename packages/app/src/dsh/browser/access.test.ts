import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionHostIdSchema } from "@deepseek-ai/dsh-client";
import { openBrowserDshHost, readBrowserDshHost } from "./access";
import type { DshHostRuntime } from "../runtime";

const hostId = connectionHostIdSchema.parse("26e99520-f2d3-4874-84b5-07c5ef24775d");
const otherId = connectionHostIdSchema.parse("00293014-2e9f-47ef-bc87-98fe20ebceae");
const identity = { version: 1, hostId, activationId: "118ec681-54df-4bfe-aa49-b2148788417e" };
const fetch = vi.fn<typeof window.fetch>();
const runtimes: DshHostRuntime[] = [];
let events: EventTarget;
const sockets: OfflineSocket[] = [];
// A real generated runtime creates its mux before Connection observes offline state.
// Keep the carrier controlled so no test reaches a machine-local Host.
class OfflineSocket extends EventTarget {
  readyState = 0;
  constructor(_url: string) {
    super();
    sockets.push(this);
  }
  send(_value: string) {}
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal("WebSocket", OfflineSocket);
  events = new EventTarget();
  fetch.mockReset();
  fetch.mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: identity },
    });
  });
  vi.stubGlobal("window", {
    location: { href: "http://127.0.0.1:3080/dsh-hosts" },
    fetch,
    navigator: { onLine: false },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
});
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser DSH owner access", () => {
  it("reads the current Host through generated authenticated RPC", async () => {
    expect(await readBrowserDshHost(new AbortController().signal)).toEqual({
      hostId,
      origin: "http://127.0.0.1:3080",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![0]).toBe("http://127.0.0.1:3080/api/connection/identity");
  });

  it("opens the shared runtime without enrolling or storing a device", async () => {
    const runtime = await openBrowserDshHost({
      hostId,
      selection: { getSnapshot: () => ({}), set() {} },
      signal: new AbortController().signal,
    });
    runtimes.push(runtime);
    expect(runtime.hostId).toBe(hostId);
    expect(runtime.connection.generation.getSnapshot()).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
    expect(runtime.pending.getSnapshot().size).toBe(0);
    await runtime.dispose();
    events.dispatchEvent(new Event("online"));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("refuses a different Host between listing and connection", async () => {
    await expect(
      openBrowserDshHost({
        hostId: otherId,
        selection: { getSnapshot: () => ({}), set() {} },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "runtime-unavailable" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("never starts identity discovery after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      openBrowserDshHost({
        hostId,
        selection: { getSnapshot: () => ({}), set() {} },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "request-cancelled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed Host identity without exposing the response", async () => {
    fetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value: { secret: "private response" } },
      });
    });
    await expect(readBrowserDshHost(new AbortController().signal)).rejects.toThrow(
      "dsh-access/runtime-unavailable",
    );
  });
  it("retains the browser sign-in diagnostic through generated identity RPC", async () => {
    fetch.mockResolvedValue(new Response("Sign in", { status: 401 }));
    await expect(readBrowserDshHost(new AbortController().signal)).rejects.toMatchObject({
      code: "browser-auth-required",
    });
  });

  it("disposes a runtime when initialization is cancelled during Session hydration", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    await expect(
      openBrowserDshHost({
        hostId,
        signal: controller.signal,
        selection: {
          getSnapshot() {
            controller.abort();
            return {};
          },
          set() {},
        },
      }),
    ).rejects.toMatchObject({ code: "request-cancelled" });
    expect(sockets.length).toBeGreaterThan(0);
    expect(sockets.every((socket) => socket.readyState === 3)).toBe(true);
    for (const [event, listener] of add.mock.calls)
      expect(remove).toHaveBeenCalledWith(event, listener);
    events.dispatchEvent(new Event("online"));
    expect(fetch).toHaveBeenCalledOnce();
  });
});
