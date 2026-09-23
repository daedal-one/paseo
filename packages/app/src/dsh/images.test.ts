import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import {
  selectRemoteCapabilities,
  type ConnectionHandle,
  type ConnectionHostId,
  type HostCapabilities,
  type SessionId,
} from "@deepseek-ai/dsh-client";
import { dshImageEndpoints } from "@getpaseo/protocol/dsh-access";
import { DshImageReads, DshImages, type ImageAttachmentRef } from "./images";

type AttachmentRead = Context["remote"]["session"]["attachment"];
type ReadResult = Awaited<ReturnType<AttachmentRead>>;
type Generation = ReturnType<ConnectionHandle["generation"]["getSnapshot"]>;
const sessionId = brandString<SessionId>("image-session");
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const ref: ImageAttachmentRef = {
  attachmentId: brandString<ImageAttachmentRef["attachmentId"]>("sha256:fixture-image"),
  name: "clicked.png",
  mediaType: "image/png",
  width: 1,
  height: 1,
  bytes: Buffer.from(PNG, "base64").byteLength,
};
const identity = {
  version: 1 as const,
  hostId: brandString<ConnectionHostId>("d8d58893-7978-42cb-a6db-a3b275b7b46b"),
  activationId: brandString<HostCapabilities["identity"]["activationId"]>(
    "d3d17c83-0ca7-4f45-8f5e-68b8aa0cf23c",
  ),
};
function success(attachment = ref, data = PNG): ReadResult {
  return { ok: true, value: { attachment, data } };
}
const cleanups = new Set<() => void>();
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.clear();
});
function fixture() {
  let generation: Generation = { id: 1, host: { home: "/fixture", identity } };
  let capabilities: HostCapabilities | undefined = {
    version: 3,
    identity,
    capabilities: selectRemoteCapabilities(dshImageEndpoints).map((value) => ({
      endpoint: value.endpoint,
      mode: value.mode,
      wireFingerprint: value.wireFingerprint,
      semanticRevision: value.semanticRevision,
      availability: "available",
    })),
  };
  const listeners = new Set<() => void>();
  const reader = { attachment: vi.fn<AttachmentRead>(async () => success()) };
  const reads = new DshImageReads(reader);
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
  const owners = new Set<DshImages>();
  function createView(id = sessionId) {
    const images = new DshImages(id, reads, connection, () => capabilities);
    owners.add(images);
    return images;
  }
  const images = createView();
  cleanups.add(() => {
    for (const owner of owners) owner.dispose();
    reads.close();
  });
  return {
    reader,
    reads,
    images,
    listeners,
    createView,
    capabilities: () => capabilities!,
    publish(connected: boolean, changed: HostCapabilities | undefined = capabilities) {
      capabilities = changed;
      generation = connected
        ? { id: (generation?.id ?? 0) + 1, host: { home: "/fixture", identity } }
        : undefined;
      for (const listener of listeners) listener();
    },
  };
}

function ready(images: DshImages) {
  const preview = images.getSnapshot().preview;
  expect(preview.status).toBe("ready");
  if (preview.status !== "ready") throw new Error("Expected a ready preview");
  return preview;
}

