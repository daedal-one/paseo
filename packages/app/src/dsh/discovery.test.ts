import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hostDiscoveryCandidateSchema,
  type ConnectionHandle,
  type ConnectionHostId,
} from "@deepseek-ai/dsh-client";
import { DshDiscovery } from "./discovery";
import { DshDirectory, type DshDirectoryAccess, type DshDirectoryHost } from "./directory";
import { createDshHostRuntime } from "./runtime";

type AdmittedGeneration = NonNullable<ReturnType<ConnectionHandle["generation"]["getSnapshot"]>>;

const host = hostDiscoveryCandidateSchema.parse({
  version: 1,
  label: "Assisting Host",
  origin: "http://100.64.0.1:3081",
  identity: {
    version: 1,
    hostId: "26e99520-f2d3-4874-84b5-07c5ef24775d",
    activationId: "a4812920-925c-4117-a9a4-7881b26df13a",
  },
}).identity;
const candidate = hostDiscoveryCandidateSchema.parse({
  version: 1,
  identity: {
    version: 1,
    hostId: "00293014-2e9f-47ef-bc87-98fe20ebceae",
    activationId: "1d736f49-e411-4375-b8eb-9baaa8b2543a",
  },
  label: "Another DSH host",
  origin: "http://100.64.0.9:3081",
});
const ready = { version: 1, host, status: "ready", truncated: true, candidates: [candidate] };
type RpcResult = Awaited<ReturnType<ConnectionHandle["rpc"]["call"]>>;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});

