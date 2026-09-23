import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionDeviceGrantSchema } from "@deepseek-ai/dsh-client";
import { DesktopDshAccess } from "./access";
import type { DesktopDshDeviceStore } from "./device-store";
import type { StoredDshHost } from "@getpaseo/protocol/dsh-access";

const mock = vi.hoisted(() => ({ claim: vi.fn(), create: vi.fn() }));
vi.mock("@deepseek-ai/dsh-client", async (original) => ({
  ...(await original<typeof import("@deepseek-ai/dsh-client")>()),
  claimDeviceEnrollment: mock.claim,
}));
vi.mock("./transport.js", () => ({ createDesktopDshTransport: mock.create }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const deviceId = randomUUID();
const record: StoredDshHost = {
  version: 1,
  origin: "https://host.example",
  grant: connectionDeviceGrantSchema.parse({
    version: 1,
    hostId: randomUUID(),
    device: { deviceId, label: "Desktop", createdAt: 1 },
    credential: `dsh-device-v1.${deviceId}.${"a".repeat(43)}`,
  }),
};
const owners: DesktopDshAccess[] = [];
beforeEach(() => {
  mock.claim.mockReset();
  mock.create.mockReset();
});
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.dispose()));
});
function fixture(saved: StoredDshHost | null = record) {
  const store: Pick<DesktopDshDeviceStore, "load" | "save" | "forget" | "list"> = {
    load: vi.fn(async () => saved),
    save: vi.fn(async (value) => {
      saved = value;
    }),
    forget: vi.fn(async () => {
      saved = null;
    }),
    list: vi.fn(async () => []),
  };
  const transport = {
    origin: record.origin,
    fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
    openSocket: vi.fn(),
    dispose: vi.fn(async () => {}),
  };
  mock.create.mockReturnValue(transport);
  const emit = vi.fn();
  const access = new DesktopDshAccess(store, emit);
  owners.push(access);
  return { access, store, transport, emit };
}
function pair() {
  return {
    type: "pair" as const,
    claimId: randomUUID(),
    label: "Desktop",
    pairing: {
      version: 1,
      origin: record.origin,
      enrollment: {
        version: 1,
        hostId: record.grant.hostId,
        challenge: "a".repeat(43),
        expiresAt: Date.now() + 60_000,
      },
    },
  };
}

