/** Load the native DSH graph using the packaged Electron runtime and its own archives. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const input = process.argv[2];
assert.ok(input, "Usage: node scripts/verify-dsh-desktop.mjs <packaged-app-directory>");
const app = resolve(input);
const mac = process.platform === "darwin";
const resources = mac ? join(app, "Contents", "Resources") : join(app, "resources");
const executable = mac
  ? join(app, "Contents", "MacOS", "Daedal DSH")
  : join(app, process.platform === "win32" ? "Daedal DSH.exe" : "Daedal DSH");
const main = join(resources, "app.asar", "dist", "main.js");
assert.ok(existsSync(executable), "Packaged executable is missing");
const source = `
  const assert = require("node:assert/strict");
  const { createRequire } = require("node:module");
  const requireApp = createRequire(process.argv[1]);
  const protocol = requireApp("@getpaseo/protocol/dsh-access");
  const client = requireApp("@deepseek-ai/dsh-client");
  const { Context } = requireApp("@deepseek-ai/cordis");
  assert.equal(typeof Context, "function");
  assert.equal(client.selectRemoteCapabilities(protocol.dshSessionEndpoints).length, 7);
  assert.equal(protocol.desktopDshCommandSchema.safeParse({type: "list"}).success, true);
  const requireProtocol = createRequire(requireApp.resolve("@getpaseo/protocol/dsh-access"));
  assert.equal(requireProtocol("@deepseek-ai/dsh-client"), client);
  assert.equal(typeof requireApp("./dsh/access.js").DesktopDshAccess, "function");
  assert.equal(typeof requireApp("./dsh/device-store.js").DesktopDshDeviceStore, "function");
  console.log("Packaged DSH runtime and shared module identity verified");
`;
const result = spawnSync(executable, ["-e", source, main], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  encoding: "utf8",
  timeout: 90_000,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
assert.ifError(result.error);
assert.equal(result.status, 0, "Packaged DSH runtime failed to load");