describe("native optional image reads", () => {
  it.each(["missing", "unavailable", "mode", "wire", "semantic", "context"] as const)(
    "requires exact optional capability metadata: %s",
    async (kind) => {
      const f = fixture();
      const base = f.capabilities();
      const capability = base.capabilities[0]!;
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
      f.publish(true, { ...base, capabilities: changed === undefined ? [] : [changed] });
      expect(f.images.getSnapshot().availability).toBe(
        kind === "context" ? "available" : "unavailable",
      );
      await f.images.load(ref);
      expect(f.reader.attachment).toHaveBeenCalledTimes(kind === "context" ? 1 : 0);
    },
  );

  it("does not read on construction, subscription, hide, disconnect or reconnect", async () => {
    const f = fixture();
    const listener = vi.fn();
    const unsubscribe = f.images.subscribe(listener);
    expect(f.images.getSnapshot()).toEqual({
      availability: "available",
      busy: false,
      preview: { status: "idle" },
    });
    f.images.hide();
    f.publish(false);
    expect(f.images.getSnapshot().availability).toBe("offline");
    await f.images.load(ref);
    f.publish(true);
    expect(f.images.getSnapshot().availability).toBe("available");
    expect(f.reader.attachment).not.toHaveBeenCalled();
    unsubscribe();
    f.images.dispose();
    expect(f.listeners.size).toBe(0);
  });

  it("uses only the generated request, retains the clicked occurrence name, and explicitly hides", async () => {
    const f = fixture();
    f.reader.attachment.mockResolvedValue(success({ ...ref, name: "another-occurrence.png" }));
    await f.images.load(ref);
    expect(f.reader.attachment.mock.calls).toEqual([
      [{ sessionId, attachmentId: ref.attachmentId }],
    ]);
    expect(ready(f.images)).toEqual({
      status: "ready",
      id: ref.attachmentId,
      ref,
      owner: ref,
      sequence: expect.any(Number),
      uri: `data:image/png;base64,${PNG}`,
    });
    f.images.hide();
    expect(f.images.getSnapshot().preview).toEqual({ status: "idle" });
    expect(f.reads.getSnapshot().busy).toBe(false);
  });

  it.each([
    { width: 0 },
    { height: -1 },
    { width: 1.5 },
    { height: Number.NaN },
    { width: Number.POSITIVE_INFINITY },
    { bytes: 0 },
    { bytes: 1.5 },
    { bytes: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid positive-integer metadata before RPC: %j", async (change) => {
    const f = fixture();
    await f.images.load({ ...ref, ...change });
    expect(f.images.getSnapshot().preview.status).toBe("failed");
    expect(f.reader.attachment).not.toHaveBeenCalled();
  });

  it.each([
    { width: 4097 },
    { height: 4097 },
    { width: 2049, height: 2048 },
    { bytes: 8 * 1024 * 1024 + 1 },
  ])("rejects preview limits before RPC: %j", async (change) => {
    const f = fixture();
    await f.images.load({ ...ref, ...change });
    expect(f.images.getSnapshot().preview.status).toBe("too-large");
    expect(f.reader.attachment).not.toHaveBeenCalled();
  });

  it("rejects unsupported runtime media metadata before RPC", async () => {
    const f = fixture();
    const invalid = { ...ref };
    Object.defineProperty(invalid, "mediaType", { value: "image/svg+xml" });
    await f.images.load(invalid);
    expect(f.images.getSnapshot().preview.status).toBe("failed");
    expect(f.reader.attachment).not.toHaveBeenCalled();
  });

  it.each([
    { attachmentId: brandString<ImageAttachmentRef["attachmentId"]>("sha256:other") },
    { mediaType: "image/jpeg" as const },
    { width: 2 },
    { height: 2 },
    { bytes: ref.bytes + 1 },
  ])("rejects response identity or intrinsic metadata mismatch: %j", async (change) => {
    const f = fixture();
    f.reader.attachment.mockResolvedValue(success({ ...ref, ...change }));
    await f.images.load(ref);
    expect(f.images.getSnapshot().preview.status).toBe("failed");
  });

  it.each([
    "",
    `${PNG}\n`,
    PNG.slice(0, -1),
    `${PNG}=`,
    PNG.replace("II=", "IJ="),
    PNG.replace("iVB", "i_B"),
    PNG.replace("iVB", "i-B"),
    PNG.replace("iVB", "i=B"),
    PNG.replace("iVB", "i B"),
    "====",
    "A===",
    "iVBORw0KGgo=",
    "A".repeat(PNG.length - 1) + "=",
  ])("rejects malformed, noncanonical, size-mismatched or non-image base64: %s", async (data) => {
    const f = fixture();
    f.reader.attachment.mockResolvedValue(success(ref, data));
    await f.images.load(ref);
    expect(f.images.getSnapshot().preview.status).toBe("failed");
    expect(f.reads.getSnapshot().busy).toBe(false);
  });

  it("checks double-padding trailing bits and the padding-aware decoded byte count", async () => {
    const f = fixture();
    const gif = { ...ref, mediaType: "image/gif" as const, bytes: 4 };
    f.reader.attachment.mockResolvedValueOnce(success(gif, "R0lGOB=="));
    await f.images.load(gif);
    expect(f.images.getSnapshot().preview.status).toBe("failed");
    f.reader.attachment.mockResolvedValueOnce(success(gif, "R0lGOA=="));
    await f.images.load(gif);
    expect(ready(f.images).uri).toBe("data:image/gif;base64,R0lGOA==");
  });

  it("requires the byte signature to agree with the admitted MIME", async () => {
    const f = fixture();
    const jpeg = { ...ref, mediaType: "image/jpeg" as const };
    f.reader.attachment.mockResolvedValue(success(jpeg));
    await f.images.load(jpeg);
    expect(f.images.getSnapshot().preview.status).toBe("failed");
  });

  it.each([0, 4])(
    "bounds encoded length and exact decoded bytes before decoding (%s)",
    async (extra) => {
      const f = fixture();
      const data = "A".repeat(Math.ceil((8 * 1024 * 1024) / 3) * 4 + extra);
      f.reader.attachment.mockResolvedValue(success(ref, data));
      await f.images.load(ref);
      expect(f.images.getSnapshot().preview.status).toBe("too-large");
    },
  );

  it("coalesces repeated pending clicks and publishes physical busy to every owner", async () => {
    const f = fixture();
    const second = f.createView(brandString<SessionId>("second-session"));
    const deferred = Promise.withResolvers<ReadResult>();
    f.reader.attachment.mockReturnValueOnce(deferred.promise);
    const pending = f.images.load(ref);
    expect(f.images.load(ref)).toBe(pending);
    expect(f.images.getSnapshot().preview.status).toBe("loading");
    expect(second.getSnapshot().busy).toBe(true);
    await second.load(ref);
    expect(second.getSnapshot().preview.status).toBe("busy");
    expect(f.reader.attachment).toHaveBeenCalledTimes(1);
    deferred.resolve(success());
    await pending;
    expect(second.getSnapshot().busy).toBe(false);
    expect(second.getSnapshot().preview.status).toBe("busy");
    expect(f.reader.attachment).toHaveBeenCalledTimes(1);
    await second.load(ref);
    expect(ready(second).ref).toBe(ref);
    expect(f.reader.attachment).toHaveBeenLastCalledWith({
      sessionId: brandString<SessionId>("second-session"),
      attachmentId: ref.attachmentId,
    });
  });

  it.each(["hide", "generation", "dispose"] as const)(
    "%s fences late success without releasing the shared physical slot",
    async (action) => {
      const f = fixture();
      const deferred = Promise.withResolvers<ReadResult>();
      f.reader.attachment.mockReturnValueOnce(deferred.promise);
      const pending = f.images.load(ref);
      const published = vi.fn();
      f.images.subscribe(published);
      if (action === "hide") f.images.hide();
      else if (action === "generation") f.publish(true);
      else expect(f.images.dispose()).toBeUndefined();
      expect(f.images.getSnapshot().preview).toEqual({ status: "idle" });
      expect(f.reads.getSnapshot().busy).toBe(true);
      const next = f.createView();
      await next.load(ref);
      expect(next.getSnapshot()).toMatchObject({ busy: true, preview: { status: "busy" } });
      expect(f.reader.attachment).toHaveBeenCalledTimes(1);
      published.mockClear();
      deferred.resolve(success());
      await pending;
      expect(f.images.getSnapshot().preview).toEqual({ status: "idle" });
      expect(next.getSnapshot().busy).toBe(false);
      if (action === "dispose") expect(published).not.toHaveBeenCalled();
      await next.load(ref);
      expect(ready(next).ref).toBe(ref);
    },
  );

  it("a disposed owner's late error releases the slot but cannot clobber new readiness", async () => {
    const f = fixture();
    const deferred = Promise.withResolvers<ReadResult>();
    f.reader.attachment.mockReturnValueOnce(deferred.promise);
    const old = f.images.load(ref);
    f.images.dispose();
    const next = f.createView();
    deferred.reject(new Error("late transport failure"));
    await old;
    expect(next.getSnapshot()).toMatchObject({ busy: false, preview: { status: "idle" } });
    await next.load(ref);
    const current = ready(next);
    await old;
    expect(next.getSnapshot().preview).toBe(current);
    expect(f.reader.attachment).toHaveBeenCalledTimes(2);
  });

  it("fences an old error even when a new read starts immediately on physical release", async () => {
    const f = fixture();
    const deferred = Promise.withResolvers<ReadResult>();
    f.reader.attachment.mockReturnValueOnce(deferred.promise);
    const old = f.images.load(ref);
    f.images.hide();
    let replacement = Promise.resolve();
    const unsubscribe = f.reads.subscribe(() => {
      if (f.reads.getSnapshot().busy) return;
      unsubscribe();
      replacement = f.images.load(ref);
    });
    deferred.reject(new Error("old"));
    await old;
    await replacement;
    expect(ready(f.images).ref).toBe(ref);
    expect(f.reader.attachment).toHaveBeenCalledTimes(2);
  });

  it("closes synchronously without joining or clearing a physical read, and forbids new calls", async () => {
    const f = fixture();
    const deferred = Promise.withResolvers<ReadResult>();
    f.reader.attachment.mockReturnValueOnce(deferred.promise);
    const pending = f.images.load(ref);
    expect(f.reads.close()).toBeUndefined();
    expect(f.reads.getSnapshot()).toEqual({ busy: true, closed: true });
    expect(f.images.getSnapshot().preview).toEqual({ status: "idle" });
    const next = f.createView();
    await next.load(ref);
    deferred.resolve(success());
    await pending;
    await f.images.load(ref);
    expect(f.reads.getSnapshot()).toEqual({ busy: false, closed: true });
    expect(f.images.getSnapshot().preview).toEqual({ status: "idle" });
    expect(f.reader.attachment).toHaveBeenCalledTimes(1);
  });

  it("fences decoded-image errors by exact ready identity, including same-ID reloads", async () => {
    const f = fixture();
    await f.images.load(ref);
    const old = ready(f.images);
    f.images.hide();
    await f.images.load(ref);
    const current = ready(f.images);
    expect(current.sequence).not.toBe(old.sequence);
    f.images.decodeFailed(old);
    expect(f.images.getSnapshot().preview).toBe(current);
    f.images.decodeFailed(current);
    expect(f.images.getSnapshot().preview).toEqual({
      status: "failed",
      id: ref.attachmentId,
      ref,
      owner: ref,
    });
    await f.images.load(ref);
    expect(ready(f.images).sequence).toBeGreaterThan(current.sequence);
    f.publish(true);
    f.images.decodeFailed(current);
    expect(f.images.getSnapshot().preview).toEqual({ status: "idle" });
  });

  it("distinguishes mounted occurrences sharing one ref and fences stale owner cleanup", async () => {
    const f = fixture();
    const firstOwner = {};
    const secondOwner = {};
    await f.images.load(ref, firstOwner);
    const first = ready(f.images);
    expect(first.owner).toBe(firstOwner);
    await f.images.load(ref, secondOwner);
    const second = ready(f.images);
    expect(second.owner).toBe(secondOwner);
    expect(second.sequence).not.toBe(first.sequence);
    f.images.hide(firstOwner);
    f.images.decodeFailed(first);
    expect(f.images.getSnapshot().preview).toBe(second);
    f.images.hide(secondOwner);
    expect(f.images.getSnapshot().preview).toEqual({ status: "idle" });
  });

  it("coalesces one occurrence's cloned pending ref without transferring ownership", async () => {
    const f = fixture();
    const owner = {};
    const deferred = Promise.withResolvers<ReadResult>();
    f.reader.attachment.mockReturnValueOnce(deferred.promise);
    const pending = f.images.load(ref, owner);
    expect(f.images.load({ ...ref }, owner)).toBe(pending);
    f.images.hide({});
    expect(f.images.getSnapshot().preview.status).toBe("loading");
    expect(f.reader.attachment).toHaveBeenCalledTimes(1);
    deferred.resolve(success());
    await pending;
    expect(ready(f.images).owner).toBe(owner);
  });

  it("assigns distinct render keys across replacement view owners", async () => {
    const f = fixture();
    await f.images.load(ref);
    const first = ready(f.images);
    f.images.dispose();
    const replacement = f.createView();
    await replacement.load(ref);
    expect(ready(replacement).sequence).not.toBe(first.sequence);
    f.images.decodeFailed(first);
    expect(replacement.getSnapshot().preview.status).toBe("ready");
  });

  it.each(["rejection", "remote-failure"] as const)(
    "allows only explicit read retry after %s, never reconnect replay",
    async (failure) => {
      const f = fixture();
      if (failure === "rejection") f.reader.attachment.mockRejectedValueOnce(new Error("lost"));
      else
        f.reader.attachment.mockResolvedValueOnce({
          ok: false,
          error: new RemoteError("gateway/internal", "private detail", {}),
        });
      await f.images.load(ref);
      expect(f.images.getSnapshot().preview.status).toBe("failed");
      expect(f.reads.getSnapshot().busy).toBe(false);
      f.publish(false);
      f.publish(true);
      expect(f.reader.attachment).toHaveBeenCalledTimes(1);
      await f.images.load(ref);
      expect(ready(f.images).ref).toBe(ref);
      expect(f.reader.attachment).toHaveBeenCalledTimes(2);
    },
  );
});
