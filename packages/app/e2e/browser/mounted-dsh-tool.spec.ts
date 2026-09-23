import { expect, metroTest as test } from "../support/fixtures";
import {
  attachDshSession,
  createHostSession,
  launchMountedDshHost,
} from "../support/helpers/mounted-dsh-host";

const WIDTHS = [390, 1280];
const TOOL_FIXTURE = "session/bash-tool-turn/session.v3.jsonl";
// The fixture's own recorded user turn, which the replay provider answers with a bash tool call.
const TOOL_PROMPT =
  "Use the bash tool to run exactly: echo TERMINAL_OK. Then reply with the single word DONE and stop.";

/**
 * Production-browser qualification of a real recorded tool turn in the mounted native client. The
 * Host replays a recorded bash turn, so the client's tool row must show the call, its status and
 * its result content rather than a placeholder.
 */
test.describe("mounted native DSH tool presentation", () => {
  test.describe.configure({ timeout: 300_000 });

  for (const width of WIDTHS) {
    test(`renders a recorded bash tool turn at ${width}px`, async ({ context, page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const host = await launchMountedDshHost({ fixture: TOOL_FIXTURE });
      try {
        await attachDshSession(context, host.config);
        await page.setViewportSize({ width, height: 844 });
        const response = await page.goto(host.companionUrl);
        expect(response?.status()).toBe(200);
        await expect(page.getByTestId("dsh-session-list")).toBeVisible({ timeout: 60_000 });
        // The live Session is bound to the recorded script by the prompt it receives.
        await createHostSession(page, host.workspaceDir);
        await page.getByTestId("dsh-create-open").click();
        await expect(page.getByTestId("dsh-conversation")).toBeVisible({ timeout: 60_000 });
        await page.getByLabel("Message").fill(TOOL_PROMPT);
        await page.getByRole("button", { name: "Send message" }).click();

        // The recorded turn renders its assistant answer and a real tool row.
        await expect(page.getByText("DONE", { exact: true }).first()).toBeVisible({
          timeout: 120_000,
        });
        const toolRow = page.getByTestId("dsh-tool-result");
        await expect(toolRow).toBeVisible({ timeout: 120_000 });
        await expect(toolRow).toContainText("bash");
        // The row owns a status line; the sandbox on this host may refuse the recorded command.
        await expect(page.getByTestId("dsh-tool-status")).toHaveText(/Tool (finished|failed)/);
        await expect(toolRow).toContainText(/TERMINAL_OK|sandbox/);
        await expect(page.getByTestId("dsh-block-reasoning").first()).toBeVisible();
        // The tool call still renders in the assistant step as a structured block.
        await expect(page.getByTestId("dsh-block-tool-call").first()).toBeVisible();
        expect(errors).toEqual([]);
      } finally {
        await host.close();
      }
    });
  }
});
