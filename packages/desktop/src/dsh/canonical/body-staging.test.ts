import { expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import { CanonicalBodyStaging } from "./body-staging";
it("seals one private file, consumes it once, and removes it after request retirement", async () => {
  const staging = new CanonicalBodyStaging();
  try {
    await staging.open("body");
    await staging.write("body", 0, "YQ==");
    await staging.write("body", 1, "Yg==");
    await staging.seal("body");
    const stage = staging.take("body");
    const path = stage.path();
    expect(await readFile(path, "utf8")).toBe("ab");
    expect(() => staging.take("body")).toThrow();
    await stage.dispose();
    await expect(access(path)).rejects.toThrow();
  } finally {
    await staging.dispose();
  }
});
it("refuses out-of-order or malformed chunks and deletes failed staging", async () => {
  const staging = new CanonicalBodyStaging();
  try {
    await staging.open("body");
    await expect(staging.write("body", 1, "YQ==")).rejects.toThrow();
    await staging.discard("body");
    await staging.open("body");
    await expect(staging.write("body", 0, "%%%")).rejects.toThrow();
    await staging.discard("body");
    expect(() => staging.take("body")).toThrow();
  } finally {
    await staging.dispose();
  }
});
it("joins and removes staging even when disposal races native file creation", async () => {
  const staging = new CanonicalBodyStaging();
  const opening = staging.open("body");
  const closing = staging.dispose();
  await expect(opening).rejects.toThrow("cancelled");
  await closing;
  await expect(staging.open("new")).rejects.toThrow();
});
