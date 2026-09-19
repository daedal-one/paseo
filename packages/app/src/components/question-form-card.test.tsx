/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingPermission } from "@/types/shared";
import { i18n } from "@/i18n/i18next";
import { QuestionFormCard } from "./question-form-card";

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function element<T extends HTMLElement>(selector: string): T {
  const found = container.querySelector<T>(selector);
  if (!found) throw new Error(`Missing question control: ${selector}`);
  return found;
}

function typeAnswer(value: string): void {
  const input = element<HTMLInputElement>('input[aria-label="Which color?"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Input value setter unavailable");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(selector: string): void {
  act(() => element(selector).click());
}

function renderQuestion(
  structured: boolean,
  multiSelect = true,
  submissionError: string | null = null,
) {
  const permission: PendingPermission = {
    key: "question",
    agentId: "agent",
    request: {
      id: "request",
      provider: structured ? "dsh" : "claude",
      kind: "question",
      name: "ask_user_question",
      input: {
        ...(structured ? { answerFormat: "structured" } : {}),
        questions: [
          {
            question: "Which color?",
            header: "color",
            options: [{ label: "Blue" }, { label: "Green" }],
            multiSelect,
            allowOther: true,
          },
        ],
      },
    },
  };
  const onRespond = vi.fn();
  act(() =>
    root.render(
      React.createElement(QuestionFormCard, {
        permission,
        onRespond,
        isResponding: false,
        submissionError,
      }),
    ),
  );
  return onRespond;
}

describe("question answer editing", () => {
  it("shows submission failure without clearing the answer and offers Retry", () => {
    renderQuestion(true);
    typeAnswer("Keep this answer");
    click('[data-testid="question-form-primary-action"]');
    const onRespond = renderQuestion(true, true, "Could not confirm your answer.");
    expect(element('[role="alert"]').textContent).toBe("Could not confirm your answer.");
    expect(element<HTMLInputElement>('input[aria-label="Which color?"]').value).toBe(
      "Keep this answer",
    );
    expect(element('[data-testid="question-form-primary-action"]').textContent).toBe("Retry");
    click('[data-testid="question-form-primary-action"]');
    expect(onRespond.mock.calls[0][0].updatedInput.structuredAnswers).toEqual({
      color: { selected: [], custom: "Keep this answer" },
    });
  });

  it.each(["choice-first", "text-first"])(
    "submits both parts of a structured multi-select answer (%s)",
    (order) => {
      const onRespond = renderQuestion(true);
      if (order === "choice-first") {
        click('[role="checkbox"][aria-label="Blue"]');
        typeAnswer("Include accessibility notes, please.");
      } else {
        typeAnswer("Include accessibility notes, please.");
        click('[role="checkbox"][aria-label="Blue"]');
      }
      expect(element('[role="checkbox"][aria-label="Blue"]').getAttribute("aria-checked")).toBe(
        "true",
      );
      expect(element<HTMLInputElement>('input[aria-label="Which color?"]').value).toBe(
        "Include accessibility notes, please.",
      );
      click('[data-testid="question-form-primary-action"]');
      expect(onRespond).toHaveBeenCalledOnce();
      expect(onRespond.mock.calls[0][0].updatedInput.structuredAnswers).toEqual({
        color: { selected: ["Blue"], custom: "Include accessibility notes, please." },
      });
    },
  );

  it.each([true, false])(
    "clears visible alternative text when selecting a legacy option (multiSelect=%s)",
    (multiSelect) => {
      const onRespond = renderQuestion(false, multiSelect);
      typeAnswer("An alternative");
      click(`[role="${multiSelect ? "checkbox" : "radio"}"][aria-label="Blue"]`);
      expect(element<HTMLInputElement>('input[aria-label="Which color?"]').value).toBe("");
      click('[data-testid="question-form-primary-action"]');
      expect(onRespond.mock.calls[0][0].updatedInput.answers).toEqual({ color: "Blue" });
      expect(onRespond.mock.calls[0][0].updatedInput).not.toHaveProperty("structuredAnswers");
    },
  );
});
