import { it, expect } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CanonicalCreationStorage } from "./creation-storage";

it("preserves legacy bytes, commits one competing claim, and retains migration after clearing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canonical-journal-"));
  try {
    const file = join(directory, "creation.sqlite");
    const one = new CanonicalCreationStorage(file);
    const two = new CanonicalCreationStorage(file);
    const legacy = JSON.stringify({ version: 1, outcome: { kind: "unknown" } });
    one.importLegacy("host-a", legacy);
    expect(two.read("host-a")).toBe(legacy);
    expect(one.compareExchange("host-a", legacy, "first")).toBe(true);
    expect(two.compareExchange("host-a", legacy, "second")).toBe(false);
    expect(two.read("host-a")).toBe("first");
    expect(two.read("host-b")).toBeNull();
    expect(two.compareExchange("host-a", "first", null)).toBe(true);
    new CanonicalCreationStorage(file).importLegacy("host-a", legacy);
    expect(one.read("host-a")).toBeNull();
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("refuses oversized or corrupt durable values without replacing them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canonical-journal-"));
  try {
    const file = join(directory, "creation.sqlite");
    const store = new CanonicalCreationStorage(file);
    store.importLegacy("host", "pending");
    expect(() => store.compareExchange("host", "pending", "x".repeat(1024 * 1024 + 1))).toThrow();
    expect(store.read("host")).toBe("pending");
    const db = new DatabaseSync(file);
    try {
      db.prepare("UPDATE attempts SET payload = ? WHERE host_id = ?").run(
        new Uint8Array([1]),
        "host",
      );
    } finally {
      db.close();
    }
    expect(() => store.read("host")).toThrow();
    expect(() => store.compareExchange("host", null, "replacement")).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
