import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentPickerAsset, DocumentPickerResult } from "expo-document-picker";
import { disposePromptFileSources, pickPromptFiles } from "./prompt-files";

const fixture = vi.hoisted(() => ({
  platform: { OS: "web" },
  picker: vi.fn<() => Promise<DocumentPickerResult>>(),
  read: vi.fn<() => Promise<string>>(),
  deleted: [] as string[],
  exists: true,
  size: 3,
}));
vi.mock("react-native", () => ({ Platform: fixture.platform }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: fixture.picker }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///private/cache/" } },
  File: class {
    constructor(private readonly uri: string) {}
    get exists() {
      return fixture.exists;
    }
    get size() {
      return fixture.size;
    }
    base64() {
      return fixture.read();
    }
    delete() {
      fixture.deleted.push(this.uri);
    }
  },
}));

function asset(file: File): DocumentPickerAsset {
  return { name: file.name, size: file.size, uri: "blob:picker-owned", file, lastModified: 0 };
}
function select(assets: DocumentPickerAsset[]) {
  fixture.picker.mockResolvedValue({ canceled: false, assets });
}
const nativeAsset: DocumentPickerAsset = {
  name: "native.bin",
  size: 3,
  uri: "file:///private/cache/DocumentPicker/copy.bin",
  lastModified: 0,
};
beforeEach(() => {
  fixture.platform.OS = "web";
  fixture.picker.mockReset();
  fixture.read.mockReset().mockResolvedValue("YWJj");
  fixture.deleted.length = 0;
  fixture.exists = true;
  fixture.size = 3;
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("metadata-only generic file picker", () => {
  it("opens synchronously, reads nothing at selection, and encodes bounded chunks only at Send", async () => {
    const bytes = Uint8Array.from({ length: 32770 }, (_, index) => index % 256);
    const file = new File([bytes], "binary.bin");
    const read = vi.spyOn(file, "arrayBuffer");
    select([asset(file)]);
    const pending = pickPromptFiles();
    expect(fixture.picker).toHaveBeenCalledWith({
      type: "*/*",
      multiple: true,
      base64: false,
      copyToCacheDirectory: false,
    });
    expect(read).not.toHaveBeenCalled();
    const sources = await pending;
    expect(read).not.toHaveBeenCalled();
    expect(sources[0]).toMatchObject({ name: "binary.bin", bytes: 32770 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picker-owned");
    expect(await sources[0]!.read(new AbortController().signal)).toBe(
      Buffer.from(bytes).toString("base64"),
    );
    disposePromptFileSources(sources);
    await expect(sources[0]!.read(new AbortController().signal)).rejects.toThrow("discarded");
  });

  it.each([
    "missing-size",
    "fractional-size",
    "negative-size",
    "over-limit",
    "bad-name",
    "name-mismatch",
    "size-mismatch",
    "missing-file",
  ])("rejects the entire %s batch without any reads", async (problem) => {
    const file = new File(["abc"], "valid.bin");
    const read = vi.spyOn(file, "arrayBuffer");
    const good = asset(file);
    const bad = { ...good };
    if (problem === "missing-size") bad.size = undefined;
    if (problem === "fractional-size") bad.size = 1.5;
    if (problem === "negative-size") bad.size = -1;
    if (problem === "over-limit") bad.size = 8 * 1024 * 1024 + 1;
    if (problem === "bad-name") bad.name = "x".repeat(256);
    if (problem === "name-mismatch") bad.name = "different.bin";
    if (problem === "size-mismatch") bad.size = 2;
    if (problem === "missing-file") bad.file = undefined;
    select([good, bad]);
    await expect(pickPromptFiles()).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("checks count and aggregate budgets before reading any file", async () => {
    const file = new File(["abc"], "valid.bin");
    const read = vi.spyOn(file, "arrayBuffer");
    select(Array.from({ length: 5 }, () => asset(file)));
    await expect(pickPromptFiles()).rejects.toThrow();
    select([
      { ...asset(file), size: 5 * 1024 * 1024 },
      { ...asset(file), size: 5 * 1024 * 1024 },
    ]);
    await expect(pickPromptFiles()).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves empty files and treats cancellation/empty results as no selection", async () => {
    fixture.picker.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickPromptFiles()).toEqual([]);
    select([]);
    expect(await pickPromptFiles()).toEqual([]);
    select([asset(new File([], "empty.txt"))]);
    const sources = await pickPromptFiles();
    expect(await sources[0]!.read(new AbortController().signal)).toBe("");
    disposePromptFileSources(sources);
  });

  it("reads native owned copies only at Send and defers idempotent deletion until the read settles", async () => {
    fixture.platform.OS = "ios";
    select([nativeAsset]);
    const sources = await pickPromptFiles();
    expect(fixture.picker).toHaveBeenCalledWith({
      type: "*/*",
      multiple: true,
      base64: false,
      copyToCacheDirectory: true,
    });
    expect(fixture.read).not.toHaveBeenCalled();
    let resolve: (value: string) => void = () => {};
    fixture.read.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = sources[0]!.read(new AbortController().signal);
    const refused = expect(pending).rejects.toThrow("discarded");
    disposePromptFileSources(sources);
    disposePromptFileSources(sources);
    expect(fixture.deleted).toEqual([]);
    resolve("YWJj");
    await refused;
    expect(fixture.deleted).toEqual([nativeAsset.uri]);
  });

  it.each([
    "content://provider/original",
    "https://example.test/document",
    "file:///private/original.bin",
    "file:///private/cache/DocumentPicker/%2e%2e%2foriginal",
  ])("never reads or deletes unowned URI %s", async (uri) => {
    fixture.platform.OS = "android";
    select([nativeAsset, { ...nativeAsset, uri }]);
    await expect(pickPromptFiles()).rejects.toThrow();
    expect(fixture.deleted).toEqual([nativeAsset.uri]);
    expect(fixture.read).not.toHaveBeenCalled();
  });

  it("captures native cleanup authority before the original picker asset can mutate", async () => {
    fixture.platform.OS = "ios";
    const mutable = { ...nativeAsset };
    select([mutable]);
    const sources = await pickPromptFiles();
    mutable.uri = "content://provider/original";
    mutable.name = "different.bin";
    mutable.size = 9000;
    expect(await sources[0]!.read(new AbortController().signal)).toBe("YWJj");
    expect(sources[0]).toMatchObject({ name: nativeAsset.name, bytes: 3 });
    disposePromptFileSources(sources);
    expect(fixture.deleted).toEqual([nativeAsset.uri]);
  });

  it("cleans native copies even for an invalid whole batch and rejects changed Send-time size", async () => {
    fixture.platform.OS = "ios";
    select([{ ...nativeAsset, size: undefined }]);
    await expect(pickPromptFiles()).rejects.toThrow();
    expect(fixture.deleted).toEqual([nativeAsset.uri]);
    fixture.deleted.length = 0;
    select([nativeAsset]);
    const sources = await pickPromptFiles();
    fixture.size = 4;
    await expect(sources[0]!.read(new AbortController().signal)).rejects.toThrow("size changed");
    expect(fixture.read).not.toHaveBeenCalled();
    disposePromptFileSources(sources);
    expect(fixture.deleted).toEqual([nativeAsset.uri]);
  });
});
