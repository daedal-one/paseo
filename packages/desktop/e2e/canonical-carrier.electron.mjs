#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "playwright/test";

const pairingFile = process.env.DSH_CANONICAL_PAIRING_FILE;
if (!pairingFile)
  throw new Error("DSH_CANONICAL_PAIRING_FILE must name a fresh isolated Host enrollment file");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const state = await mkdtemp(join(tmpdir(), "dsh-canonical-electron-"));
const evidence = process.env.DSH_CANONICAL_EVIDENCE_DIR ?? join(state, "evidence");
await mkdir(evidence, { recursive: true, mode: 0o700 });
// The enrollment challenge enters only the main process; it is never emitted as evidence.
const pairing = JSON.parse(await readFile(pairingFile, "utf8"));
assert.equal(typeof pairing.origin, "string");
assert.equal(typeof pairing.enrollment?.hostId, "string");
const inputFile = join(state, "pairing.json");
await writeFile(inputFile, JSON.stringify(pairing), { mode: 0o600 });
const entry = join(state, "main.cjs");
await writeFile(
  entry,
  `
const {app, protocol, safeStorage, ipcMain} = require('electron');
const {readFile} = require('node:fs/promises');
const {randomUUID} = require('node:crypto');
app.setPath('userData', ${JSON.stringify(join(state, "user-data"))});
protocol.registerSchemesAsPrivileged([{scheme:'dshremote', privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
globalThis.canonicalSmoke = {status:'starting'};
globalThis.canonicalRequests = [];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, value) => {
  if (channel !== 'daedal:canonical:request') return listener(event, value);
  const metadata = {kind: value?.kind, path: value?.path?.split('?')[0], method: value?.method};
  try { const result = await listener(event, value); globalThis.canonicalRequests.push({...metadata, status:'accepted'}); return result; }
  catch(error) { globalThis.canonicalRequests.push({...metadata, status:'rejected'}); throw error; }
});
app.whenReady().then(async () => {
  const {DesktopDshDeviceStore} = require(${JSON.stringify(join(root, "packages/desktop/dist/dsh/device-store.js"))});
  const {DesktopDshAccess} = require(${JSON.stringify(join(root, "packages/desktop/dist/dsh/access.js"))});
  const {CanonicalDshWindows} = require(${JSON.stringify(join(root, "packages/desktop/dist/dsh/canonical/windows.js"))});
  const store = new DesktopDshDeviceStore(${JSON.stringify(join(state, "devices.v1"))}, safeStorage, process.platform);
  const access = new DesktopDshAccess(store, () => {});
  const windows = new CanonicalDshWindows(store);
  globalThis.closeCanonicalSmoke = async () => { await windows.dispose(); await access.dispose(); };
  const pairing = JSON.parse(await readFile(${JSON.stringify(inputFile)}, 'utf8'));
  await access.run(1, {type:'pair', claimId:randomUUID(), pairing, label:'Canonical carrier qualification'});
  await windows.open(pairing.enrollment.hostId);
  globalThis.canonicalSmoke = {status:'opened',hostId:pairing.enrollment.hostId};
}).catch(error => { globalThis.canonicalSmoke={status:'failed',code: typeof error.code==='string' ? error.code : 'carrier-failed'}; });
`,
  { mode: 0o600 },
);
let desktop;
let qualified = false;
try {
  desktop = await electron.launch({
    args: [entry],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"),
    ),
  });
  await expect
    .poll(() => desktop.evaluate(() => globalThis.canonicalSmoke), { timeout: 120_000 })
    .toMatchObject({ status: "opened" });
  const page = await desktop.firstWindow();
  await expect(page.locator('meta[name="dsh-canonical-interface"]')).toHaveAttribute(
    "content",
    "1",
  );
  await expect(page.locator("[data-shell-overlay]")).toHaveCount(1, { timeout: 120_000 });
  await expect(page.locator("[data-dsh-boot]")).toHaveCount(0);
  await expect
    .poll(
      () =>
        desktop.evaluate(() =>
          globalThis.canonicalRequests.some(
            (request) => request.kind === "socket-open" && request.status === "accepted",
          ),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(page.getByText("Reconnecting", { exact: false })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect
    .poll(
      () =>
        desktop.evaluate(() =>
          globalThis.canonicalRequests.some(
            (request) => request.path === "/api/$capabilities" && request.status === "accepted",
          ),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  const facts = await page.evaluate(() => ({
    ownsHost: globalThis.__DSH_TRANSPORT__?.ownsHost,
    expectedHostId: globalThis.__DSH_REMOTE_ADMISSION__?.expectedHostId,
    transport: typeof globalThis.__DSH_TRANSPORT__?.fetch,
    socket: typeof globalThis.__DSH_REMOTE_SOCKET__?.createSocket,
    creationStorage: typeof globalThis.__DSH_WORK_CREATION_STORAGE__?.compareExchange,
    upload: typeof globalThis.__DSH_FILE_UPLOAD__?.fetch,
    export: typeof globalThis.__DSH_SESSION_EXPORT__?.download,
    credentialGlobal:
      Object.hasOwn(globalThis, "credential") || Object.hasOwn(globalThis, "__DSH_CREDENTIAL__"),
  }));
  assert.deepEqual(facts, {
    ownsHost: false,
    expectedHostId: pairing.enrollment.hostId,
    transport: "function",
    socket: "function",
    creationStorage: "function",
    upload: "function",
    export: "function",
    credentialGlobal: false,
  });
  assert.equal(await page.evaluate(() => globalThis.__DSH_WORK_CREATION_STORAGE__.read()), null);
  await page.screenshot({ path: join(evidence, "canonical-desktop.png"), fullPage: true });
  await writeFile(
    join(evidence, "carrier.json"),
    JSON.stringify({ status: "passed", ...facts }, null, 2) + "\n",
    { mode: 0o600 },
  );
  qualified = true;
  console.log(JSON.stringify({ status: "passed", evidence }));
} finally {
  if (!qualified)
    await writeFile(join(evidence, "carrier.json"), JSON.stringify({ status: "failed" }) + "\n", {
      mode: 0o600,
    });
  if (desktop) {
    const requests = await desktop.evaluate(() => globalThis.canonicalRequests).catch(() => []);
    await writeFile(join(evidence, "requests.json"), JSON.stringify(requests, null, 2) + "\n", {
      mode: 0o600,
    });
    await desktop
      .evaluate(async () => {
        await globalThis.closeCanonicalSmoke?.();
      })
      .catch(() => {});
    await desktop.close();
  }
  await rm(inputFile, { force: true });
  await rm(join(state, "devices.v1"), { force: true });
}