describe("desktop window and grant ownership", () => {
  it("does not let another window use or close an owner", async () => {
    const { access, transport } = fixture();
    const ownerId = randomUUID();
    const descriptor = await access.run(1, { type: "open", ownerId, hostId: record.grant.hostId });
    expect(JSON.stringify(descriptor)).not.toContain(record.grant.credential);
    await expect(access.run(2, { type: "close", ownerId })).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(
      access.run(2, {
        type: "fetch",
        ownerId,
        requestId: randomUUID(),
        url: record.origin + "/api/session/list",
        method: "POST",
        body: "{}",
        headers: {},
      }),
    ).rejects.toMatchObject({ code: "transport-disposed" });
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(transport.dispose).not.toHaveBeenCalled();
    await access.closeWindow(1);
    expect(transport.dispose).toHaveBeenCalledOnce();
  });
  it("denies enrollment and arbitrary endpoints through ordinary renderer requests", async () => {
    const { access, transport } = fixture();
    const ownerId = randomUUID();
    await access.run(1, { type: "open", ownerId, hostId: record.grant.hostId });
    for (const path of [
      "/api/connection/device/claim",
      "/api/connection/enrollment",
      "/api/connection/discovery/advertisement",
      "/api/connection/discovery?target=other",
      "/api/session/list?redirect=true",
      "/api/session/historyDetail/other",
      "/api/session/page?host=other",
      "/api/session/attachment?host=other",
      "/api/session/attachment/other",
      "/api/session/uploadFileBinary",
      "/api/fileUploads/upload",
      "/api/session/create/other",
      "/api/session/fork",
      "/api/session/forkTo/other",
      "/api/session/forkTo?host=other",
      "/api/workspace/create/other",
      "/api/workspace/resolveByPath?host=other",
      "/api/agentPresets/select",
      "/private",
    ]) {
      await expect(
        access.run(1, {
          type: "fetch",
          ownerId,
          requestId: randomUUID(),
          url: record.origin + path,
          method: "POST",
          body: "{}",
          headers: {},
        }),
      ).rejects.toMatchObject({ code: "invalid-origin" });
    }
    expect(transport.fetch).not.toHaveBeenCalled();
    for (const path of [
      "/api/session/list",
      "/api/connection/discovery",
      "/api/session/page",
      "/api/session/historyDetail",
      "/api/session/attachment",
      "/api/session/create",
      "/api/agentPresets/list",
      "/api/workspace/create",
      "/api/workspace/resolveByPath",
      "/api/session/search",
      "/api/session/forkTo",
    ]) {
      await access.run(1, {
        type: "fetch",
        ownerId,
        requestId: randomUUID(),
        url: record.origin + path,
        method: "POST",
        body: "{}",
        headers: {},
      });
    }
    expect(transport.fetch).toHaveBeenCalledTimes(11);
  });
  it("cancels an owner waiting for protected storage without creating a transport", async () => {
    const { access, store } = fixture();
    const pending = deferred<StoredDshHost | null>();
    vi.mocked(store.load).mockReturnValueOnce(pending.promise);
    const ownerId = randomUUID();
    const opening = access.run(1, { type: "open", ownerId, hostId: record.grant.hostId });
    const rejected = expect(opening).rejects.toMatchObject({ code: "request-cancelled" });
    const closing = access.closeWindow(1);
    pending.resolve(record);
    await closing;
    await rejected;
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("waits for every host connection to close before forgetting and prevents reopening", async () => {
    const { access, store, transport } = fixture();
    const closed = deferred<void>();
    transport.dispose.mockReturnValue(closed.promise);
    for (const windowId of [1, 2])
      await access.run(windowId, {
        type: "open",
        ownerId: randomUUID(),
        hostId: record.grant.hostId,
      });
    const forgetting = access.run(1, { type: "forget", hostId: record.grant.hostId });
    await expect(
      access.run(3, { type: "open", ownerId: randomUUID(), hostId: record.grant.hostId }),
    ).rejects.toMatchObject({ code: "not-paired" });
    expect(store.forget).not.toHaveBeenCalled();
    closed.resolve();
    await forgetting;
    expect(transport.dispose).toHaveBeenCalledTimes(2);
    expect(store.forget).toHaveBeenCalledWith(record.grant.hostId);
  });
  it("saves a granted credential before returning only its descriptor", async () => {
    const { access, store } = fixture(null);
    mock.claim.mockResolvedValue({ ok: true, value: record.grant });
    const result = await access.run(1, pair());
    expect(store.save).toHaveBeenCalledWith(record);
    expect(result).toEqual({
      hostId: record.grant.hostId,
      origin: record.origin,
      label: "Desktop",
    });
  });
  it("does not retry a claim after an unknown enrollment outcome", async () => {
    const { access, store, transport } = fixture(null);
    mock.claim.mockRejectedValue(new Error(record.grant.credential));
    await expect(access.run(1, pair())).rejects.toMatchObject({
      code: "enrollment-outcome-unknown",
    });
    expect(mock.claim).toHaveBeenCalledOnce();
    expect(store.save).not.toHaveBeenCalled();
    expect(transport.dispose).toHaveBeenCalledOnce();
  });
  it("forgets a successful claim that finishes after cancellation without retaining its grant", async () => {
    const { access, store } = fixture(null);
    const result = deferred<{ ok: true; value: typeof record.grant }>();
    const started = deferred<void>();
    mock.claim.mockImplementation(() => {
      started.resolve();
      return result.promise;
    });
    const claiming = access.run(1, pair());
    await started.promise;
    const forgetting = access.run(1, { type: "forget", hostId: record.grant.hostId });
    expect(mock.claim.mock.calls[0][0].signal.aborted).toBe(true);
    result.resolve({ ok: true, value: record.grant });
    await claiming;
    await forgetting;
    expect(await store.load(record.grant.hostId)).toBeNull();
  });
});
