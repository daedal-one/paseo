import { describe, expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { ConnectionHostId, SessionId, SessionSelection } from "@deepseek-ai/dsh-client";
import { createDshHostRuntime, type DshHostRuntimeOptions } from "./runtime";

function offlineHost(hostId: string) {
  let selection: SessionSelection = {};
  const networkListeners = new Set<() => void>();
  const fetch = vi.fn<DshHostRuntimeOptions["fetch"]>();
  const sockets: { close: ReturnType<typeof vi.fn> }[] = [];
  const createSocket = vi.fn<DshHostRuntimeOptions["createSocket"]>(() => {
    let readyState = 0;
    const socket = {
      get readyState() {
        return readyState;
      },
      send: vi.fn(),
      close: vi.fn(() => {
        readyState = 3;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    sockets.push(socket);
    return socket;
  });
  const options: DshHostRuntimeOptions = {
    hostId: brandString<ConnectionHostId>(hostId),
    baseUrl: "https://paired.example",
    isLocal: false,
    fetch,
    createSocket,
    randomId: () => crypto.randomUUID(),
    timeZone: () => "Europe/Rome",
    selection: {
      getSnapshot: () => selection,
      set(value) {
        selection = value;
      },
    },
    network: {
      getSnapshot: () => false,
      subscribe(listener) {
        networkListeners.add(listener);
        return () => networkListeners.delete(listener);
      },
    },
  };
  return { options, fetch, createSocket, networkListeners, sockets };
}

describe("native DSH runtime ownership", () => {
  it("starts offline without replacing remembered navigation or sending commands", async () => {
    const host = offlineHost("26e99520-f2d3-4874-84b5-07c5ef24775d");
    const remembered: SessionSelection = {
      sessionId: brandString<SessionId>("remembered-session"),
    };
    host.options.selection.set(remembered);
    const runtime = await createDshHostRuntime(host.options);
    try {
      expect(runtime.hostId).toBe(host.options.hostId);
      expect(host.options.selection.getSnapshot()).toEqual(remembered);
      expect(runtime.connection.generation.getSnapshot()).toBeUndefined();
      expect(typeof runtime.remote.session.prompt).toBe("function");
      expect(typeof runtime.sessions.open).toBe("function");
      expect(host.fetch).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
    expect(host.networkListeners.size).toBe(0);
    expect(host.sockets.length).toBeGreaterThan(0);
    for (const socket of host.sockets) expect(socket.close).toHaveBeenCalled();
  });

  it("disposes one Host without withdrawing another Host's services", async () => {
    const first = offlineHost("26e99520-f2d3-4874-84b5-07c5ef24775d");
    const second = offlineHost("00293014-2e9f-47ef-bc87-98fe20ebceae");
    const firstRuntime = await createDshHostRuntime(first.options);
    try {
      const secondRuntime = await createDshHostRuntime(second.options);
      try {
        expect(firstRuntime.remote).not.toBe(secondRuntime.remote);
        expect(firstRuntime.sessions).not.toBe(secondRuntime.sessions);
        expect(firstRuntime.workspaces).not.toBe(secondRuntime.workspaces);
        await firstRuntime.dispose();
        expect(first.networkListeners.size).toBe(0);
        expect(second.networkListeners.size).toBe(1);
        const result = await secondRuntime.remote.session.search({ query: "offline" });
        expect(result.ok).toBe(false);
        expect(second.fetch).not.toHaveBeenCalled();
      } finally {
        await secondRuntime.dispose();
      }
    } finally {
      await firstRuntime.dispose();
    }
    expect(second.networkListeners.size).toBe(0);
  });
});
