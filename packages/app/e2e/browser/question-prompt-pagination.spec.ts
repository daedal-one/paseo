import { test, expect } from "../support/fixtures";
import type { WebSocketRoute } from "@playwright/test";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  chooseQuestionOption,
  continueToNextQuestion,
  expectCurrentQuestion,
  expectQuestionDismissEnabled,
  expectQuestionHidden,
  expectQuestionNavigationEnabled,
  expectQuestionOptionSelected,
  expectQuestionPrimaryActionDisabled,
  expectQuestionPrimaryActionEnabled,
  fillQuestionAnswer,
  openQuestion,
  submitQuestionAnswers,
  waitForQuestionPrompt,
} from "../support/helpers/questions";

const TOTAL_QUESTIONS = 3;
const SURFACE_QUESTION = "Which surface should this apply to?";
const ROLLOUT_QUESTION = "Which rollout should we use?";
const SUCCESS_QUESTION = "What success criteria should we use?";
const REPO_URL_QUESTION = "What is the GitHub private repo URL to push to?";
const COMMIT_MESSAGE_QUESTION = "What should the first commit message be?";

class InterruptedQuestionNetwork {
  answersSent = 0;
  handshakes = 0;
  allowConnections = true;
  private interrupt = true;
  private waitingForLostReply = false;

  constructor(private readonly loseReply = false) {}
  private readonly sockets = new Set<WebSocketRoute>();

  connect = (socket: WebSocketRoute): void => {
    if (!this.allowConnections) {
      void socket.close();
      return;
    }
    this.sockets.add(socket);
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = typeof message === "string" ? JSON.parse(message) : null;
      if (frame?.message?.type === "agent_permission_response") {
        this.answersSent++;
        if (this.interrupt) {
          this.interrupt = false;
          if (this.loseReply) {
            this.waitingForLostReply = true;
            server.send(message);
            return;
          }
          this.allowConnections = false;
          void socket.close();
          void server.close();
          return;
        }
      }
      server.send(message);
    });
    let delivery = Promise.resolve();
    server.onMessage((message) => {
      if (this.waitingForLostReply) {
        if (
          typeof message === "string" &&
          JSON.parse(message).message?.type === "agent_permission_resolved"
        ) {
          this.waitingForLostReply = false;
          this.allowConnections = false;
          void socket.close();
          void server.close();
        }
        return;
      }
      delivery = delivery
        .then(() => this.deliver(socket, message))
        .catch(() => {
          // An intentionally closed test socket has no recipient for its queued frames.
        });
    });
  };

  private async deliver(socket: WebSocketRoute, message: string | Buffer): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 75));
    socket.send(message);
    if (
      typeof message === "string" &&
      JSON.parse(message).message?.payload?.status === "server_info"
    )
      this.handshakes++;
  }

  async close(): Promise<void> {
    this.allowConnections = false;
    await Promise.allSettled([...this.sockets].map((socket) => socket.close()));
  }
}

