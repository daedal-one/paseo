import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionDeviceGrantSchema, connectionHostIdSchema } from "@deepseek-ai/dsh-client";
import { dshDeviceStore, type StoredDshHost } from "./device-store";
import { createNativeDshTransport } from "./transport";
import { pairDshHost, openSavedDshHost } from "./access";
import { parseDshOrigin } from "../host-origin";

interface NativeReply {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array>;
}

const native = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  index: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  indexSet: vi.fn(),
  fetch: vi.fn<(url: string, init: RequestInit) => Promise<NativeReply>>(),
  platform: { OS: "ios" },
}));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: native.get,
  setItemAsync: native.set,
  deleteItemAsync: native.remove,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => native.index.get(key) ?? null,
    setItem: native.indexSet,
  },
}));
vi.mock("expo/fetch", () => ({ fetch: native.fetch }));
vi.mock("react-native", () => ({ Platform: native.platform }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-localization", () => ({ getCalendars: () => [{ timeZone: "Europe/Rome" }] }));

const host = connectionHostIdSchema.parse("26e99520-f2d3-4874-84b5-07c5ef24775d");
const otherHost = connectionHostIdSchema.parse("00293014-2e9f-47ef-bc87-98fe20ebceae");
const device = "7d7d76c2-4a1e-4358-8a14-e497d33ce404";
const grant = connectionDeviceGrantSchema.parse({
  version: 1,
  hostId: host,
  device: { deviceId: device, label: "iPhone", createdAt: 1 },
  credential: `dsh-device-v1.${device}.${"a".repeat(43)}`,
});
const record: StoredDshHost = { version: 1, origin: "https://selected.example", grant };
const indexKey = "daedal.dsh.host-index.v1";
const secretKey = `daedal.dsh.host.${host}`;
const secureOptions = {
  keychainService: "daedal.dsh.device-access.v1",
  keychainAccessible: 6,
  requireAuthentication: false,
};
interface SocketOptions {
  headers: Record<string, string>;
}
class NativeSocket extends EventTarget {
  static instances: NativeSocket[] = [];
  readyState = 0;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  });
  constructor(
    readonly url: string,
    _protocols: unknown,
    readonly options: SocketOptions,
  ) {
    super();
    NativeSocket.instances.push(this);
  }
}
function pairing() {
  return {
    version: 1,
    origin: record.origin,
    enrollment: {
      version: 1,
      hostId: host,
      challenge: "b".repeat(43),
      expiresAt: Date.now() + 60_000,
    },
  };
}
function response(value: unknown, status = 200): NativeReply {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
      controller.close();
    },
  });
  return { ok: status < 400, status, body };
}

function transport() {
  return createNativeDshTransport({ origin: record.origin, credential: grant.credential });
}

