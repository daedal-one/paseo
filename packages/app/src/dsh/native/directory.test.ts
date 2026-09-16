import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionId } from "@deepseek-ai/dsh-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionDeviceGrantSchema, connectionHostIdSchema } from "@deepseek-ai/dsh-client";
import { DshDirectory, openDshDirectory } from "./directory";
import { dshDeviceStore, type StoredDshHost } from "./device-store";
import { openSavedDshHost, pairDshHost } from "./access";
import { DshAccessError } from "../access-error";
import { decodeDshPairing } from "../pairing";
import { createDshHostRuntime, type DshHostRuntime } from "../runtime";

vi.mock("./device-store", () => ({
  dshDeviceStore: { list: vi.fn(), load: vi.fn(), forget: vi.fn() },
}));
vi.mock("./access", () => ({ openSavedDshHost: vi.fn(), pairDshHost: vi.fn() }));
const hostId = connectionHostIdSchema.parse("26e99520-f2d3-4874-84b5-07c5ef24775d");
const secondId = connectionHostIdSchema.parse("00293014-2e9f-47ef-bc87-98fe20ebceae");
const deviceId = "7d7d76c2-4a1e-4358-8a14-e497d33ce404";
const record: StoredDshHost = {
  version: 1,
  origin: "https://selected.example",
  grant: connectionDeviceGrantSchema.parse({
    version: 1,
    hostId,
    device: { deviceId, label: "iPhone", createdAt: 1 },
    credential: `dsh-device-v1.${deviceId}.${"a".repeat(43)}`,
  }),
};
function pairing() {
  return {
    version: 1,
    origin: record.origin,
    enrollment: { version: 1, hostId, challenge: "b".repeat(43), expiresAt: Date.now() + 60_000 },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const directories: DshDirectory[] = [];
const runtimes: DshHostRuntime[] = [];
function directory() {
  const model = new DshDirectory();
  directories.push(model);
  return model;
}
async function offlineRuntime(id = hostId): Promise<DshHostRuntime> {
  const runtime = await createDshHostRuntime({
    hostId: id,
    baseUrl: record.origin,
    isLocal: false,
    fetch: async () => {
      throw new Error("offline transport must not dispatch");
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
  runtimes.push(runtime);
  return runtime;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(dshDeviceStore.list).mockResolvedValue([hostId]);
  vi.mocked(dshDeviceStore.load).mockResolvedValue(record);
  vi.mocked(dshDeviceStore.forget).mockResolvedValue();
});
afterEach(async () => {
  for (const model of directories.splice(0)) await model.dispose();
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
});

describe("native DSH Host directory", () => {
  it("keeps unavailable Session selection visible without inventing a connection", async () => {
    const model = directory();
    await model.openConversation(brandString<SessionId>("missing"), null);
    expect(model.getSnapshot().error).toBe("session-unavailable");
    expect(model.getSnapshot().conversation).toBeNull();
    expect(openSavedDshHost).not.toHaveBeenCalled();
    await model.dispose();
    await model.openConversation(brandString<SessionId>("missing"), null);
    expect(model.getSnapshot().conversation).toBeNull();
  });

  it("distinguishes initial loading from a hydrated empty directory", async () => {
    vi.mocked(dshDeviceStore.list).mockResolvedValue([]);
    const model = directory();
    expect(model.getSnapshot().directory.status).toBe("loading");
    await model.reload();
    expect(model.getSnapshot().directory).toEqual({ status: "ready", hosts: [] });
  });
  it("publishes redacted metadata without a device grant", async () => {
    const model = directory();
    await model.reload();
    expect(model.getSnapshot().directory).toEqual({
      status: "ready",
      hosts: [{ hostId, status: "paired", origin: record.origin, label: "iPhone" }],
    });
    expect(JSON.stringify(model.getSnapshot())).not.toContain(record.grant.credential);
  });
  it("keeps partial and unreadable records visible for local recovery", async () => {
    vi.mocked(dshDeviceStore.list).mockResolvedValue([hostId, secondId]);
    vi.mocked(dshDeviceStore.load)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new DshAccessError("invalid-record"));
    const model = directory();
    await model.reload();
    expect(model.getSnapshot().directory).toEqual({
      status: "ready",
      hosts: [
        { hostId, status: "unavailable", error: "not-paired" },
        { hostId: secondId, status: "unavailable", error: "invalid-record" },
      ],
    });
  });
  it("reports index failure instead of showing an empty list", async () => {
    vi.mocked(dshDeviceStore.list).mockRejectedValue(new Error("private native diagnostic"));
    const model = directory();
    await model.reload();
    expect(model.getSnapshot().directory).toEqual({
      status: "failed",
      error: "storage-unavailable",
    });
  });
  it("requires confirmation and ignores repeated or replaced camera frames", () => {
    const model = directory();
    model.scan();
    model.scanned(JSON.stringify(pairing()));
    const review = model.getSnapshot().pairing;
    model.scanned("replacement");
    expect(model.getSnapshot().pairing).toBe(review);
    expect(review.status).toBe("review");
    expect(pairDshHost).not.toHaveBeenCalled();
  });
  it("submits only one claim and lists the saved Host after success", async () => {
    const claim = deferred<StoredDshHost>();
    vi.mocked(pairDshHost).mockReturnValue(claim.promise);
    const model = directory();
    model.scan();
    model.scanned(JSON.stringify(pairing()));
    const pending = model.pair("My iPhone");
    void model.pair("duplicate");
    expect(model.getSnapshot().pairing.status).toBe("claiming");
    expect(pairDshHost).toHaveBeenCalledTimes(1);
    expect(dshDeviceStore.list).not.toHaveBeenCalled();
    claim.resolve(record);
    await pending;
    expect(model.getSnapshot().pairing.status).toBe("idle");
    expect(model.getSnapshot().directory.status).toBe("ready");
  });
  it("exposes unknown claim outcomes without retaining a retryable challenge", async () => {
    vi.mocked(pairDshHost).mockRejectedValue(new DshAccessError("enrollment-outcome-unknown"));
    const model = directory();
    model.scan();
    model.scanned(JSON.stringify(pairing()));
    await model.pair("iPhone");
    await model.pair("retry");
    expect(model.getSnapshot().pairing).toEqual({
      status: "failed",
      error: "enrollment-outcome-unknown",
    });
    expect(pairDshHost).toHaveBeenCalledTimes(1);
  });
  it("cancels a claim on disposal and ignores a late pairing completion", async () => {
    const claim = deferred<StoredDshHost>();
    vi.mocked(pairDshHost).mockReturnValue(claim.promise);
    const model = directory();
    model.scan();
    model.scanned(JSON.stringify(pairing()));
    const pending = model.pair("iPhone");
    const close = model.dispose();
    expect(vi.mocked(pairDshHost).mock.calls[0][0].signal.aborted).toBe(true);
    const snapshot = model.getSnapshot();
    claim.resolve(record);
    await pending;
    await close;
    expect(model.getSnapshot()).toBe(snapshot);
  });
  it("deduplicates pending opens and reconnects the same Host without another runtime", async () => {
    const open = deferred<DshHostRuntime>();
    vi.mocked(openSavedDshHost).mockReturnValue(open.promise);
    const model = directory();
    const pending = model.connect(hostId);
    void model.connect(hostId);
    // connect passes through the disposal barrier before opening a new Host.
    await Promise.resolve();
    expect(openSavedDshHost).toHaveBeenCalledTimes(1);
    const runtime = await offlineRuntime();
    const reconnect = vi.spyOn(runtime.connection, "reconnect");
    open.resolve(runtime);
    await pending;
    await model.connect(hostId);
    expect(reconnect).not.toHaveBeenCalled();
    model.reconnect();
    expect(openSavedDshHost).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledOnce();
  });
  it("waits for old Host disposal before switching connections", async () => {
    const first = await offlineRuntime();
    const second = await offlineRuntime(secondId);
    vi.mocked(openSavedDshHost).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const model = directory();
    await model.connect(hostId);
    const closing = deferred<void>();
    const original = first.dispose;
    vi.spyOn(first, "dispose").mockImplementationOnce(() => closing.promise);
    const switching = model.connect(secondId);
    await Promise.resolve();
    expect(openSavedDshHost).toHaveBeenCalledTimes(1);
    closing.resolve();
    await switching;
    await original();
    expect(model.getSnapshot().runtime).toBe(second);
  });
  it("disposes an opening runtime that arrives after screen exit", async () => {
    const open = deferred<DshHostRuntime>();
    vi.mocked(openSavedDshHost).mockReturnValue(open.promise);
    const model = directory();
    const opening = model.connect(hostId);
    await Promise.resolve();
    const closing = model.dispose();
    const runtime = await offlineRuntime();
    const dispose = vi.spyOn(runtime, "dispose");
    open.resolve(runtime);
    await opening;
    await closing;
    expect(dispose).toHaveBeenCalledOnce();
    expect(model.getSnapshot().runtime).toBeNull();
  });
  it("keeps disposal failed when a late runtime cannot close", async () => {
    const open = deferred<DshHostRuntime>();
    vi.mocked(openSavedDshHost).mockReturnValue(open.promise);
    const model = new DshDirectory();
    const opening = model.connect(hostId);
    await Promise.resolve();
    const closing = model.dispose();
    const rejected = expect(closing).rejects.toMatchObject({ code: "runtime-unavailable" });
    const runtime = await offlineRuntime();
    vi.spyOn(runtime, "dispose").mockRejectedValueOnce(new Error("carrier did not close"));
    open.resolve(runtime);
    await opening;
    await rejected;
    await expect(model.dispose()).rejects.toMatchObject({ code: "runtime-unavailable" });
    expect(model.getSnapshot().runtime).toBeNull();
  });
  it("waits for connection disposal before forgetting a grant", async () => {
    const runtime = await offlineRuntime();
    vi.mocked(openSavedDshHost).mockResolvedValue(runtime);
    const model = directory();
    await model.connect(hostId);
    const closing = deferred<void>();
    const original = runtime.dispose;
    vi.spyOn(runtime, "dispose").mockImplementationOnce(() => closing.promise);
    const forgetting = model.forget(hostId);
    expect(dshDeviceStore.forget).not.toHaveBeenCalled();
    closing.resolve();
    await forgetting;
    await original();
    expect(dshDeviceStore.forget).toHaveBeenCalledWith(hostId);
    expect(model.getSnapshot().runtime).toBeNull();
  });
  it("keeps a grant when runtime disposal fails and allows explicit recovery", async () => {
    const runtime = await offlineRuntime();
    vi.mocked(openSavedDshHost).mockResolvedValue(runtime);
    const model = directory();
    await model.connect(hostId);
    vi.spyOn(runtime, "dispose").mockRejectedValueOnce(new Error("private transport error"));
    await model.forget(hostId);
    expect(dshDeviceStore.forget).not.toHaveBeenCalled();
    expect(model.getSnapshot().error).toBe("runtime-unavailable");
    await model.forget(hostId);
    expect(dshDeviceStore.forget).toHaveBeenCalledOnce();
  });
  it("retains a visible entry when removing protected storage fails", async () => {
    const model = directory();
    await model.reload();
    vi.mocked(dshDeviceStore.forget).mockRejectedValue(new DshAccessError("storage-unavailable"));
    await model.forget(hostId);
    expect(model.getSnapshot().error).toBe("storage-unavailable");
    expect(model.getSnapshot().directory.status).toBe("ready");
  });
  it("reports refresh failure without sending mutations", async () => {
    const runtime = await offlineRuntime();
    vi.mocked(openSavedDshHost).mockResolvedValue(runtime);
    const refresh = vi
      .spyOn(runtime.sessions, "refresh")
      .mockRejectedValue(new Error("private RPC error"));
    const model = directory();
    await model.connect(hostId);
    await model.refreshSessions();
    expect(refresh).toHaveBeenCalledOnce();
    expect(model.getSnapshot().error).toBe("session-refresh-failed");
  });
  it("closes carriers before waiting for a stalled Session refresh", async () => {
    const runtime = await offlineRuntime();
    vi.mocked(openSavedDshHost).mockResolvedValue(runtime);
    const read = deferred<void>();
    vi.spyOn(runtime.sessions, "refresh").mockReturnValue(read.promise);
    const original = runtime.dispose;
    const dispose = vi.spyOn(runtime, "dispose").mockImplementation(async () => {
      read.resolve();
      await original();
    });
    const model = directory();
    await model.connect(hostId);
    const refreshing = model.refreshSessions();
    const closing = model.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    await refreshing;
    await closing;
  });
  it("hands off between route instances only after the previous runtime closes", async () => {
    const runtime = await offlineRuntime();
    vi.mocked(openSavedDshHost).mockResolvedValue(runtime);
    const first = await openDshDirectory();
    directories.push(first);
    await first.connect(hostId);
    const close = deferred<void>();
    const original = runtime.dispose;
    vi.spyOn(runtime, "dispose").mockImplementationOnce(() => close.promise);
    let opened = false;
    const next = openDshDirectory().then((model) => {
      opened = true;
      directories.push(model);
      return model;
    });
    await Promise.resolve();
    expect(opened).toBe(false);
    close.resolve();
    await next;
    await original();
    expect(opened).toBe(true);
  });
  it("does not open or claim after disposal", async () => {
    const model = directory();
    await model.dispose();
    model.scan();
    await model.connect(hostId);
    await model.reload();
    expect(openSavedDshHost).not.toHaveBeenCalled();
    expect(dshDeviceStore.list).not.toHaveBeenCalled();
  });
});

describe("native device QR input", () => {
  it.each([
    "x",
    "x".repeat(4097),
    JSON.stringify({ ...pairing(), credential: "unexpected" }),
    JSON.stringify({ ...pairing(), origin: "https://selected.example/path" }),
    JSON.stringify({ ...pairing(), enrollment: { ...pairing().enrollment, expiresAt: 1 } }),
  ])("rejects invalid, oversized, extended or expired data without network access", (raw) => {
    expect(() => decodeDshPairing(raw)).toThrow(DshAccessError);
    expect(pairDshHost).not.toHaveBeenCalled();
  });
});
