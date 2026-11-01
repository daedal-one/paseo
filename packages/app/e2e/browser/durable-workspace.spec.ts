import { expect, metroTest as test } from "../support/fixtures";
import { realpath } from "node:fs/promises";
import { attachDshSession, launchMountedDshHost } from "../support/helpers/mounted-dsh-host";

test("connect an existing work collection only after the explicit action", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  const host = await launchMountedDshHost({
    durableWorkspace: true,
    existingWorkspaceWork: true,
  });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "dark" });
    await attachDshSession(context, host.config);
    await page.goto(new URL("/daedal/workspace", host.companionUrl).href);
    await page.getByTestId("dsh-workspace-picker").click();
    await page.getByText(await realpath(host.workspaceDir), { exact: true }).click();
    await page.getByTestId("dsh-workspace-tab-work").click();
    await expect(page.getByText("Existing workspace work", { exact: true })).toBeVisible();
    const connect = page.getByRole("button", { name: "Connect existing work", exact: true });
    await expect(connect).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New work", exact: true }).first(),
    ).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("connect-existing-work.png") });
    await connect.click();
    await expect(connect).toBeHidden();
    await page.getByRole("button", { name: "New work", exact: true }).first().click();
    await page.getByTestId("dsh-work-title").fill("Continue existing workspace work");
    await page.getByTestId("dsh-work-brief").fill("Retain the existing collection identity.");
    await page.getByTestId("dsh-work-save").click();
    await expect(page.getByTestId("dsh-work-detail")).toContainText(
      "Continue existing workspace work",
    );
    await expect(page.locator('[data-testid^="dsh-work-execution-"]')).toHaveCount(0);
  } finally {
    if (testInfo.status !== testInfo.expectedStatus)
      await testInfo.attach("host-output", { body: host.outputTail(), contentType: "text/plain" });
    await host.close();
  }
});

