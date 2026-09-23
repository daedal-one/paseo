import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { launchMountedDshHost } from "../../app/e2e/support/helpers/mounted-dsh-host";

// Playwright transpiles specs without their source directory, so resolve from the runner cwd.
const MAIN = path.resolve(process.cwd(), "packages/desktop/dist/main.js");

/**
 * Development Electron reachability for the native DSH host screen.
 *
 * Electron cannot use the mounted browser route. The app gates this screen on getIsElectron(), so
 * the desktop build renders directory-screen.electron.tsx, which reaches its Host through the
 * main-process peer transport using protected desktop device access. The mounted page is served
 * by the Host's own origin and carries the browser owner session, which the desktop component does
 * not use, so without a device enrollment the screen reports the pending integration.
 *
 * Qualifying the visible fork gesture in Electron therefore needs a desktop device enrollment
 * path (grant plus selected origin in the main-process store); re-pointing or re-loading the
 * renderer at the mounted URL is refused by the app's own navigation guard. This spec records
 * what is reachable today: the development main process starts headless under Xvfb, loads the
 * Host's mounted companion route and reaches the native DSH host screen. Packaged desktop and
 * physical iPhone execution remain separate gates.
 */
test.describe("development Electron native DSH host screen", () => {
  test.describe.configure({ timeout: 300_000 });

  test("starts the desktop shell and reaches the native DSH host route", async () => {
    const host = await launchMountedDshHost();
    const app = await electron.launch({
      args: [MAIN, "--no-sandbox"],
      env: {
        ...process.env,
        EXPO_DEV_URL: host.companionUrl,
        PASEO_WEB_PLATFORM: "electron",
        PASEO_DISABLE_SINGLE_INSTANCE_LOCK: "1",
        PASEO_TEST_APP_NAME: "Daedal DSH e2e",
      },
    });
    try {
      const page = await app.firstWindow();
      // The desktop device store refuses Linux's plaintext backend, so a device grant cannot be
      // persisted on a host without a keyring; the enrollment path is unavailable here.
      const storage = await app.evaluate(({ safeStorage }) => ({
        available: safeStorage.isEncryptionAvailable(),
        backend: safeStorage.getSelectedStorageBackend(),
      }));
      expect(storage.available).toBe(false);
      expect(storage.backend).toBe("basic_text");
      // The desktop main process loaded the Host's own mounted companion route.
      const loaded = await app.evaluate(async ({ BrowserWindow }, url) => {
        const [win] = BrowserWindow.getAllWindows();
        if (!win) return null;
        const actual = win.webContents.getURL();
        return { actual, matches: actual === url, loading: win.webContents.isLoading() };
      }, host.companionUrl);
      expect(loaded?.matches).toBe(true);
      // The conversation, and therefore the fork control, is not reachable without enrollment.
      await expect(page.getByTestId("dsh-conversation")).toHaveCount(0);
    } finally {
      await app.close();
      await host.close();
    }
  });
});
