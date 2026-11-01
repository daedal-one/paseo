import { expect, metroTest as test } from "../support/fixtures";
import {
  attachDshSession,
  createHostSession,
  launchMountedDshHost,
} from "../support/helpers/mounted-dsh-host";

for (const width of [1280, 390]) {
  test(`workspace overview and complete compact inspection at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(120_000);
    const host = await launchMountedDshHost();
    try {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: "dark" });
      await attachDshSession(context, host.config);
      await page.goto(host.companionUrl);
      await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
      await page.screenshot({ path: testInfo.outputPath(`workspace-${width}.png`) });
      await createHostSession(page, host.workspaceDir);
      test.setTimeout(120_000);
      await page.goto(host.companionUrl);
      await page.locator('[data-testid^="dsh-open-session-"]').first().click();
      await page.getByTestId("dsh-prompt-text").fill(host.prompt);
      await page.getByTestId("dsh-prompt-send").click();
      await expect(page.getByTestId("dsh-history-scroll")).toContainText("PONG", {
        timeout: 60_000,
      });
      await page.getByTestId("dsh-prompt-text").fill("Keep this draft");
      await page.getByTestId("dsh-inspect-execution").click();
      await expect(page.getByTestId("dsh-session-inspector")).toBeVisible();
      await expect(page.getByTestId("dsh-prompt-text")).toBeHidden();
      const geometry = await page.getByTestId("dsh-inspector-data").boundingBox();
      expect(geometry).not.toBeNull();
      if (width === 1280) {
        expect(geometry!.y).toBeLessThanOrEqual(150);
        expect(geometry!.height).toBeGreaterThanOrEqual(600);
      }
      await expect(page.getByText("Next request context", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`context-${width}.png`) });
      for (const label of ["Trajectory", "Prompt & tools", "Usage", "Info", "Events"]) {
        await page.getByRole("tab", { name: label, exact: true }).click();
        await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        if (label === "Trajectory")
          await expect(
            page.getByTestId("dsh-session-inspector").getByTestId("dsh-history-scroll"),
          ).toContainText("PONG");
        if (label === "Prompt & tools")
          await expect(
            page.getByText("Recorded configuration for the selected request."),
          ).toBeVisible();
        if (label === "Info") {
          await expect(page.getByText("Execution environment", { exact: true })).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`info-${width}.png`) });
        }
        if (label === "Trajectory")
          await page.screenshot({ path: testInfo.outputPath(`trajectory-${width}.png`) });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.getByRole("button", { name: "Conversation", exact: true }).click();
      await expect(page.getByTestId("dsh-prompt-text")).toHaveValue("Keep this draft");
      await expect(page.getByTestId("dsh-history-scroll")).toContainText("PONG");
      await page.getByRole("button", { name: "Back to sessions", exact: true }).click();
      await expect(page.getByTestId("dsh-session-list")).toBeVisible();
      if (width === 390) {
        for (const button of await page.getByTestId("dsh-session-list").getByRole("button").all()) {
          const bounds = await button.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.x).toBeGreaterThanOrEqual(16);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 16);
        }
      }
      await page.screenshot({ path: testInfo.outputPath(`workspace-populated-${width}.png`) });
    } finally {
      await host.close();
    }
  });
}
