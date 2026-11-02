import { defineConfig } from "@playwright/test";

/** Built canonical Host coverage; no Metro or unrelated daemon is started. */
export default defineConfig({
  testDir: "./e2e/browser",
  testMatch: "canonical-workspace.spec.ts",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
