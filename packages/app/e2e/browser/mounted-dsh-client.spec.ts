import { expect, metroTest as test } from "../support/fixtures";
import {
  attachDshSession,
  createHostSession,
  launchMountedDshHost,
} from "../support/helpers/mounted-dsh-host";

const WIDTHS = [390, 1280];

/**
 * Production-browser qualification of the visible native fork. The real Host serves the built
 * companion export from its own origin, so the browser edition's same-origin owner session is
 * exercised end to end instead of a stand-in.
 *
 * A fork inherits a completed turn, so the flow creates a Host Session through the app's own
 * form, drives one recorded turn to completion, then forks from that completed conversation.
 */
test.describe("mounted native DSH fork in the production browser", () => {
  test.describe.configure({ timeout: 300_000 });

  for (const width of WIDTHS) {
    test(`forks a completed Host conversation and reviews it at ${width}px`, async ({
      context,
      page,
    }, testInfo) => {
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

        // A retained fork needs a completed turn to inherit.
        await page.getByLabel("Message").fill(host.prompt);
        await page.getByRole("button", { name: "Send message" }).click();
        await expect(page.getByText("PONG", { exact: true }).first()).toBeVisible({
          timeout: 120_000,
        });

        await expect(page.getByTestId("dsh-fork-session")).toBeVisible({ timeout: 30_000 });
        await page.getByTestId("dsh-fork-session").click();
        const source = page.getByTestId("dsh-fork-source");
        await source.waitFor({ state: "visible", timeout: 30_000 });
        await expect(source).not.toBeEmpty();
        await page.screenshot({ path: testInfo.outputPath(`fork-${width}-offer.png`) });

        await page.getByTestId("dsh-fork-submit").click();
        await expect(page.getByTestId("dsh-fork-outcome-confirmed")).toBeVisible({
          timeout: 60_000,
        });
        // The child identity is the ones the Host confirmed, and the attempt cannot be resent.
        await expect(page.getByTestId("dsh-fork-request-child")).not.toBeEmpty();
        await expect(page.getByTestId("dsh-fork-retained-child")).not.toBeEmpty();
        await expect(page.getByTestId("dsh-fork-submit")).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`fork-${width}-confirmed.png`) });
        expect(errors).toEqual([]);
      } finally {
        await host.close();
      }
    });
  }
});
