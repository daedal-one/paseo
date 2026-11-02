import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { selectRemoteCapabilities } from "@deepseek-ai/dsh-client";
const root = resolve(import.meta.dirname, "..");
const requiredCapabilities = selectRemoteCapabilities([
  "workspace/follow",
  "session/list",
  "session/control",
  "session/follow",
  "session/prompt",
  "session/cancel",
  "subagents/list",
]);
const result = await build({
  entryPoints: [join(root, "packages/app/src/dsh/canonical/bridge-bootstrap.ts")],
  bundle: true,
  alias: {
    "@getpaseo/protocol/dsh-canonical": join(root, "packages/protocol/src/dsh-canonical.ts"),
  },
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
});
for (const relative of [
  "packages/app/modules/dsh-canonical/ios/Resources",
  "packages/desktop/dist/dsh/canonical/resources",
]) {
  const destination = join(root, relative);
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "bootstrap.js"), result.outputFiles[0].contents);
  await writeFile(join(destination, "admission.json"), JSON.stringify(requiredCapabilities) + "\n");
}
console.log(`Canonical carrier: bootstrap ${result.outputFiles[0].contents.length} bytes`);
