import { test as base, expect } from "./fixtures";
import { launchDshTestHost } from "../../../../scripts/testing/dsh-host";
import { gotoWorkspace, clickNewChat } from "./helpers/launcher";
import { fillComposerDraft } from "./helpers/composer";
import { waitForSettledPosition } from "./helpers/sheet-layout";
import { seedWorkspace } from "./helpers/seed-client";

type Host = Awaited<ReturnType<typeof launchDshTestHost>>;
const test = base.extend<{}, { dshHost: Host }>({
  dshHost: [
    async ({ e2eDaemonEnvironment }, provide) => {
      void e2eDaemonEnvironment;
      const host = await launchDshTestHost(
        "session/text-turn/session.v1.jsonl",
        "workspace-write",
        true,
      );
      try {
        await provide(host);
      } finally {
        await host.close();
      }
    },
    { scope: "worker" },
  ],
  e2eDaemonConfig: [
    async ({ dshHost }, provide) => {
      await provide({
        version: 1,
        agents: { providers: { dsh: { enabled: true, params: dshHost.config } } },
      });
    },
    { scope: "worker" },
  ],
});

test.use({ trace: "off", video: "off" });

export function testDshProfiles(width: number) {
  test.use({ e2eDaemonEnvironment: { DSH_PROFILE_TEST_VIEWPORT: String(width) } });
  test(`DSH profile defaults and settings at ${width}px`, async ({ page, dshHost }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const workspace = await seedWorkspace({ repoPrefix: "dsh-profile-ui-" });
    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await page.evaluate(() => {
        const nonce = localStorage.getItem("@paseo:e2e-seed-nonce");
        localStorage.setItem("@paseo:e2e-disable-default-seed-once", nonce!);
        localStorage.setItem(
          "@paseo:create-agent-preferences",
          JSON.stringify({ provider: "dsh", providerPreferences: {} }),
        );
      });
      await page.reload();
      await clickNewChat(page);
      await page.setViewportSize({ width, height: 844 });
      const picker = page.getByTestId("dsh-profile-selector").filter({ visible: true }).first();
      await expect(picker).toBeEnabled();
      await picker.click();
      await page.getByText("Minimal", { exact: true }).filter({ visible: true }).click();
      await expect(picker).toContainText("Minimal");
      await page.getByTestId("dsh-session-settings").filter({ visible: true }).click();
      await expect(page.getByText("Override profile model", { exact: true })).toBeVisible();
      await expect(page.getByRole("switch")).not.toBeChecked();
      await page.screenshot({ path: testInfo.outputPath("profile-settings.png") });
      await page
        .getByTestId("dsh-session-settings-sheet")
        .getByRole("button", { name: "Close", exact: true })
        .filter({ visible: true })
        .click();
      await expect(
        page.getByTestId("dsh-session-settings-sheet").filter({ visible: true }),
      ).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("profile-composer.png") });
      await fillComposerDraft(page, dshHost.prompt);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .filter({ visible: true })
        .click();
      await expect(page.getByTestId("dsh-session-profile").filter({ visible: true })).toContainText(
        "minimal",
        { timeout: 30000 },
      );
      await expect(page.getByText("PONG", { exact: true }).first()).toBeVisible({ timeout: 30000 });
      await page.getByTestId("dsh-session-settings").filter({ visible: true }).click();
      await expect(
        page.getByText("Policy-reviewed", { exact: true }).filter({ visible: true }),
      ).toBeVisible();
      await expect(
        page.getByText("DeepSeek · deepseek-flash", { exact: true }).filter({ visible: true }),
      ).toBeVisible();
      const mode = page.getByTestId("mode-control").filter({ visible: true });
      await waitForSettledPosition(mode);
      const bounds = await mode.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
      await mode.click();
      await page.getByText("Read-only", { exact: true }).filter({ visible: true }).click();
      await expect(mode).toContainText("Read-only");
      await mode.click();
      await page.getByText("Policy-reviewed", { exact: true }).filter({ visible: true }).click();
      await expect(mode).toContainText("Policy-reviewed");
      await expect(page.getByTestId("mode-search-input").filter({ visible: true })).toHaveCount(0);
      await waitForSettledPosition(mode);
      await page.screenshot({ path: testInfo.outputPath("profile-session.png") });
      expect(errors).toEqual([]);
    } catch (error) {
      console.error("PROFILE CHECK FAILURE", error);
      await page.screenshot({ path: testInfo.outputPath("before-cleanup.png") });
      console.error((await page.locator("body").innerText()).slice(-6000));
      throw error;
    } finally {
      await workspace.cleanup();
    }
  });
}
