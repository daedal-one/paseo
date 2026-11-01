import { expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import {
  selectRemoteCapabilities,
  type ConnectionHandle,
  type ConnectionHostId,
  type HostCapabilities,
} from "@deepseek-ai/dsh-client";
import { InspectionRead } from "./inspection-read";

type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
function fixture() {
  const identity = {
    version: 1 as const,
    hostId: brandString<ConnectionHostId>("d8d58893-7978-42cb-a6db-a3b275b7b46b"),
    activationId: brandString<HostCapabilities["identity"]["activationId"]>(
      "d3d17c83-0ca7-4f45-8f5e-68b8aa0cf23c",
    ),
  };
  let generation: Generation = { id: 1, host: { home: "/fixture", identity } };
  const listeners = new Set<() => void>();
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
  const capabilities: HostCapabilities = {
    version: 3,
    identity,
    capabilities: selectRemoteCapabilities(["sessionInfo/read"]).map((value) => ({
      endpoint: value.endpoint,
      mode: value.mode,
      wireFingerprint: value.wireFingerprint,
      semanticRevision: value.semanticRevision,
      availability: "available",
    })),
  };
  return {
    connection,
    capabilities,
    listeners,
    disconnect() {
      generation = undefined;
      for (const listener of listeners) listener();
    },
  };
}
it("aborts replaced reads and joins late carriers without publishing stale values", async () => {
  const f = fixture();
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  const signals: AbortSignal[] = [];
  const read = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return signals.length === 1 ? first.promise : second.promise;
  });
  const source = new InspectionRead("sessionInfo/read", f.connection, () => f.capabilities, read);
  const pending = source.refresh();
  await Promise.resolve();
  const newer = source.refresh();
  await Promise.resolve();
  expect(signals[0]?.aborted).toBe(true);
  second.resolve("new");
  await newer;
  expect(source.getSnapshot()).toEqual({ status: "ready", value: "new" });
  let disposed = false;
  const closing = source.dispose().then(() => {
    disposed = true;
    return undefined;
  });
  await Promise.resolve();
  expect(disposed).toBe(false);
  first.resolve("old");
  await pending;
  await closing;
  expect(source.getSnapshot()).toEqual({ status: "ready", value: "new" });
  expect(f.listeners.size).toBe(0);
});
it("gates unsupported capabilities and disconnects pending reads", async () => {
  const f = fixture();
  const result = Promise.withResolvers<string>();
  const read = vi.fn(() => result.promise);
  const unavailable = new InspectionRead(
    "sessionInfo/read",
    f.connection,
    () => ({ ...f.capabilities, capabilities: [] }),
    read,
  );
  await unavailable.refresh();
  expect(unavailable.getSnapshot().status).toBe("unavailable");
  expect(read).not.toHaveBeenCalled();
  await unavailable.dispose();
  const source = new InspectionRead("sessionInfo/read", f.connection, () => f.capabilities, read);
  const task = source.refresh();
  await Promise.resolve();
  f.disconnect();
  result.resolve("late");
  await task;
  expect(source.getSnapshot().status).toBe("offline");
  await source.dispose();
});
