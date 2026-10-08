import { defineConfig } from "@playwright/test";

/**
 * Development Electron qualification. These specs launch the desktop main process themselves and
 * need no Metro dev server, so this config deliberately has no globalSetup.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.electron.spec.ts"],
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
