import { expect, test, type Page } from "@playwright/test";
import { attachDshSession, launchMountedDshHost } from "../support/helpers/mounted-dsh-host";

async function expectPhoneInspectorUtilities(page: Page) {
  const controls = [
    ["Inspector", page.getByRole("heading", { name: "Inspector", exact: true })],
    ["Preset", page.getByText("Standard mode", { exact: true })],
    ["Host application", page.getByRole("button", { name: /^Open workspace in / })],
    [
      "Host chooser",
      page.getByRole("button", {
        name: "Choose an app to open in",
        exact: true,
      }),
    ],
    ["Session actions", page.getByRole("button", { name: "More actions", exact: true })],
    ["Expansion", page.getByTestId("workspace-execution-expand")],
    ["Sidebar", page.getByRole("button", { name: "Open right sidebar", exact: true })],
  ] as const;
  const boxes = [];
  for (const [name, control] of controls) {
    await expect(control).toBeInViewport({ ratio: 1 });
    const box = await control.boundingBox();
    expect(box, name).not.toBeNull();
    boxes.push({ name, ...box! });
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap =
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
    }
  }
  const actions = page.getByRole("button", {
    name: "More actions",
    exact: true,
  });
  await actions.click();
  await expect(
    page.getByRole("menuitem", { name: "Download session log", exact: true }),
  ).toBeVisible();
  await actions.press("Escape");
  const hostChooser = page.getByRole("button", {
    name: "Choose an app to open in",
    exact: true,
  });
  await hostChooser.click();
  await expect(page.getByRole("menu").getByRole("menuitem").first()).toBeVisible();
  await hostChooser.press("Escape");
}

