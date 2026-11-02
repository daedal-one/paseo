import {
  CANONICAL_BODY_CHUNK_BYTES,
  type CanonicalRequest,
} from "@getpaseo/protocol/dsh-canonical";

export interface CanonicalBodyBridge {
  request(request: CanonicalRequest): Promise<unknown>;
}
function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
/** One acknowledged chunk at a time; cancellation retires the reader and native staging identity. */
export async function stageCanonicalBody(
  bridge: CanonicalBodyBridge,
  id: string,
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal | null,
): Promise<void> {
  const reader = body.getReader();
  let cancellation: Promise<unknown> | undefined;
  let discarded: Promise<unknown> | undefined;
  const discard = () => (discarded ??= bridge.request({ kind: "body-discard", id }));
  const abort = () => {
    cancellation ??= reader.cancel(signal?.reason);
    void cancellation.catch(() => {});
    void discard().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    await bridge.request({ kind: "body-open", id });
    signal?.throwIfAborted();
    let sequence = 0;
    while (true) {
      const item = await reader.read();
      signal?.throwIfAborted();
      if (item.done) break;
      for (let offset = 0; offset < item.value.byteLength; offset += CANONICAL_BODY_CHUNK_BYTES) {
        signal?.throwIfAborted();
        await bridge.request({
          kind: "body-write",
          id,
          sequence,
          data: encode(item.value.subarray(offset, offset + CANONICAL_BODY_CHUNK_BYTES)),
        });
        sequence++;
      }
    }
    signal?.throwIfAborted();
    await bridge.request({ kind: "body-seal", id });
    signal?.throwIfAborted();
  } catch (error) {
    cancellation ??= reader.cancel(error);
    await Promise.allSettled([cancellation, discard()]);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
