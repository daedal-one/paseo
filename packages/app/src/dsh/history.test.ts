import { describe, expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import {
  selectRemoteCapabilities,
  HistoryDetailLimitError,
  type ConnectionHandle,
  type ConnectionHostId,
  type HostCapabilities,
  type SessionFace,
} from "@deepseek-ai/dsh-client";
import { dshHistoryEndpoints } from "@getpaseo/protocol/dsh-access";
import { DshHistory } from "./history";

type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
const identity = {
  version: 1 as const,
  hostId: brandString<ConnectionHostId>("d8d58893-7978-42cb-a6db-a3b275b7b46b"),
  activationId: brandString<HostCapabilities["identity"]["activationId"]>(
    "d3d17c83-0ca7-4f45-8f5e-68b8aa0cf23c",
  ),
};
function fixture() {
  let generation: Generation = { id: 1, host: { home: "/fixture", identity } };
  let capabilities: HostCapabilities | undefined = {
    version: 3,
    identity,
    capabilities: selectRemoteCapabilities(dshHistoryEndpoints).map((value) => ({
      endpoint: value.endpoint,
      mode: value.mode,
      wireFingerprint: value.wireFingerprint,
      semanticRevision: value.semanticRevision,
      availability: "available",
    })),
  };
  const listeners = new Set<() => void>();
  const session = {
    loadOlder: vi.fn<SessionFace["loadOlder"]>(async () => {}),
    loadHistoryDetail: vi.fn<SessionFace["loadHistoryDetail"]>(async () => {}),
  };
  const connection = {
    generation: {
      getSnapshot: () => generation,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
  const history = new DshHistory(session, connection, () => capabilities);
  return {
    session,
    history,
    listeners,
    publish(connected: boolean, changed: HostCapabilities | undefined = capabilities) {
      capabilities = changed;
      generation = connected
        ? { id: (generation?.id ?? 0) + 1, host: { home: "/fixture", identity } }
        : undefined;
      for (const listener of listeners) listener();
    },
    capabilities: () => capabilities!,
  };
}

describe("native optional history reads", () => {
  it.each(["missing", "unavailable", "mode", "wire", "semantic", "context"] as const)(
    "gates each operation independently for %s metadata",
    async (kind) => {
      const f = fixture();
      try {
        const base = f.capabilities();
        const capability = base.capabilities.find((value) => value.endpoint === "session/page")!;
        const fields = {
          endpoint: capability.endpoint,
          mode: kind === "mode" ? ("stream" as const) : capability.mode,
          wireFingerprint: kind === "wire" ? "mismatch" : capability.wireFingerprint,
          semanticRevision:
            kind === "semantic"
              ? (capability.semanticRevision ?? 0) + 1
              : capability.semanticRevision,
        };
        let changed: HostCapabilities["capabilities"][number] | undefined;
        if (kind === "missing") changed = undefined;
        else if (kind === "unavailable")
          changed = { ...fields, availability: "unavailable", reason: "service" };
        else
          changed = {
            ...fields,
            availability: kind === "context" ? "context-required" : "available",
          };
        f.publish(true, {
          ...base,
          capabilities: [
            ...base.capabilities.filter((value) => value.endpoint !== "session/page"),
            ...(changed === undefined ? [] : [changed]),
          ],
        });
        expect(f.history.getSnapshot()).toMatchObject({
          older: kind === "context" ? "available" : "unavailable",
          detail: "available",
        });
        await f.history.loadOlder();
        expect(f.session.loadOlder).toHaveBeenCalledTimes(kind === "context" ? 1 : 0);
        await f.history.loadDetail(10);
        expect(f.session.loadHistoryDetail).toHaveBeenCalledOnce();
      } finally {
        await f.history.dispose();
      }
    },
  );

  it("requires explicit reads and clears optional admission while disconnected", async () => {
    const f = fixture();
    try {
      expect(f.history.getSnapshot()).toMatchObject({ older: "available", detail: "available" });
      expect(f.session.loadOlder).not.toHaveBeenCalled();
      expect(f.session.loadHistoryDetail).not.toHaveBeenCalled();
      f.publish(false);
      expect(f.history.getSnapshot()).toMatchObject({ older: "offline", detail: "offline" });
      await Promise.all([f.history.loadOlder(), f.history.loadDetail(1)]);
      f.publish(true);
      expect(f.session.loadOlder).not.toHaveBeenCalled();
      expect(f.session.loadHistoryDetail).not.toHaveBeenCalled();
      f.publish(true, { ...f.capabilities(), capabilities: [] });
      expect(f.history.getSnapshot()).toMatchObject({
        older: "unavailable",
        detail: "unavailable",
      });
    } finally {
      await f.history.dispose();
    }
    expect(f.listeners.size).toBe(0);
  });

  it.each(["success", "failure"] as const)(
    "cancels coalesced generation reads and ignores their late %s",
    async (result) => {
      const f = fixture();
      const page = Promise.withResolvers<void>();
      const detail = Promise.withResolvers<void>();
      const fresh = Promise.withResolvers<void>();
      f.session.loadOlder.mockImplementation(() => page.promise);
      f.session.loadHistoryDetail.mockImplementation(() => detail.promise);
      try {
        const older = f.history.loadOlder();
        const first = f.history.loadDetail(12);
        expect(f.history.loadOlder()).toBe(older);
        expect(f.history.loadDetail(12)).toBe(first);
        expect(f.history.getSnapshot().details.get(12)).toBe("loading");
        await Promise.resolve();
        const signal = f.session.loadHistoryDetail.mock.calls[0]?.[1];
        expect(signal).toBe(f.session.loadOlder.mock.calls[0]?.[0]);
        f.publish(false);
        expect(signal?.aborted).toBe(true);
        expect(f.history.getSnapshot().details.size).toBe(0);
        f.publish(true);
        f.session.loadHistoryDetail.mockImplementation(() => fresh.promise);
        const replacement = f.history.loadDetail(12);
        if (result === "success") detail.resolve();
        else detail.reject(new Error("obsolete"));
        page.resolve();
        await Promise.all([older, first]);
        expect(f.history.loadDetail(12)).toBe(replacement);
        expect(f.history.getSnapshot().details.get(12)).toBe("loading");
        fresh.resolve();
        await replacement;
        expect(f.history.getSnapshot().details.size).toBe(0);
      } finally {
        page.resolve();
        detail.resolve();
        fresh.resolve();
        await f.history.dispose();
      }
    },
  );

  it("reports explicit detail failure and allowance rejection without retrying automatically", async () => {
    const f = fixture();
    try {
      f.session.loadHistoryDetail.mockRejectedValueOnce(new Error("lost"));
      await f.history.loadDetail(3);
      expect(f.history.getSnapshot().details.get(3)).toBe("failed");
      expect(f.session.loadHistoryDetail).toHaveBeenCalledTimes(1);
      f.session.loadHistoryDetail.mockRejectedValueOnce(new HistoryDetailLimitError(100, 10));
      await f.history.loadDetail(3);
      expect(f.history.getSnapshot().details.get(3)).toBe("too-large");
      await f.history.loadDetail(3);
      expect(f.history.getSnapshot().details.size).toBe(0);
      expect(f.session.loadHistoryDetail).toHaveBeenCalledTimes(3);
    } finally {
      await f.history.dispose();
    }
  });

  it("joins all canceled generations and suppresses publication after view disposal", async () => {
    const f = fixture();
    const page = Promise.withResolvers<void>();
    const old = Promise.withResolvers<void>();
    const fresh = Promise.withResolvers<void>();
    const published = vi.fn();
    f.history.subscribe(published);
    f.session.loadOlder.mockImplementation(() => page.promise);
    f.session.loadHistoryDetail
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => fresh.promise);
    try {
      const first = f.history.loadDetail(1);
      await Promise.resolve();
      f.publish(false);
      f.publish(true);
      const second = f.history.loadDetail(2);
      const older = f.history.loadOlder();
      await Promise.resolve();
      const closing = f.history.dispose();
      expect(f.session.loadOlder.mock.calls[0]?.[0]?.aborted).toBe(true);
      expect(f.session.loadHistoryDetail.mock.calls.every((call) => call[1]?.aborted)).toBe(true);
      let closed = false;
      void closing.then(() => {
        closed = true;
        return undefined;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      expect(f.listeners.size).toBe(0);
      const count = published.mock.calls.length;
      page.resolve();
      fresh.resolve();
      await Promise.all([older, second]);
      expect(closed).toBe(false);
      old.reject(new Error("closed view"));
      await Promise.all([first, closing]);
      expect(closed).toBe(true);
      expect(published).toHaveBeenCalledTimes(count);
      await Promise.all([f.history.loadOlder(), f.history.loadDetail(3)]);
      expect(f.session.loadHistoryDetail).toHaveBeenCalledTimes(2);
    } finally {
      page.resolve();
      old.resolve();
      fresh.resolve();
      await f.history.dispose();
    }
  });

  it("coalesces a read requested by its loading observer", async () => {
    const f = fixture();
    const detail = Promise.withResolvers<void>();
    let observed: Promise<void> | undefined;
    f.session.loadHistoryDetail.mockImplementation(() => detail.promise);
    f.history.subscribe(() => {
      if (f.history.getSnapshot().details.get(7) === "loading") observed = f.history.loadDetail(7);
    });
    try {
      const requested = f.history.loadDetail(7);
      expect(observed).toBe(requested);
      await Promise.resolve();
      expect(f.session.loadHistoryDetail).toHaveBeenCalledOnce();
      detail.resolve();
      await requested;
    } finally {
      detail.resolve();
      await f.history.dispose();
    }
  });

  it("does not dispatch when a read-state observer closes its view", async () => {
    const f = fixture();
    f.history.subscribe(() => {
      void f.history.dispose();
    });
    await f.history.loadDetail(7);
    expect(f.session.loadHistoryDetail).not.toHaveBeenCalled();
    await f.history.dispose();
  });
});
