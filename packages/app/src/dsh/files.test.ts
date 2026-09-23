import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionId } from "@deepseek-ai/dsh-client";
import {
  DSH_PROMPT_FILE_LIMITS,
  DshFileUploads,
  prepareDshPromptFile,
  validateDshFileUploadValue,
} from "./files";

type Upload = Context["remote"]["fileUploads"]["upload"];
type Result = Awaited<ReturnType<Upload>>;
const sessionId = brandString<SessionId>("file-session");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function receipt(bytes = 1, name = "file.txt") {
  return {
    receiptId: "7ab06782-f7f6-4ad4-b6c2-adea977d31c1",
    file: { attachmentId: `sha256:${"a".repeat(64)}`, bytes, name },
  };
}
function success(): Result {
  const value = validateDshFileUploadValue(receipt(), 1);
  if (value === undefined) throw new Error("Invalid test receipt");
  return { ok: true, value };
}

describe("bounded canonical generic-file admission", () => {
  it.each(["", "YQ==", "YWI=", "YWJj", "/w==", "//8="])(
    "admits canonical bytes including empty: %s",
    (data) => {
      const result = prepareDshPromptFile({ data }, 0, 0);
      expect(result?.request).toEqual({ data });
      expect(result?.metadata.bytes).toBe(Buffer.from(data, "base64").length);
      expect(Object.isFrozen(result?.metadata)).toBe(true);
    },
  );
  it.each(["YQ", "YQ=", "YR==", "YWJ=", "YQ==\n", " YQ==", "Y===", "====", "_w==", "YQ==YQ=="])(
    "rejects noncanonical base64 without decoding: %s",
    (data) => {
      expect(prepareDshPromptFile({ data }, 0, 0)).toBeUndefined();
    },
  );
  it("checks four-file and aggregate budgets including empty files", () => {
    expect(prepareDshPromptFile({ data: "" }, 3, 8 * 1024 * 1024)).toBeDefined();
    expect(prepareDshPromptFile({ data: "" }, 4, 0)).toBeUndefined();
    expect(prepareDshPromptFile({ data: "YQ==" }, 1, 8 * 1024 * 1024)).toBeUndefined();
    const max = Buffer.alloc(DSH_PROMPT_FILE_LIMITS.maxFileBytes).toString("base64");
    expect(prepareDshPromptFile({ data: max }, 0, 0)?.metadata.bytes).toBe(8 * 1024 * 1024);
    expect(prepareDshPromptFile({ data: max }, 1, 1)).toBeUndefined();
    expect(prepareDshPromptFile({ data: max + "AAAA" }, 0, 0)).toBeUndefined();
  });
  it("bounds UTF-8 names but lets the Host sanitize submitted path-like names", () => {
    expect(prepareDshPromptFile({ data: "", name: "é".repeat(127) + "a" }, 0, 0)).toBeDefined();
    expect(prepareDshPromptFile({ data: "", name: "é".repeat(128) }, 0, 0)).toBeUndefined();
    expect(prepareDshPromptFile({ data: "", name: "a".repeat(256) }, 0, 0)).toBeUndefined();
    expect(prepareDshPromptFile({ data: "", name: "C:\\private\\a.txt" }, 0, 0)?.request.name).toBe(
      "C:\\private\\a.txt",
    );
  });
  it.each([
    "../name",
    "name/child",
    "name\\child",
    "",
    ".",
    "..",
    "name.",
    " name",
    "name ",
    "NUL.txt",
    "con .txt",
    "a:b",
    "a\u0000b",
  ])("rejects unsafe returned names: %s", (name) => {
    expect(validateDshFileUploadValue(receipt(1, name), 1)).toBeUndefined();
  });
  it("admits sanitized renamed and empty file metadata, not merely echoed inputs", () => {
    expect(validateDshFileUploadValue(receipt(0, "_NUL.txt"), 0)).toBeDefined();
    expect(validateDshFileUploadValue(receipt(1, "é.txt"), 1)).toBeDefined();
    expect(validateDshFileUploadValue(receipt(1, "name.txt"), 2)).toBeUndefined();
    expect(validateDshFileUploadValue(receipt(-1), -1)).toBeUndefined();
  });
  it.each([
    "not-uuid",
    "7ab06782-f7f6-1ad4-b6c2-adea977d31c1",
    "7ab06782-f7f6-4ad4-76c2-adea977d31c1",
  ])("rejects malformed receipt identity: %s", (receiptId) => {
    expect(validateDshFileUploadValue({ ...receipt(), receiptId }, 1)).toBeUndefined();
  });
  it("rejects malformed object, digest and byte metadata", () => {
    for (const value of [
      null,
      {},
      { receiptId: receipt().receiptId },
      { ...receipt(), file: { ...receipt().file, bytes: 1.5 } },
      { ...receipt(), file: { ...receipt().file, attachmentId: "sha256:invalid" } },
    ]) {
      expect(validateDshFileUploadValue(value, 1)).toBeUndefined();
    }
  });
});

describe("Host-owned physical upload gate", () => {
  it("reserves before synchronous carrier reentrancy and releases only after actual settlement", async () => {
    const held = deferred<Result>();
    let reentrant: ReturnType<DshFileUploads["start"]> | undefined;
    const remote = {
      upload: vi.fn<Upload>(() => {
        reentrant = gate.start(sessionId, { data: "Yg==" });
        return held.promise;
      }),
    };
    const gate = new DshFileUploads(remote);
    const operation = gate.start(sessionId, { data: "YQ==" });
    expect(operation).not.toBeNull();
    expect(reentrant).toBeNull();
    operation!.abort();
    expect(remote.upload.mock.calls[0]![2]!.aborted).toBe(true);
    expect(gate.start(sessionId, { data: "Yg==" })).toBeNull();
    held.resolve(success());
    await operation!.result;
    remote.upload.mockResolvedValue(success());
    const next = gate.start(sessionId, { data: "Yg==" });
    expect(next).not.toBeNull();
    await next!.result;
    await gate.close();
  });
  it("joins an abort-ignoring carrier on idempotent close and refuses further operations", async () => {
    const held = deferred<Result>();
    const remote = { upload: vi.fn<Upload>(() => held.promise) };
    const gate = new DshFileUploads(remote);
    const operation = gate.start(sessionId, { data: "YQ==" });
    const closing = gate.close();
    expect(gate.close()).toBe(closing);
    expect(gate.start(sessionId, { data: "Yg==" })).toBeNull();
    expect(remote.upload.mock.calls[0]![2]!.aborted).toBe(true);
    let closed = false;
    void closing.then(() => {
      closed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    held.resolve(success());
    await closing;
    expect(closed).toBe(true);
    await operation!.result;
  });
  it("turns synchronous carrier exceptions into joined settlement without leaking the gate", async () => {
    const remote = {
      upload: vi.fn<Upload>(() => {
        throw new Error("transport failed");
      }),
    };
    const gate = new DshFileUploads(remote);
    const operation = gate.start(sessionId, { data: "YQ==" });
    await expect(operation!.result).rejects.toThrow("transport failed");
    remote.upload.mockResolvedValue(success());
    const next = gate.start(sessionId, { data: "YQ==" });
    await expect(next!.result).resolves.toMatchObject({ ok: true });
    await gate.close();
  });
});
