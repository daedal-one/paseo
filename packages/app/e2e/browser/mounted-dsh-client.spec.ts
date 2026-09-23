import type { Page } from "@playwright/test";
import { expect, metroTest as test } from "../support/fixtures";
import {
  attachDshSession,
  createHostSession,
  launchMountedDshHost,
} from "../support/helpers/mounted-dsh-host";

const WIDTHS = [390, 1280];

async function openOnlySession(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-testid^="dsh-open-session-"]').click();
  await expect(page.getByTestId("dsh-conversation")).toBeVisible();
}

async function expectReachableComposer(page: Page): Promise<void> {
  const send = await page.getByTestId("dsh-prompt-send").boundingBox();
  expect(send).not.toBeNull();
  expect(send!.y).toBeGreaterThanOrEqual(0);
  expect(send!.y + send!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

test.describe("mounted native DSH queue readers", () => {
  test.describe.configure({ timeout: 300_000 });
  for (const width of WIDTHS) {
    test(`shares the Host queue without replay at ${width}px`, async ({
      browser,
      context,
      page,
    }, testInfo) => {
      const errors: string[] = [];
      const mutations: string[] = [];
      const observe = (client: Page) => {
        client.on("pageerror", (error) => errors.push(error.message));
        client.on("request", (request) => {
          if (/\/session\/(prompt|updateQueue|cancel)$/.test(new URL(request.url()).pathname))
            mutations.push(new URL(request.url()).pathname);
        });
      };
      observe(page);
      const host = await launchMountedDshHost({ holdTurn: true });
      const readerContext = await browser.newContext({ viewport: { width, height: 844 } });
      try {
        await attachDshSession(context, host.config);
        await attachDshSession(readerContext, host.config);
        await page.setViewportSize({ width, height: 844 });
        await page.goto(host.companionUrl);
        await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
        await createHostSession(page, host.workspaceDir);
        await page.getByTestId("dsh-create-open").click();
        await page.getByLabel("Message").fill(host.prompt);
        await page.getByTestId("dsh-prompt-send").click();
        await expect(page.getByText("partial", { exact: true }).first()).toBeVisible({
          timeout: 120_000,
        });
        const reader = await readerContext.newPage();
        observe(reader);
        await openOnlySession(reader, host.companionUrl);
        await page.getByTestId("dsh-queue-toggle").click();
        await reader.getByTestId("dsh-queue-toggle").click();
        await expect(page.getByTestId("dsh-queue-item")).toHaveCount(0);

        // Separate real clients submit to the same running Host Session, in explicit order.
        await page.getByLabel("Message").fill("First queued follow-up");
        await page.getByTestId("dsh-prompt-send").click();
        await expect(reader.getByTestId("dsh-queue-item")).toHaveCount(1);
        await reader.getByLabel("Message").fill("Second queued follow-up");
        await reader.getByTestId("dsh-prompt-send").click();
        for (const client of [page, reader]) {
          await expect(client.getByTestId("dsh-queue-item")).toHaveCount(2);
          await expect(client.getByTestId("dsh-queue-item").nth(0)).toContainText(
            "First queued follow-up",
          );
          await expect(client.getByTestId("dsh-queue-item").nth(1)).toContainText(
            "Second queued follow-up",
          );
          await expectReachableComposer(client);
        }
        await page.getByLabel("Message").fill("Unsent draft stays local");
        await page.getByTestId("dsh-queue-toggle").click();
        await page.getByTestId("dsh-queue-toggle").click();
        await expect(page.getByLabel("Message")).toHaveValue("Unsent draft stays local");

        // A fresh reader gets the Host control baseline, not a persisted frontend queue.
        await reader.close();
        const replacement = await readerContext.newPage();
        observe(replacement);
        await openOnlySession(replacement, host.companionUrl);
        await replacement.getByTestId("dsh-queue-toggle").click();
        await expect(replacement.getByTestId("dsh-queue-item")).toHaveCount(2);
        await expect(replacement.getByTestId("dsh-queue-item").nth(0)).toContainText(
          "First queued follow-up",
        );
        await expect(replacement.getByTestId("dsh-queue-item").nth(1)).toContainText(
          "Second queued follow-up",
        );
        expect(mutations.filter((value) => value.endsWith("/prompt"))).toHaveLength(3);
        expect(mutations.filter((value) => !value.endsWith("/prompt"))).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`queue-${width}.png`) });
        expect(errors).toEqual([]);
      } finally {
        await readerContext.close();
        await host.close();
      }
    });
  }
});

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