for (const width of [1280, 390]) {
  test(`durable work, source files, reviewed memory and inspection at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180_000);
    const host = await launchMountedDshHost({ durableWorkspace: true });
    try {
      const workspacePath = await realpath(host.workspaceDir);
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: "dark" });
      await attachDshSession(context, host.config);
      await page.goto(new URL("/daedal/workspace", host.companionUrl).href);
      await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('[data-testid^="dsh-open-session-"]')).toHaveCount(0);
      await page.getByTestId("dsh-workspace-picker").click();
      await page.getByText(workspacePath, { exact: true }).click();
      await page.getByRole("button", { name: "New work", exact: true }).first().click();
      await page.getByTestId("dsh-work-title").fill("Prepare the release");
      await page.getByTestId("dsh-work-brief").fill(host.prompt);
      await page.getByTestId("dsh-work-save").click();
      await expect(page.getByTestId("dsh-work-detail")).toContainText("Prepare the release");
      await expect(page.locator('[data-testid^="dsh-work-execution-"]')).toHaveCount(0);
      await page.getByRole("button", { name: "Edit work", exact: true }).click();
      await page.getByTestId("dsh-work-title").fill("Prepare the release checklist");
      await page.getByTestId("dsh-work-save").click();
      await expect(page.getByTestId("dsh-work-detail")).toContainText(
        "Prepare the release checklist",
      );
      await page.screenshot({ path: testInfo.outputPath(`work-${width}.png`) });

      await page.getByTestId("dsh-workspace-tab-files").click();
      await page.getByTestId("dsh-workspace-file-brief.md").click();
      await expect(page.getByTestId("dsh-workspace-file-preview")).toContainText(
        "Keep the review evidence beside the result.",
      );
      await page.screenshot({ path: testInfo.outputPath(`files-${width}.png`) });

      await page.getByTestId("dsh-workspace-tab-memory").click();
      const memory = page.getByTestId("dsh-workspace-memory");
      await expect(memory).toContainText("Keep release evidence with the work item.");
      await memory.getByRole("button", { name: "Accept", exact: true }).click();
      await memory.getByRole("button", { name: "Correct statement", exact: true }).click();
      await memory
        .getByRole("textbox")
        .last()
        .fill("Keep release evidence and rollback instructions with the work item.");
      await memory.getByRole("button", { name: "Save correction", exact: true }).click();
      await expect(memory).toContainText(
        "Keep release evidence and rollback instructions with the work item.",
      );
      await memory.getByRole("button", { name: "Evidence", exact: true }).first().click();
      await expect(memory).toContainText("Trust score:");
      await expect(memory).toContainText("brief.md");
      await page.screenshot({ path: testInfo.outputPath(`memory-${width}.png`) });

      await page.getByTestId("dsh-workspace-tab-work").click();
      if (!(await page.getByTestId("dsh-work-detail").isVisible())) {
        await page.locator('[data-testid^="dsh-work-open-"]').first().click();
      }
      await page.getByRole("button", { name: "New execution", exact: true }).click();
      await page.getByTestId("dsh-create-profiles-refresh").click();
      await expect(page.getByTestId("dsh-create-profile")).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId("dsh-create-profile").click();
      await page.locator('[data-testid^="dsh-create-profile-"]').first().click();
      await page.getByTestId("dsh-create-submit").click();
      await page.getByTestId("dsh-create-open").click();
      await expect(page.getByTestId("dsh-prompt-text")).toHaveValue(host.prompt);
      await page.getByTestId("dsh-prompt-send").click();
      await expect(page.getByTestId("dsh-history-scroll")).toContainText("PONG", {
        timeout: 60_000,
      });
      await page.getByTestId("dsh-prompt-text").fill("Keep this draft while inspecting work");
      await page.getByTestId("dsh-inspect-execution").click();
      for (const label of ["Context", "Trajectory", "Prompt & tools", "Usage", "Info", "Events"]) {
        await page.getByRole("tab", { name: label, exact: true }).click();
        await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        if (label === "Trajectory")
          await expect(page.getByTestId("dsh-session-inspector")).toContainText("PONG");
      }
      const data = await page.getByTestId("dsh-inspector-data").boundingBox();
      expect(data!.y).toBeLessThanOrEqual(width === 1280 ? 150 : 180);
      await page.screenshot({ path: testInfo.outputPath(`inspector-${width}.png`) });
      await page.getByRole("button", { name: "Conversation", exact: true }).click();
      await expect(page.getByTestId("dsh-prompt-text")).toHaveValue(
        "Keep this draft while inspecting work",
      );
      await page.getByRole("button", { name: "Back to sessions", exact: true }).click();
      await page.getByTestId("dsh-workspace-tab-work").click();
      if (!(await page.getByTestId("dsh-work-detail").isVisible())) {
        await page.locator('[data-testid^="dsh-work-open-"]').first().click();
      }
      await expect(page.locator('[data-testid^="dsh-work-execution-"]')).toHaveCount(1);
      await page.getByRole("button", { name: "Mark complete", exact: true }).click();
      await expect(page.getByTestId("dsh-work-detail")).toContainText("Completed");

      await host.restart();
      await page.reload();
      await page.getByTestId("dsh-workspace-picker").click();
      await page.getByText(workspacePath, { exact: true }).click();
      await page.getByTestId("dsh-workspace-tab-work").click();
      await page.locator('[data-testid^="dsh-work-open-"]').first().click();
      await expect(page.getByTestId("dsh-work-detail")).toContainText("Completed");
      await expect(page.locator('[data-testid^="dsh-work-execution-"]')).toHaveCount(1);
      await page.getByRole("button", { name: "Reopen", exact: true }).click();
      await expect(page.getByRole("button", { name: "Mark complete", exact: true })).toBeVisible();
      await page.getByTestId("dsh-workspace-tab-memory").click();
      await expect(page.getByTestId("dsh-workspace-memory")).toContainText(
        "Keep release evidence and rollback instructions with the work item.",
      );
      await page.getByTestId("dsh-workspace-tab-overview").click();
      await page.screenshot({ path: testInfo.outputPath(`overview-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    } finally {
      if (testInfo.status !== testInfo.expectedStatus)
        await testInfo.attach("host-output", {
          body: host.outputTail(),
          contentType: "text/plain",
        });
      await host.close();
    }
  });
}
