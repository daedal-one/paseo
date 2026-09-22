import { expect, metroTest as test } from "../support/fixtures";
import { attachDshSession, launchMountedDshHost } from "../support/helpers/mounted-dsh-host";

const WIDTHS = [390, 1280];

/**
 * Production-browser qualification of the mounted native DSH client. The real Host serves the
 * built companion export from its own origin, so the browser edition's same-origin owner session
 * is exercised instead of a stand-in.
 *
 * The visible fork control lives in the conversation header, so driving it also needs a persisted
 * Session. The replay fixture seeds none, so the app's creation form has to be completed first;
 * that remaining step is recorded by `createHostSession`. Until it lands this spec qualifies the
 * mount pipeline, not the fork gesture.
 */
test.describe("mounted native DSH client in the production browser", () => {
  test.describe.configure({ timeout: 180_000 });

  for (const width of WIDTHS) {
    test(`serves the signed-in companion surface at ${width}px`, async ({ context, page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const host = await launchMountedDshHost();
      try {
        await attachDshSession(context, host.config);
        await page.setViewportSize({ width, height: 844 });
        const response = await page.goto(host.companionUrl);
        expect(response?.status()).toBe(200);
        // The browser owner connects to the page's own origin; no enrollment is involved.
        await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId("dsh-create-session")).toBeVisible();
        await expect(page.getByTestId("dsh-register-workspace")).toBeVisible();
        await expect(page.getByTestId("dsh-search-sessions")).toBeVisible();
        await page.getByTestId("dsh-search-sessions").click();
        await expect(page.getByTestId("dsh-search-sheet")).toBeVisible({ timeout: 30_000 });
        await page.getByTestId("dsh-search-close").click();
        expect(errors).toEqual([]);
      } finally {
        await host.close();
      }
    });
  }
});
