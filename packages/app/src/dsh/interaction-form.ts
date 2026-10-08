import type {
  ApprovalDecision,
  QuestionAnswer,
  SessionPendingInteraction,
} from "@deepseek-ai/dsh-client";

export interface DshQuestionDraft {
  selected: string[];
  custom: string;
  skipped: boolean;
}

export interface DshInteractionSnapshot {
  status: "editing" | "settling" | "settled" | "failed";
  drafts: readonly DshQuestionDraft[];
  canSubmit: boolean;
}

/** Local form drafts; the shared carrier owns cancellation and waterfall settlement. */
export class DshInteractionForm {
  private snapshot: DshInteractionSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(readonly request: SessionPendingInteraction) {
    const drafts =
      request.kind === "approval"
        ? []
        : request.questions.map(() => ({ selected: [], custom: "", skipped: false }));
    this.snapshot = { status: "editing", drafts, canSubmit: false };
  }

  getSnapshot = (): DshInteractionSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(status: DshInteractionSnapshot["status"], drafts = this.snapshot.drafts): void {
    const complete =
      drafts.length > 0 &&
      drafts.every(
        (draft) => draft.skipped || draft.selected.length > 0 || draft.custom.trim() !== "",
      );
    this.snapshot = { status, drafts, canSubmit: status === "editing" && complete };
    for (const listener of this.listeners) listener();
  }

  private replace(index: number, draft: DshQuestionDraft): void {
    if (this.snapshot.status !== "editing") return;
    this.publish(
      "editing",
      this.snapshot.drafts.map((previous, item) => (item === index ? draft : previous)),
    );
  }

  select(index: number, label: string): void {
    if (this.request.kind === "approval") return;
    const draft = this.snapshot.drafts[index];
    const question = this.request.questions[index];
    if (question.multiSelect === true) {
      const selected = draft.selected.includes(label)
        ? draft.selected.filter((value) => value !== label)
        : [...draft.selected, label];
      this.replace(index, { ...draft, selected, skipped: false });
    } else {
      this.replace(index, { selected: [label], custom: "", skipped: false });
    }
  }

  setText(index: number, custom: string): void {
    if (this.request.kind === "approval") return;
    const draft = this.snapshot.drafts[index];
    const question = this.request.questions[index];
    const selected = question.multiSelect === true ? draft.selected : [];
    this.replace(index, { selected, custom, skipped: false });
  }

  skip(index: number): void {
    this.replace(index, { selected: [], custom: "", skipped: true });
  }

  approve(decision: ApprovalDecision): Promise<boolean> {
    const request = this.request;
    if (request.kind !== "approval") return Promise.resolve(false);
    return this.settle(() => request.answer(decision));
  }

  submit(): Promise<boolean> {
    const request = this.request;
    if (request.kind === "approval" || !this.snapshot.canSubmit) return Promise.resolve(false);
    const answer: QuestionAnswer = {
      answers: request.questions.map((question, index) => {
        const draft = this.snapshot.drafts[index];
        const custom = draft.custom.trim();
        if (draft.skipped) return { id: question.id, selected: [] };
        return {
          id: question.id,
          selected: [...draft.selected],
          ...(custom === "" ? {} : { custom }),
        };
      }),
    };
    return this.settle(() => request.answer(answer));
  }

  cancel(): Promise<boolean> {
    const request = this.request;
    if (request.kind === "approval") return Promise.resolve(false);
    return this.settle(() => request.cancel());
  }

  private async settle(action: () => Promise<void>): Promise<boolean> {
    if (this.snapshot.status !== "editing") return false;
    this.publish("settling");
    try {
      await action();
    } catch {
      // Carrier settlement rejects when its request has already ended; it cannot be retried.
      this.publish("failed");
      return false;
    }
    this.publish("settled");
    return true;
  }
}
