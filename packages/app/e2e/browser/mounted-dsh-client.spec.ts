import { expect, metroTest as test } from "../support/fixtures";
import {
  attachDshSession,
  createHostSession,
  launchMountedDshHost,
} from "../support/helpers/mounted-dsh-host";

const WIDTHS = [390, 1280];

/**
 * Production-browser qualification of the mounted native DSH client. The real Host serves the
 * built companion export from its own origin, so the browser edition's same-origin owner session
 * is exercised instead of a stand-in.
 *
 * The visible fork control lives in the conversation header, so this spec creates a Host Session
 * through the app's own form, opens its conversation and reviews the fork offer. Completing the
 * fork dispatch is still blocked: submitting the retained attempt disconnects the browser client
 * mid-dispatch, so the owner fails closed with an unconfirmed attempt rather than a confirmed
 * one. See the note in the helper for the exact observed state.
 */
test.describe("mounted native DSH client in the production browser", () => {
  test.describe.configure({ timeout: 240_000 });

  for (const width of WIDTHS) {
    test(`serves the signed-in client and offers a fork at ${width}px`, async ({
      context,
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const host = await launchMountedDshHost();
      try {
        await attachDshSession(context, host.config);
        await page.setViewportSize({ width, height: 844 });
        const response = await page.goto(host.companionUrl);
        expect(response?.status()).toBe(200);
        await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
        // The replay fixture persists no Session, so create the subject through the app form.
        await createHostSession(page, host.workspaceDir);
        await page.getByTestId("dsh-create-open").click();
        await expect(page.getByTestId("dsh-conversation")).toBeVisible({ timeout: 60_000 });

        // The conversation header offers the durable fork for this exact Session.
        await expect(page.getByTestId("dsh-fork-session")).toBeVisible({ timeout: 30_000 });
        await page.getByTestId("dsh-fork-session").click();
        const anchor = page.getByTestId("dsh-fork-anchor");
        await anchor.waitFor({ state: "visible", timeout: 30_000 });
        await expect(page.getByTestId("dsh-fork-source")).not.toBeEmpty();
        await anchor.fill("2");
        expect(errors).toEqual([]);
      } finally {
        await host.close();
      }
    });
  }
});