test.describe("Question prompt pagination", () => {
  test("retains an answer through an interrupted send and slow reconnect without automatic resubmission", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const network = new InterruptedQuestionNetwork();
    await page.routeWebSocket(/\/ws(?:\?|$)/, network.connect);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-recovery-",
      title: "Question recovery",
      initialPrompt: "Emit synthetic questions: two free-write questions.",
    });
    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);
      await fillQuestionAnswer(page, {
        question: REPO_URL_QUESTION,
        answer: "git@github.com:example/project.git",
      });
      await continueToNextQuestion(page);
      await fillQuestionAnswer(page, {
        question: COMMIT_MESSAGE_QUESTION,
        answer: "Keep this answer across reconnect",
      });
      await page.getByTestId("question-form-primary-action").click();
      await expect(page.getByTestId("permission-submit-error")).toContainText(
        "Could not confirm your answer",
      );
      await expect(page.getByRole("textbox", { name: COMMIT_MESSAGE_QUESTION })).toHaveValue(
        "Keep this answer across reconnect",
      );
      expect(network.answersSent).toBe(1);
      await page.screenshot({ path: test.info().outputPath("question-retry.png") });
      network.allowConnections = true;
      await expect.poll(() => network.handshakes, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
      await page.getByTestId("question-form-primary-action").click();
      await expect(page.getByTestId("question-form-card")).toHaveCount(0, { timeout: 30_000 });
      expect(network.answersSent).toBe(2);
    } finally {
      await network.close();
      await session.cleanup();
    }
  });

  test("reconciles an accepted answer after its acknowledgement is lost without replaying it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const network = new InterruptedQuestionNetwork(true);
    await page.routeWebSocket(/\/ws(?:\?|$)/, network.connect);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-lost-ack-",
      title: "Question acknowledgement recovery",
      initialPrompt: "Emit synthetic questions: two free-write questions.",
    });
    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);
      await fillQuestionAnswer(page, {
        question: REPO_URL_QUESTION,
        answer: "git@github.com:example/project.git",
      });
      await continueToNextQuestion(page);
      await fillQuestionAnswer(page, {
        question: COMMIT_MESSAGE_QUESTION,
        answer: "An accepted answer must not be resent",
      });
      await page.getByTestId("question-form-primary-action").click();
      await expect(page.getByTestId("permission-submit-error")).toContainText(
        "Could not confirm your answer",
      );
      expect(network.answersSent).toBe(1);
      network.allowConnections = true;
      await expect.poll(() => network.handshakes, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
      await expect(page.getByTestId("question-form-card")).toHaveCount(0, { timeout: 30_000 });
      expect(network.answersSent).toBe(1);
      await page.screenshot({ path: test.info().outputPath("question-reconciled.png") });
    } finally {
      await network.close();
      await session.cleanup();
    }
  });

  test("shows one question at a time with numbered navigation", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-pagination-",
      title: "Question pagination e2e",
      initialPrompt: "Emit synthetic questions.",
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await expectCurrentQuestion(page, {
        index: 1,
        total: TOTAL_QUESTIONS,
        question: SURFACE_QUESTION,
      });
      await expectQuestionHidden(page, ROLLOUT_QUESTION);
      await expectQuestionHidden(page, SUCCESS_QUESTION);

      await chooseQuestionOption(page, "App");
      await expectCurrentQuestion(page, {
        index: 2,
        total: TOTAL_QUESTIONS,
        question: ROLLOUT_QUESTION,
      });

      await openQuestion(page, { index: 1, total: TOTAL_QUESTIONS });
      await expectCurrentQuestion(page, {
        index: 1,
        total: TOTAL_QUESTIONS,
        question: SURFACE_QUESTION,
      });
      await expectQuestionOptionSelected(page, "App");

      await openQuestion(page, { index: 2, total: TOTAL_QUESTIONS });
      await chooseQuestionOption(page, "Behind feature flag");
      await expectCurrentQuestion(page, {
        index: 3,
        total: TOTAL_QUESTIONS,
        question: SUCCESS_QUESTION,
      });

      await fillQuestionAnswer(page, {
        question: SUCCESS_QUESTION,
        answer: "Only one prompt is visible at a time.",
      });
      await submitQuestionAnswers(page);
    } finally {
      await session.cleanup();
    }
  });

  test("free-write questions use Next before final Submit", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-free-write-",
      title: "Question free-write e2e",
      initialPrompt: "Emit synthetic questions: two free-write questions.",
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await expectCurrentQuestion(page, {
        index: 1,
        total: 2,
        question: REPO_URL_QUESTION,
      });

      await fillQuestionAnswer(page, {
        question: REPO_URL_QUESTION,
        answer: "git@github.com:user/private-repo.git",
      });

      await expectQuestionPrimaryActionEnabled(page, "Next");
      await expectQuestionDismissEnabled(page);
      await expectQuestionNavigationEnabled(page, { index: 2, total: 2 });

      await continueToNextQuestion(page);
      await expectCurrentQuestion(page, {
        index: 2,
        total: 2,
        question: COMMIT_MESSAGE_QUESTION,
      });
      await expectQuestionPrimaryActionDisabled(page, "Submit");

      await fillQuestionAnswer(page, {
        question: COMMIT_MESSAGE_QUESTION,
        answer: "Initialize private repo",
      });
      await expectQuestionPrimaryActionEnabled(page, "Submit");
      await submitQuestionAnswers(page);
    } finally {
      await session.cleanup();
    }
  });
});