beforeEach(() => {
  vi.resetAllMocks();
  native.secrets.clear();
  native.index.clear();
  native.platform.OS = "ios";
  NativeSocket.instances = [];
  native.get.mockImplementation(async (key: string) => native.secrets.get(key) ?? null);
  native.set.mockImplementation(async (key: string, value: string) => {
    native.secrets.set(key, value);
  });
  native.remove.mockImplementation(async (key: string) => {
    native.secrets.delete(key);
  });
  native.indexSet.mockImplementation(async (key: string, value: string) => {
    native.index.set(key, value);
  });
  vi.stubGlobal("WebSocket", NativeSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe("native protected Host access", () => {
  it("serializes separate Host saves and keeps the ordinary index free of grants and origins", async () => {
    await Promise.all([
      dshDeviceStore.save(record),
      dshDeviceStore.save({ ...record, grant: { ...grant, hostId: otherHost } }),
    ]);
    expect(await dshDeviceStore.list()).toEqual([host, otherHost]);
    expect(await dshDeviceStore.load(host)).toEqual(record);
    expect(native.set).toHaveBeenCalledWith(secretKey, JSON.stringify(record), secureOptions);
    expect([...native.index.values()].join()).not.toContain(grant.credential);
    expect([...native.index.values()].join()).not.toContain(record.origin);
  });

  it("does not resurrect a keychain grant after its ordinary index is removed", async () => {
    await dshDeviceStore.save(record);
    native.index.clear();
    native.get.mockClear();
    expect(await dshDeviceStore.load(host)).toBeNull();
    expect(native.get).not.toHaveBeenCalled();
  });

  it("leaves an interrupted save visible and recoverable without falling back to ordinary storage", async () => {
    native.set.mockRejectedValueOnce(new Error(grant.credential));
    await expect(dshDeviceStore.save(record)).rejects.toThrow("dsh-access/storage-unavailable");
    expect(await dshDeviceStore.list()).toEqual([host]);
    expect(await dshDeviceStore.load(host)).toBeNull();
    await dshDeviceStore.save(record);
    expect(await dshDeviceStore.load(host)).toEqual(record);
  });

  it("does not store the grant if writing the public index fails", async () => {
    native.indexSet.mockRejectedValueOnce(new Error("index unavailable"));
    await expect(dshDeviceStore.save(record)).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    expect(native.set).not.toHaveBeenCalled();
  });

  it("retains the index if secret deletion fails and permits a subsequent explicit forget", async () => {
    await dshDeviceStore.save(record);
    native.remove.mockRejectedValueOnce(new Error(grant.credential));
    await expect(dshDeviceStore.forget(host)).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    expect(await dshDeviceStore.load(host)).toEqual(record);
    await dshDeviceStore.forget(host);
    expect(await dshDeviceStore.list()).toEqual([]);
    expect(native.secrets.size).toBe(0);
    expect(native.fetch).not.toHaveBeenCalled();
  });

  it("leaves an unpaired index if index removal fails after secret deletion", async () => {
    await dshDeviceStore.save(record);
    native.indexSet.mockRejectedValueOnce(new Error("index unavailable"));
    await expect(dshDeviceStore.forget(host)).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    expect(await dshDeviceStore.list()).toEqual([host]);
    expect(await dshDeviceStore.load(host)).toBeNull();
  });

  it.each([
    "not-json",
    JSON.stringify({ ...record, version: 2 }),
    JSON.stringify({ ...record, grant: { ...grant, hostId: otherHost } }),
    JSON.stringify({ ...record, grant: { ...grant, credential: "secret-invalid" } }),
  ])(
    "rejects corrupt or transplanted protected records without exposing their contents",
    async (text) => {
      native.index.set(indexKey, JSON.stringify([host]));
      native.secrets.set(secretKey, text);
      await expect(dshDeviceStore.load(host)).rejects.toThrow("dsh-access/invalid-record");
      expect(native.secrets.get(secretKey)).toBe(text);
    },
  );

  it("rejects a corrupt public index instead of silently dropping remembered Hosts", async () => {
    native.index.set(indexKey, JSON.stringify([host, host]));
    await expect(dshDeviceStore.list()).rejects.toMatchObject({ code: "invalid-record" });
    expect(native.get).not.toHaveBeenCalled();
  });

  it("refuses to replace an existing device grant without explicit forgetting", async () => {
    await dshDeviceStore.save(record);
    const replacement = connectionDeviceGrantSchema.parse({
      ...grant,
      credential: `dsh-device-v1.${device}.${"c".repeat(43)}`,
    });
    await expect(dshDeviceStore.save({ ...record, grant: replacement })).rejects.toMatchObject({
      code: "already-paired",
    });
    expect(await dshDeviceStore.load(host)).toEqual(record);
  });
});

describe("selected origin", () => {
  it.each([
    "https://host.example",
    "http://127.0.0.1:3080",
    "http://[::1]:3080",
    "http://100.64.0.1:3081",
    "http://100.127.255.254",
    "http://[fd7a:115c:a1e0::1]:3081",
  ])("accepts %s", (origin) => {
    expect(parseDshOrigin(origin)).toBe(origin);
  });
  it.each([
    "http://public.example",
    "http://192.168.1.2",
    "http://100.63.255.255",
    "http://100.128.0.1",
    "https://host.example/path",
    "https://host.example?",
    "https://host.example#",
    "https://user:secret@host.example",
    "file:///tmp/host",
    "invalid",
    " https://host.example",
  ])("refuses %s", (origin) => {
    expect(() => parseDshOrigin(origin)).toThrow("dsh-access/invalid-origin");
  });
});

describe("native authenticated carriers", () => {
  it("pins HTTP credentials, Origin, cookie omission and redirect refusal", async () => {
    native.fetch.mockResolvedValue(response({ payload: true }));
    const access = transport();
    try {
      const reply = await access.fetch(new URL("/api/read", record.origin), {
        headers: { Cookie: "ambient", Authorization: "wrong" },
        credentials: "include",
        redirect: "follow",
      });
      expect(await reply.json()).toEqual({ payload: true });
      const [url, init] = native.fetch.mock.calls[0];
      expect(url).toBe(`${record.origin}/api/read`);
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${grant.credential}`);
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("origin")).toBe(record.origin);
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
    } finally {
      access.dispose();
    }
  });

  it.each([
    "https://another.example/api",
    "http://selected.example/api",
    "https://selected.example:444/api",
    "https://user:secret@selected.example/api",
    "https://selected.example/api#fragment",
  ])("refuses HTTP target %s before dispatch", async (value) => {
    const access = transport();
    try {
      await expect(access.fetch(new URL(value), {})).rejects.toMatchObject({
        code: "invalid-origin",
      });
    } finally {
      access.dispose();
    }
    expect(native.fetch).not.toHaveBeenCalled();
  });

  it("retains cancellation through JSON body decoding and discards late data", async () => {
    const cancelBody = vi.fn();
    native.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({ cancel: cancelBody }),
    });
    const access = transport();
    const caller = new AbortController();
    const pending = access.fetch(new URL(record.origin), { signal: caller.signal });
    await vi.waitFor(() => expect(native.fetch).toHaveBeenCalled());
    caller.abort(new Error(grant.credential));
    expect(native.fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow("dsh-access/request-cancelled");
    expect(cancelBody).toHaveBeenCalledOnce();
    access.dispose();
  });

  it("disposes HTTP body readers and sockets together and refuses new work", async () => {
    const cancelBody = vi.fn();
    native.fetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({ cancel: cancelBody }),
    }));
    const access = transport();
    const pending = access.fetch(new URL(record.origin), {});
    await vi.waitFor(() => expect(native.fetch).toHaveBeenCalled());
    access.createSocket("wss://selected.example/api/remote.mux");
    access.dispose();
    await expect(pending).rejects.toMatchObject({ code: "request-cancelled" });
    expect(NativeSocket.instances[0].close).toHaveBeenCalled();
    expect(cancelBody).toHaveBeenCalledOnce();
    await expect(access.fetch(new URL(record.origin), {})).rejects.toMatchObject({
      code: "transport-disposed",
    });
    expect(() => access.createSocket("wss://selected.example/api/remote.mux")).toThrow(
      "dsh-access/transport-disposed",
    );
  });

  it("sends bearer and selected Origin on WebSocket and refuses other authorities", () => {
    const access = transport();
    try {
      const socket = access.createSocket("wss://selected.example/api/remote.mux");
      expect(NativeSocket.instances[0].options.headers).toEqual({
        Authorization: `Bearer ${grant.credential}`,
        Origin: record.origin,
      });
      expect(() => access.createSocket("wss://another.example/api/remote.mux")).toThrow(
        "dsh-access/invalid-origin",
      );
      NativeSocket.instances[0].send.mockImplementation(() => {
        throw new Error(grant.credential);
      });
      expect(() => socket.send("frame")).toThrow("dsh-access/transport-failed");
    } finally {
      access.dispose();
    }
  });

  it("decodes UTF-8 split across native body chunks", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ value: "Hello 👋" }));
    native.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
    });
    const access = transport();
    try {
      expect(await (await access.fetch(new URL(record.origin), {})).json()).toEqual({
        value: "Hello 👋",
      });
    } finally {
      access.dispose();
    }
  });

  it("sanitizes failure during a native response body without leaving it locked", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(grant.credential));
      },
    });
    native.fetch.mockResolvedValue({ ok: true, status: 200, body });
    const access = transport();
    try {
      await expect(access.fetch(new URL(record.origin), {})).rejects.toThrow(
        "dsh-access/transport-failed",
      );
    } finally {
      access.dispose();
    }
    expect(body.locked).toBe(false);
  });

  it("sanitizes native fetch errors and never retries the request", async () => {
    native.fetch.mockRejectedValue(new Error(grant.credential));
    const access = transport();
    try {
      await expect(access.fetch(new URL(record.origin), {})).rejects.toThrow(
        "dsh-access/transport-failed",
      );
    } finally {
      access.dispose();
    }
    expect(native.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch pre-cancelled calls or qualify another platform implicitly", async () => {
    const access = transport();
    const signal = AbortSignal.abort();
    await expect(access.fetch(new URL(record.origin), { signal })).rejects.toMatchObject({
      code: "request-cancelled",
    });
    access.dispose();
    native.platform.OS = "android";
    expect(transport).toThrow("dsh-access/unsupported-platform");
    expect(native.fetch).not.toHaveBeenCalled();
  });
});

describe("native enrollment and runtime composition", () => {
  it("saves the validated one-shot claim before returning and serializes duplicate pairing", async () => {
    native.fetch.mockResolvedValue(response({ ok: true, value: grant }));
    const options = {
      pairing: pairing(),
      deviceLabel: " iPhone ",
      signal: new AbortController().signal,
    };
    const [first, second] = await Promise.allSettled([pairDshHost(options), pairDshHost(options)]);
    expect(first).toMatchObject({ status: "fulfilled", value: record });
    expect(second).toMatchObject({ status: "rejected", reason: { code: "already-paired" } });
    expect(await dshDeviceStore.load(host)).toEqual(record);
    expect(native.fetch).toHaveBeenCalledTimes(1);
    const [, init] = native.fetch.mock.calls[0];
    expect(new Headers(init.headers).get("authorization")).toBeNull();
    expect(JSON.parse(String(init.body))).toMatchObject({ hostId: host, label: "iPhone" });
  });

  it("does not report pairing success when protected storage fails after the claim", async () => {
    native.fetch.mockResolvedValue(response({ ok: true, value: grant }));
    native.set.mockRejectedValue(new Error(grant.credential));
    await expect(
      pairDshHost({
        pairing: pairing(),
        deviceLabel: "iPhone",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("dsh-access/enrollment-save-failed");
    expect(native.fetch).toHaveBeenCalledTimes(1);
    expect(await dshDeviceStore.load(host)).toBeNull();
  });

  it.each(["lost", "invalid"])(
    "preserves an unknown outcome after a %s result without replay",
    async (mode) => {
      if (mode === "lost") native.fetch.mockRejectedValue(new Error(grant.credential));
      else native.fetch.mockResolvedValue(response({ unexpected: grant.credential }));
      await expect(
        pairDshHost({
          pairing: pairing(),
          deviceLabel: "iPhone",
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("dsh-access/enrollment-outcome-unknown");
      expect(native.fetch).toHaveBeenCalledTimes(1);
      expect(native.set).not.toHaveBeenCalled();
    },
  );

  it("rejects expired enrollment before dispatch and sanitizes Host rejection text", async () => {
    const expired = pairing();
    expired.enrollment.expiresAt = 1;
    await expect(
      pairDshHost({
        pairing: expired,
        deviceLabel: "iPhone",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "expired-enrollment" });
    expect(native.fetch).not.toHaveBeenCalled();
    native.fetch.mockResolvedValue(
      response(
        {
          ok: false,
          error: { code: "connection/enrollment-expired", message: grant.credential, details: {} },
        },
        403,
      ),
    );
    await expect(
      pairDshHost({
        pairing: pairing(),
        deviceLabel: "iPhone",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("dsh-access/enrollment-rejected");
  });

  it("hydrates saved access before creating the actual Cordis runtime and disposes its carriers", async () => {
    const options = {
      hostId: host,
      selection: { getSnapshot: () => ({}), set: vi.fn() },
      network: { getSnapshot: () => false, subscribe: () => () => {} },
    };
    await expect(openSavedDshHost(options)).rejects.toMatchObject({ code: "not-paired" });
    expect(NativeSocket.instances).toHaveLength(0);
    await dshDeviceStore.save(record);
    const runtime = await openSavedDshHost(options);
    try {
      expect(runtime.hostId).toBe(host);
      expect(runtime.connection.generation.getSnapshot()).toBeUndefined();
      expect(NativeSocket.instances.length).toBeGreaterThan(0);
      expect(NativeSocket.instances[0].options.headers.Authorization).toBe(
        `Bearer ${grant.credential}`,
      );
    } finally {
      await runtime.dispose();
    }
    for (const socket of NativeSocket.instances) expect(socket.close).toHaveBeenCalled();
  });
});