for (const width of [1440, 390]) {
  test(`canonical Work, Files, Memory and Session inspection at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    const host = await launchMountedDshHost({
      canonicalInterface: true,
      durableWorkspace: true,
    });
    const creationRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/session/create")
        creationRequests.push(request.url());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await attachDshSession(context, host.config);
      const response = await page.goto(host.companionUrl);
      expect(response?.status()).toBe(200);
      await expect(page.locator('meta[name="dsh-canonical-interface"]')).toHaveAttribute(
        "content",
        "1",
      );
      const workspace = page.getByRole("combobox", {
        name: "Choose workspace",
        exact: true,
      });
      await expect(workspace.locator("option")).toHaveCount(2, {
        timeout: 60_000,
      });
      await workspace.selectOption({ index: 1 });
      await expect(page.getByTestId("workspace-product")).toBeVisible();
      await expect(page.getByTestId("workspace-new-work")).toBeEnabled();
      await page.getByTestId("workspace-new-work").click();
      await page.getByTestId("workspace-work-title").fill("Prepare the release");
      await page.getByTestId("workspace-work-brief").fill(host.prompt);
      await page.getByTestId("workspace-work-save").click();
      await expect(
        page.getByRole("heading", { name: "Prepare the release", exact: true }),
      ).toBeVisible();
      expect(creationRequests).toEqual([]);

      await page.getByRole("button", { name: "Edit brief", exact: true }).click();
      await page.getByTestId("workspace-work-title").fill("Prepare the release checklist");
      await page.getByTestId("workspace-work-save").click();
      await expect(
        page.getByRole("heading", {
          name: "Prepare the release checklist",
          exact: true,
        }),
      ).toBeVisible();

      await page.getByTestId("workspace-tab-overview").click();
      await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Memory", exact: true })).toBeVisible();
      await page.getByTestId("workspace-tab-files").click();
      await page.getByTestId("workspace-file-brief.md").click();
      await expect(page.getByTestId("workspace-product")).toContainText(
        "Keep the review evidence beside the result.",
      );
      await page.getByText("File metadata", { exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.getByTestId("workspace-tab-memory").click();
      const memory = page
        .locator('[data-testid^="workspace-memory-"]')
        .filter({ hasText: "Keep release evidence with the work item." });
      await memory.getByRole("button", { name: "Accept", exact: true }).click();
      await memory.getByRole("button", { name: "Correct", exact: true }).click();
      await memory
        .getByRole("textbox")
        .fill("Keep release evidence and recovery instructions with the work item.");
      await memory.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByTestId("workspace-product")).toContainText(
        "Keep release evidence and recovery instructions with the work item.",
      );
      expect(creationRequests).toEqual([]);

      await page.getByTestId("workspace-tab-work").click();
      await expect(
        page.getByRole("heading", {
          name: "Prepare the release checklist",
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("button", { name: "New execution", exact: true }).click();
      const composer = page.locator('[data-composer-input][contenteditable="true"]');
      await expect(composer).toBeVisible({ timeout: 60_000 });
      await expect(composer).toContainText(host.prompt);
      await composer.press("Enter");
      await expect(page.getByText("PONG", { exact: true })).toBeVisible({
        timeout: 60_000,
      });
      await composer.fill("Retain this draft while inspecting work");
      await page.getByRole("button", { name: "daedal", exact: true }).click();
      await page.locator('[data-testid^="workspace-inspect-"]').click();
      await expect(page.getByTestId("workspace-execution-frame")).toBeVisible();
      await expect(composer).toHaveCount(1);
      await expect(composer).toBeInViewport({ ratio: 1 });
      await composer.click({ trial: true });
      if (width === 390) await expectPhoneInspectorUtilities(page);
      if (width === 1440) {
        await expect(page.getByTestId("workspace-execution-board")).toBeVisible();
        await expect(page.getByText("PONG", { exact: true })).toBeVisible();
        const inspectorHeading = page.getByRole("heading", {
          name: "Inspector",
          exact: true,
        });
        await expect(inspectorHeading).toBeInViewport({ ratio: 1 });
        const inputBounds = await composer.boundingBox();
        const inspectorBounds = await inspectorHeading.boundingBox();
        expect(inputBounds!.y + inputBounds!.height).toBeLessThan(inspectorBounds!.y);
        await expect(
          page.getByRole("heading", { name: "Current context", exact: true }),
        ).toBeVisible();
      }
      const request = page.getByRole("combobox", {
        name: "Request",
        exact: true,
      });
      await expect(request.locator("option")).toHaveCount(2);
      await request.selectOption({ index: 1 });
      const selectedRequest = await request.inputValue();
      const expand = page.getByTestId("workspace-execution-expand");
      await expect(expand).toHaveAttribute("aria-expanded", "false");
      await expand.click();
      await expect(expand).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText("PONG", { exact: true })).not.toBeVisible();
      await expect(composer).toHaveCount(1);
      await expect(composer).toContainText("Retain this draft while inspecting work");
      await expect(composer).toBeInViewport({ ratio: 1 });
      await composer.click({ trial: true });
      if (width === 390) await expectPhoneInspectorUtilities(page);
      await expect(request).toHaveValue(selectedRequest);
      await expand.click();
      await expect(expand).toHaveAttribute("aria-expanded", "false");
      await expect(composer).toHaveCount(1);
      await expect(request).toHaveValue(selectedRequest);
      if (width === 1440) {
        await expect(page.getByText("PONG", { exact: true })).toBeVisible();
      }
      for (const label of ["Context", "Trajectory", "Prompt & tools", "Usage", "Info", "Events"]) {
        const tab = page.getByRole("tab", { name: label, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        if (width === 390) {
          const bounds = await tab.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        }
        await expect(request).toHaveValue(selectedRequest);
        if (label === "Prompt & tools") {
          await page
            .getByRole("combobox", { name: "Prompt source", exact: true })
            .selectOption({ label: "Selected request prompt" });
        }
      }
      await page.getByRole("tab", { name: "Chat", exact: true }).click();
      await expect(composer).toContainText("Retain this draft while inspecting work");
      await expect(composer).toBeInViewport({ ratio: 1 });
      await composer.click({ trial: true });
      await page.getByRole("button", { name: "daedal", exact: true }).click();
      await page.getByRole("button", { name: "Mark complete", exact: true }).click();
      await expect(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();

      await host.restart();
      await page.reload();
      await workspace.selectOption({ index: 1 });
      await page.getByTestId("workspace-tab-work").click();
      await page
        .locator('[data-testid^="workspace-work-"]')
        .filter({ hasText: "Prepare the release checklist" })
        .click();
      await expect(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Reopen", exact: true }).click();
      await expect(page.getByRole("button", { name: "Mark complete", exact: true })).toBeVisible();
      await expect(page.locator('[data-testid^="workspace-inspect-"]')).toHaveCount(1);
      await page.getByTestId("workspace-tab-memory").click();
      await expect(page.getByTestId("workspace-product")).toContainText(
        "Keep release evidence and recovery instructions with the work item.",
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(pageErrors).toEqual([]);
      await testInfo.attach("canonical-workspace-evidence.json", {
        body: JSON.stringify(
          {
            width,
            creationRequests: creationRequests.length,
            processes: host.processEvidence(),
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } finally {
      try {
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach("canonical-failure", {
            body: await page.screenshot({ timeout: 5_000 }),
            contentType: "image/png",
          });
          await testInfo.attach("host-output", {
            body: host.outputTail(),
            contentType: "text/plain",
          });
        }
      } finally {
        try {
          await page.close();
        } finally {
          await host.close();
        }
      }
    }
  });
}
