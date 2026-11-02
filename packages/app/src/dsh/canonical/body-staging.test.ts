import { expect, it, vi } from "vitest";
import {
  CANONICAL_BODY_CHUNK_BYTES,
  type CanonicalRequest,
} from "@getpaseo/protocol/dsh-canonical";
import { stageCanonicalBody } from "./body-staging";
const id = "f3c85362-753e-4893-909c-70ff4ea6399c";
it("transfers more than64MiB with bounded acknowledged chunks and no aggregate allocation", async () => {
  const chunk = new Uint8Array(64 * 1024);
  const count = 1100;
  let produced = 0;
  let received = 0;
  let writes = 0;
  let inFlight = 0;
  let maximum = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (produced === count) {
          controller.close();
          return;
        }
        produced++;
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
  const request = async (value: CanonicalRequest) => {
    if (value.kind === "body-write") {
      inFlight++;
      maximum = Math.max(maximum, inFlight);
      expect(value.sequence).toBe(writes++);
      const size = atob(value.data).length;
      expect(size).toBeLessThanOrEqual(CANONICAL_BODY_CHUNK_BYTES);
      received += size;
      await Promise.resolve();
      inFlight--;
    }
    return null;
  };
  await stageCanonicalBody({ request }, id, stream);
  expect(received).toBe(count * chunk.byteLength);
  expect(received).toBeGreaterThan(64 * 1024 * 1024);
  expect(maximum).toBe(1);
});
it("waits for native acknowledgment before reading another chunk", async () => {
  const acknowledgment = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++;
        if (reads === 1) controller.enqueue(new Uint8Array([1]));
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const request = async (value: CanonicalRequest) => {
    if (value.kind === "body-write") {
      entered.resolve();
      await acknowledgment.promise;
    }
    return null;
  };
  const pending = stageCanonicalBody({ request }, id, stream);
  await entered.promise;
  expect(reads).toBe(1);
  acknowledgment.resolve();
  await pending;
  expect(reads).toBe(2);
});
it("cancels a held source before EOF and retires staging once", async () => {
  const reading = Promise.withResolvers<void>();
  const cancel = vi.fn();
  const calls: string[] = [];
  const stream = new ReadableStream<Uint8Array>(
    {
      pull() {
        reading.resolve();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const controller = new AbortController();
  const pending = stageCanonicalBody(
    {
      request: async (value) => {
        calls.push(value.kind);
        return null;
      },
    },
    id,
    stream,
    controller.signal,
  );
  await reading.promise;
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce();
  expect(calls).toEqual(["body-open", "body-discard"]);
  expect(stream.locked).toBe(false);
});
it("discards a sealed stage when cancellation races its acknowledgment", async () => {
  const entered = Promise.withResolvers<void>();
  const sealed = Promise.withResolvers<void>();
  const controller = new AbortController();
  const calls: string[] = [];
  const pending = stageCanonicalBody(
    {
      request: async (value) => {
        calls.push(value.kind);
        if (value.kind === "body-seal") {
          entered.resolve();
          await sealed.promise;
        }
        return null;
      },
    },
    id,
    new ReadableStream({
      start(stream) {
        stream.close();
      },
    }),
    controller.signal,
  );
  await entered.promise;
  controller.abort();
  sealed.resolve();
  await expect(pending).rejects.toThrow();
  expect(calls).toEqual(["body-open", "body-seal", "body-discard"]);
});
