import { describe, expect, test } from "vitest";
import {
  areQuestionsAnswered,
  buildQuestionFormAnswers,
  buildStructuredQuestionFormAnswers,
  buildQuestionFormUpdatedInput,
  parseQuestionFormQuestions,
  questionShowsTextInput,
  resolveDismissLabel,
  shouldSubmitEmptyOnDismiss,
} from "./question-form-card-core";

describe("question form card core", () => {
  test("only adds structured answers when the requesting provider asks for them", () => {
    const questions = parseQuestionFormQuestions({
      questions: [{ question: "Choose", header: "Color", options: [{ label: "Blue" }] }],
    });
    if (!questions) throw new Error("questions did not parse");
    expect(buildQuestionFormUpdatedInput({}, questions, { 0: new Set([0]) }, {})).toEqual({
      answers: { Color: "Blue" },
    });
    expect(
      buildQuestionFormUpdatedInput(
        { answerFormat: "structured" },
        questions,
        { 0: new Set([0]) },
        {},
      ),
    ).toEqual({
      answerFormat: "structured",
      answers: { Color: "Blue" },
      structuredAnswers: { Color: { selected: ["Blue"] } },
    });
  });
  test("preserves selected labels containing commas and custom answers separately", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          header: "choice",
          question: "Choose",
          options: [{ label: "A, B" }, { label: "C" }],
          multiSelect: true,
        },
        { header: "comment", question: "Explain", options: [], allowOther: true },
      ],
    });
    if (!questions) throw new Error("questions did not parse");
    expect(
      buildStructuredQuestionFormAnswers(
        questions,
        { 0: new Set([0, 1]) },
        { 1: "  Because, yes  " },
      ),
    ).toEqual({
      choice: { selected: ["A, B", "C"] },
      comment: { selected: [], custom: "Because, yes" },
    });
  });
  test("treats optional input prompts as skippable empty answers", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Optional comment?",
          header: "Response",
          options: [],
          multiSelect: false,
          placeholder: "Optional comment (press Enter to skip)...",
          allowEmpty: true,
          dismissLabel: "Skip",
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    expect(areQuestionsAnswered(questions, {}, {})).toBe(true);
    expect(buildQuestionFormAnswers(questions, {}, {})).toEqual({ Response: "" });
    expect(shouldSubmitEmptyOnDismiss(questions)).toBe(true);
    expect(resolveDismissLabel(questions)).toBe("Skip");
  });

  test("requires a selection for option-only questions", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Pick one",
          header: "Response",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: false,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [question] = questions;
    if (!question) throw new Error("question missing");
    expect(questionShowsTextInput(question)).toBe(false);
    expect(areQuestionsAnswered(questions, {}, { 0: "freeform" })).toBe(false);
    expect(areQuestionsAnswered(questions, { 0: new Set([1]) }, {})).toBe(true);
    expect(buildQuestionFormAnswers(questions, { 0: new Set([1]) }, {})).toEqual({
      Response: "B",
    });
  });

  test("shows text input for explicit other questions", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Pick or type",
          header: "Response",
          options: [{ label: "A" }],
          isOther: true,
          multiSelect: false,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [question] = questions;
    if (!question) throw new Error("question missing");
    expect(questionShowsTextInput(question)).toBe(true);
    expect(areQuestionsAnswered(questions, {}, { 0: "custom" })).toBe(true);
    expect(buildQuestionFormAnswers(questions, {}, { 0: "custom" })).toEqual({
      Response: "custom",
    });
  });

  test("shows text input for questions that allow other answers", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Pick or type",
          header: "Response",
          options: [{ label: "A" }],
          allowOther: true,
          multiSelect: false,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [question] = questions;
    if (!question) throw new Error("question missing");
    expect(questionShowsTextInput(question)).toBe(true);
    expect(areQuestionsAnswered(questions, {}, { 0: "custom" })).toBe(true);
    expect(buildQuestionFormAnswers(questions, {}, { 0: "custom" })).toEqual({
      Response: "custom",
    });
  });
});
