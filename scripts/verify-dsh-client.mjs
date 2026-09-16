/** Verify the DSH distribution pinned by the application before building it. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const distribution = join(root, "vendor/dsh");
const manifest = readJson(join(distribution, "manifest.json"));
const app = readJson(join(root, "packages/app/package.json"));
const lock = readJson(join(root, "package-lock.json"));
const appRequire = createRequire(join(root, "packages/app/package.json"));
const expected = [
  "@deepseek-ai/cordis",
  "@deepseek-ai/cosmokit",
  "@deepseek-ai/dsh-brand",
  "@deepseek-ai/dsh-typert-protocol",
  "@deepseek-ai/dsh-util-values",
  "@deepseek-ai/dsh-api-remotes-client",
];
assert.equal(manifest.version, 1);
assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
assert.equal(manifest.entry, "@deepseek-ai/dsh-api-remotes-client");
assert.deepEqual(manifest.archives.map((archive) => archive.name).sort(), expected.sort());
for (const archive of manifest.archives) {
  assert.equal(basename(archive.file), archive.file, "archive must be a local filename");
  assert.ok(archive.file.endsWith(".tgz"));
  const bytes = readFileSync(join(distribution, archive.file));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    archive.sha256,
    `archive checksum: ${archive.name}`,
  );
  const dependency = `file:../../vendor/dsh/${archive.file}`;
  assert.equal(app.dependencies[archive.name], dependency, `app dependency: ${archive.name}`);
  assert.equal(
    lock.packages["packages/app"].dependencies[archive.name],
    dependency,
    `lock dependency: ${archive.name}`,
  );
  const installed = readJson(appRequire.resolve(`${archive.name}/package.json`));
  assert.equal(installed.version, archive.version, `installed version: ${archive.name}`);
  if (archive.name === manifest.entry) {
    assert.equal(installed.dshSource.commit, manifest.sourceCommit, "installed DSH source commit");
  }
  const locked = Object.entries(lock.packages).filter(([path]) =>
    path.endsWith(`node_modules/${archive.name}`),
  );
  assert.equal(locked.length, 1, `one installed identity: ${archive.name}`);
  const [, record] = locked[0];
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  assert.equal(record.integrity, integrity, `lock integrity: ${archive.name}`);
}
const clientUrl = pathToFileURL(appRequire.resolve(manifest.entry));
const client = await import(clientUrl.href);
assert.equal(
  client.selectRemoteCapabilities(["session/list", "session/follow", "session/prompt"]).length,
  3,
);
console.log(`DSH Client verified: ${manifest.sourceCommit}, ${manifest.archives.length} archives`);
