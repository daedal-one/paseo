import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectionDeviceGrantSchema } from "@deepseek-ai/dsh-client";
import { DesktopDshDeviceStore, type DshProtectedStorage } from "./device-store";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "dsh-device-store-"));
  homes.push(home);
  const key = randomBytes(32);
  const storage: DshProtectedStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "keychain",
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString();
    },
  };
  const file = join(home, "access");
  return { home, file, storage, store: new DesktopDshDeviceStore(file, storage, "darwin") };
}
function record() {
  const deviceId = randomUUID();
  return {
    version: 1 as const,
    origin: "https://host.example",
    grant: connectionDeviceGrantSchema.parse({
      version: 1,
      hostId: randomUUID(),
      device: { deviceId, label: "Desktop", createdAt: 1 },
      credential: `dsh-device-v1.${deviceId}.${"a".repeat(43)}`,
    }),
  };
}

describe("protected desktop host records", () => {
  it("reopens encrypted records and returns only nonsecret descriptors", async () => {
    const { store, storage, file, home } = await fixture();
    const saved = record();
    await store.save(saved);
    expect((await readFile(file)).includes(Buffer.from(saved.grant.credential))).toBe(false);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(home)).toEqual(["access"]);
    const reopened = new DesktopDshDeviceStore(file, storage, "darwin");
    expect(await reopened.list()).toEqual([
      { hostId: saved.grant.hostId, origin: saved.origin, label: "Desktop" },
    ]);
    expect(await reopened.load(saved.grant.hostId)).toEqual(saved);
  });
  it("serializes saves and forgetting without dropping unrelated hosts", async () => {
    const { store } = await fixture();
    const a = record();
    const b = record();
    await Promise.all([store.save(a), store.save(b), store.forget(a.grant.hostId)]);
    expect(await store.load(a.grant.hostId)).toBeNull();
    expect(await store.load(b.grant.hostId)).toEqual(b);
    await expect(store.save(b)).rejects.toMatchObject({ code: "already-paired" });
  });
  it("refuses unavailable encryption and the Linux plaintext fallback before writing", async () => {
    const { file, storage, home } = await fixture();
    storage.isEncryptionAvailable = () => false;
    await expect(new DesktopDshDeviceStore(file, storage, "darwin").list()).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    storage.isEncryptionAvailable = () => true;
    storage.getSelectedStorageBackend = () => "basic_text";
    await expect(
      new DesktopDshDeviceStore(file, storage, "linux").save(record()),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
    expect(await readdir(home)).toEqual([]);
  });
  it("rejects corrupt and duplicate records without overwriting the protected file", async () => {
    const { file, store, storage } = await fixture();
    const saved = record();
    for (const bytes of [
      Buffer.from("corrupt"),
      storage.encryptString(JSON.stringify([saved, saved])),
    ]) {
      await writeFile(file, bytes);
      await expect(store.save(record())).rejects.toMatchObject({ code: "invalid-record" });
      expect(await readFile(file)).toEqual(bytes);
    }
  });
});
