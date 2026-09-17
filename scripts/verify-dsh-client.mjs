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
  "@deepseek-ai/dsh-client",
];
assert.equal(manifest.version, 1);
assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
assert.equal(manifest.entry, "@deepseek-ai/dsh-client");
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
    assert.deepEqual(
      installed.dshSource.packages,
      [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-chat",
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-client-ui-approval",
        "@deepseek-ai/dsh-client-ui-user-questions",
      ],
      "shared application owners",
    );
  }
  const locked = Object.entries(lock.packages).filter(([path]) =>
    path.endsWith(`node_modules/${archive.name}`),
  );
  assert.equal(locked.length, 1, `one installed identity: ${archive.name}`);
  const [, record] = locked[0];
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  assert.equal(record.integrity, integrity, `lock integrity: ${archive.name}`);
}
assert.equal(app.dependencies["@deepseek-ai/dsh-api-remotes-client"], undefined);
assert.ok(
  !Object.keys(lock.packages).some((path) =>
    path.endsWith("node_modules/@deepseek-ai/dsh-api-remotes-client"),
  ),
  "the API-only distribution must not duplicate application types",
);
const clientUrl = pathToFileURL(appRequire.resolve(manifest.entry));
const client = await import(clientUrl.href);
for (const name of [
  "PendingInteractions",
  "PendingApproval",
  "PendingQuestion",
  "registerApprovalRequests",
  "registerQuestionRequests",
  "planReviewOf",
]) {
  assert.equal(typeof client[name], "function", `installed interaction export: ${name}`);
}
assert.equal(
  client.selectRemoteCapabilities(["session/list", "session/follow", "session/prompt"]).length,
  3,
);
const { Context } = await import(pathToFileURL(appRequire.resolve("@deepseek-ai/cordis")).href);
const context = new Context();
const events = new client.ConversationEventRegistry(context);
const views = new client.ConversationViewRegistry(context);
client.registerChatConversation({
  events,
  views,
  inspectRequestPrompt: client.inspectRequestPrompt,
  inspectSystemPrompt: client.inspectSystemPrompt,
});
const feed = new client.MutableSessionEventSource();
const binding = new client.ConversationBindingModel(
  feed,
  new client.ConversationNodeAssembler(events, views),
  null,
);
const target = binding.target("chat");
const unsubscribe = target.subscribe(() => {});
try {
  feed.append({ type: "event", event: { type: "turn/start", seq: 1, time: 1, data: { turn: 1 } } });
  feed.append({
    type: "event",
    event: { type: "step/start", seq: 2, time: 2, data: { turn: 1, step: 1 } },
  });
  feed.append({
    type: "transient",
    event: {
      type: "assistant/live-chunk",
      seq: 3,
      time: 3,
      data: {
        turn: 1,
        step: 1,
        attemptId: "distribution-check",
        chunk: { type: "text-delta", index: 0, text: "installed Chat" },
      },
    },
  });
  assert.equal(target.getSnapshot().navigation.items()[0].response, "installed Chat");
} finally {
  unsubscribe();
  binding.dispose();
  await context.fiber.dispose();
}
console.log(`DSH Client verified: ${manifest.sourceCommit}, ${manifest.archives.length} archives`);