function connection() {
  let generation: AdmittedGeneration | undefined;
  const listeners = new Set<() => void>();
  const requests: {
    channel: string;
    endpoint: string;
    payload: unknown;
    signal: AbortSignal | undefined;
    resolve(value: RpcResult): void;
    reject(error: Error): void;
  }[] = [];
  const port: Pick<ConnectionHandle, "generation" | "rpc"> = {
    generation: {
      getSnapshot: () => generation,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    rpc: {
      call(channel, endpoint, payload, signal) {
        return new Promise<RpcResult>((resolve, reject) => {
          requests.push({ channel, endpoint, payload, signal, resolve, reject });
        });
      },
    },
  };
  function set(next: AdmittedGeneration | undefined) {
    generation = next;
    for (const listener of listeners) listener();
  }
  return {
    port,
    requests,
    listeners,
    set,
    admit: () => set({ id: 1, host: { home: "", identity: host } }),
  };
}

function discoveryModel() {
  const carrier = connection();
  const discovery = new DshDiscovery(carrier.port, host.hostId);
  cleanup.push(() => discovery.dispose());
  return { ...carrier, discovery };
}

async function settle(
  discovery: DshDiscovery,
  request: ReturnType<typeof connection>["requests"][number],
  value: unknown = ready,
) {
  const pending = discovery.refresh();
  request.resolve({ ok: true, value });
  await pending;
}

describe("DSH discovery ownership", () => {
  it("starts only after admission and sends no candidate data to the assisting Host", async () => {
    const c = discoveryModel();
    expect(c.discovery.getSnapshot()).toEqual({ status: "offline" });
    await c.discovery.refresh();
    expect(c.requests).toHaveLength(0);
    c.admit();
    expect(c.discovery.getSnapshot()).toEqual({ status: "loading" });
    expect(c.requests).toHaveLength(1);
    const request = c.requests[0];
    expect({
      channel: request.channel,
      endpoint: request.endpoint,
      payload: request.payload,
    }).toEqual({ channel: "/api", endpoint: "connection/discovery", payload: {} });
    expect(c.discovery.refresh()).toBe(c.discovery.refresh());
    await settle(c.discovery, request);
    expect(c.discovery.getSnapshot()).toEqual({
      status: "ready",
      candidates: [candidate],
      truncated: true,
    });
    expect(c.requests).toHaveLength(1);
    const refresh = c.discovery.refresh();
    expect(c.discovery.getSnapshot()).toEqual({ status: "loading" });
    c.requests[1].resolve({ ok: true, value: { ...ready, candidates: [], truncated: false } });
    await refresh;
    expect(c.discovery.getSnapshot()).toEqual({
      status: "ready",
      candidates: [],
      truncated: false,
    });
  });

  it.each(["tailscale-unavailable", "tailscale-disconnected", "scan-failed"])(
    "preserves %s without exposing transport diagnostics",
    async (status) => {
      const c = discoveryModel();
      c.admit();
      await settle(c.discovery, c.requests[0], { ...ready, status, candidates: [] });
      expect(c.discovery.getSnapshot()).toEqual({ status });
    },
  );

  it.each([
    { ...ready, host: { ...host, hostId: candidate.identity.hostId } },
    { ...ready, host: { ...host, activationId: candidate.identity.activationId } },
    { ...ready, candidates: [{ ...candidate, origin: "http://127.0.0.1:3081" }] },
    { ...ready, candidates: [candidate, candidate] },
    { ...ready, secret: "private" },
  ])("refuses malformed or foreign metadata", async (value) => {
    const c = discoveryModel();
    c.admit();
    await settle(c.discovery, c.requests[0], value);
    expect(c.discovery.getSnapshot()).toEqual({ status: "invalid-response" });
  });

  it("keeps missing optional routes and lost reads independent of the connection", async () => {
    const c = discoveryModel();
    c.admit();
    const pending = c.discovery.refresh();
    c.requests[0].reject(new Error("HTTP 404 with a private transport diagnostic"));
    await pending;
    expect(c.discovery.getSnapshot()).toEqual({ status: "unavailable" });
    expect(c.port.generation.getSnapshot()).toBeDefined();
    const retry = c.discovery.refresh();
    c.requests[1].resolve({
      ok: false,
      error: { code: "missing", message: "private", details: {} },
    });
    await retry;
    expect(c.discovery.getSnapshot()).toEqual({ status: "unavailable" });
  });

  it("rejects unbound generations without dispatch", async () => {
    const c = discoveryModel();
    c.set({ id: 1, host: { home: "" } });
    expect(c.discovery.getSnapshot()).toEqual({ status: "invalid-response" });
    c.set({ id: 2, host: { home: "", identity: candidate.identity } });
    expect(c.requests).toHaveLength(0);
  });

  it("clears results on disconnect and waits for cancelled reads before scanning a new generation", async () => {
    const c = discoveryModel();
    c.admit();
    const pending = c.discovery.refresh();
    c.set(undefined);
    expect(c.requests[0].signal?.aborted).toBe(true);
    expect(c.discovery.getSnapshot()).toEqual({ status: "offline" });
    c.set({
      id: 2,
      host: { home: "", identity: { ...host, activationId: candidate.identity.activationId } },
    });
    expect(c.requests).toHaveLength(1);
    c.requests[0].resolve({ ok: true, value: ready });
    await pending;
    expect(c.requests).toHaveLength(2);
    expect(c.discovery.getSnapshot()).toEqual({ status: "loading" });
    await settle(c.discovery, c.requests[1], {
      ...ready,
      host: { ...host, activationId: candidate.identity.activationId },
    });
    expect(c.discovery.getSnapshot().status).toBe("ready");
    c.set(undefined);
    expect(c.discovery.getSnapshot()).toEqual({ status: "offline" });
  });

  it("disposal waits for cancellation and refuses late publication or refresh", async () => {
    const c = discoveryModel();
    let publications = 0;
    c.discovery.subscribe(() => {
      publications++;
    });
    c.admit();
    const closing = c.discovery.dispose();
    expect(c.listeners.size).toBe(0);
    expect(c.requests[0].signal?.aborted).toBe(true);
    c.requests[0].resolve({ ok: true, value: ready });
    await closing;
    c.admit();
    await c.discovery.refresh();
    expect(c.requests).toHaveLength(1);
    expect(c.discovery.getSnapshot()).toEqual({ status: "offline" });
    expect(publications).toBe(1);
  });
});

async function directory(saved: readonly DshDirectoryHost[] = []) {
  const c = connection();
  const runtime = await createDshHostRuntime({
    hostId: host.hostId,
    baseUrl: "https://paired.example",
    isLocal: false,
    fetch: async () => {
      throw new Error("offline runtime must not send");
    },
    createSocket: () => ({
      readyState: 0,
      send() {},
      close() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    randomId: () => crypto.randomUUID(),
    timeZone: () => "UTC",
    selection: { getSnapshot: () => ({}), set() {} },
    network: { getSnapshot: () => false, subscribe: () => () => {} },
  });
  cleanup.push(() => runtime.dispose());
  const opened: ConnectionHostId[] = [];
  const paired: unknown[] = [];
  const access: DshDirectoryAccess = {
    list: async () => [
      { hostId: host.hostId, status: "paired", origin: "https://paired.example", label: "Primary" },
      ...saved,
    ],
    open: async (options) => {
      opened.push(options.hostId);
      return {
        ...runtime,
        hostId: options.hostId,
        connection: { ...runtime.connection, ...c.port },
      };
    },
    pair: async (options) => {
      paired.push(options.pairing);
    },
    forget: async () => {},
  };
  const model = new DshDirectory(access);
  cleanup.push(() => model.dispose());
  await model.reload();
  await model.connect(host.hostId);
  c.admit();
  const discovery = model.getSnapshot().discovery;
  if (discovery === null) throw new Error("connected directory needs discovery");
  await settle(discovery, c.requests[0]);
  return { ...c, model, opened, paired };
}
function qr(id = candidate.identity.hostId) {
  return JSON.stringify({
    version: 1,
    origin: "https://owner-approved.example",
    enrollment: {
      version: 1,
      hostId: id,
      challenge: "b".repeat(43),
      expiresAt: Date.now() + 60_000,
    },
  });
}

describe("discovered Host selection", () => {
  it("uses a saved Host's identity without sending its credential or rewriting its origin", async () => {
    const saved: DshDirectoryHost = {
      status: "paired",
      hostId: candidate.identity.hostId,
      origin: "https://saved.example",
      label: "Saved device",
    };
    const c = await directory([saved]);
    const opening = c.model.selectDiscoveredHost(candidate.identity.hostId);
    await vi.waitFor(() => expect(c.opened).toHaveLength(2));
    // The new runtime gets a deliberate foreign-generation refusal; no scan is admitted.
    await opening;
    expect(c.opened).toEqual([host.hostId, candidate.identity.hostId]);
    expect(c.model.getSnapshot().directory).toMatchObject({
      hosts: expect.arrayContaining([saved]),
    });
    expect(c.paired).toHaveLength(0);
    expect(c.requests).toHaveLength(1);
  });

  it("requires the selected Host's QR and preserves the QR origin instead of the advertisement", async () => {
    const c = await directory();
    await c.model.selectDiscoveredHost(candidate.identity.hostId);
    c.model.scanned(qr(host.hostId));
    expect(c.model.getSnapshot().pairing.status).toBe("wrong-host");
    await c.model.pair("iPhone");
    expect(c.paired).toHaveLength(0);
    const approved = qr();
    c.model.scan();
    c.model.scanned(approved);
    expect(c.model.getSnapshot().pairing).toMatchObject({
      status: "review",
      pairing: { origin: "https://owner-approved.example" },
    });
    await c.model.pair("iPhone");
    expect(c.paired).toEqual([JSON.parse(approved)]);
  });

  it("cancellation releases the identity constraint and offline candidates cannot start enrollment", async () => {
    const c = await directory();
    await c.model.selectDiscoveredHost(candidate.identity.hostId);
    c.model.cancelPairing();
    c.model.scan();
    c.model.scanned(qr(host.hostId));
    expect(c.model.getSnapshot().pairing.status).toBe("review");
    c.model.cancelPairing();
    c.set(undefined);
    await c.model.selectDiscoveredHost(candidate.identity.hostId);
    expect(c.model.getSnapshot().pairing.status).toBe("idle");
    expect(c.paired).toHaveLength(0);
  });

  it("keeps unavailable saved access as a recovery case", async () => {
    const c = await directory([
      { status: "unavailable", hostId: candidate.identity.hostId, error: "invalid-record" },
    ]);
    await c.model.selectDiscoveredHost(candidate.identity.hostId);
    expect(c.model.getSnapshot().error).toBe("invalid-record");
    expect(c.model.getSnapshot().pairing.status).toBe("idle");
    expect(c.paired).toHaveLength(0);
  });
});
