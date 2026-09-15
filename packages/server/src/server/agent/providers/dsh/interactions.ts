import { z } from "zod";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentStreamEvent,
} from "../../agent-sdk-types.js";
import type { DshSubscription, DshTransport } from "./connection.js";
import { QuestionsSchema, WaterfallSchema, type DshWaterfall } from "./wire.js";

interface PendingInteraction {
  frame: DshWaterfall;
  clientId: string;
  request: AgentPermissionRequest;
}

export class DshInteractions {
  private readonly listeners = new Map<string, (event: AgentStreamEvent) => void>();
  private readonly pending = new Map<string, PendingInteraction>();
  private subscription: DshSubscription | null = null;
  private opening: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly transport: DshTransport,
    private readonly reconnectDelayMs: number,
    private readonly requestTimeoutMs = 30_000,
  ) {}

  async register(
    sessionId: string,
    listener: (event: AgentStreamEvent) => void,
  ): Promise<() => void> {
    this.listeners.set(sessionId, listener);
    try {
      await this.start();
    } catch (error) {
      this.listeners.delete(sessionId);
      throw error;
    }
    return () => {
      this.listeners.delete(sessionId);
      for (const [id, pending] of this.pending) {
        if (pending.frame.agentId !== sessionId) continue;
        this.pending.delete(id);
        void this.reply(pending, { kind: "next" }).catch(() => this.disconnected());
      }
    };
  }

  list(sessionId: string): AgentPermissionRequest[] {
    return [...this.pending.values()]
      .filter((entry) => entry.frame.agentId === sessionId)
      .map((entry) => entry.request);
  }

  async respond(
    sessionId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void> {
    const pending = this.pending.get(requestId);
    if (!pending || pending.frame.agentId !== sessionId) {
      throw new Error("This DSH request has expired or was answered from another device.");
    }
    let outcome: Record<string, unknown>;
    if (pending.frame.event === "approval/request") {
      outcome = {
        kind: "result",
        value: response.behavior === "allow" ? "allowed-once" : "rejected",
      };
    } else if (response.behavior === "deny") {
      outcome = {
        kind: "rejected",
        error: { name: "Error", message: "Question dismissed by the user" },
      };
    } else {
      outcome = { kind: "result", value: questionAnswer(pending.frame, response.updatedInput) };
    }
    await this.reply(pending, outcome);
    if (this.pending.delete(requestId)) {
      this.listeners.get(sessionId)?.({
        type: "permission_resolved",
        provider: "dsh",
        requestId,
        resolution: response,
      });
    }
  }

  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.subscription?.close();
    this.subscription = null;
    this.pending.clear();
    this.listeners.clear();
  }

  private start(): Promise<void> {
    if (this.opening) return this.opening;
    if (this.subscription) return Promise.resolve();
    this.opening = new Promise<void>((resolve, reject) => {
      let clientId: string | null = null;
      const timeout = setTimeout(() => {
        reject(new Error("DSH interaction handshake timed out"));
        this.disconnected();
      }, this.requestTimeoutMs);
      void this.transport
        .open(
          "$events",
          {},
          {
            value: (value) => {
              if (clientId === null) {
                clientId = z
                  .object({ type: z.literal("ready"), clientId: z.string() })
                  .parse(value).clientId;
                clearTimeout(timeout);
                resolve();
                return;
              }
              this.receive(value, clientId);
            },
            error: (error) => {
              clearTimeout(timeout);
              reject(error);
              this.disconnected();
            },
          },
        )
        .then(
          (subscription) => {
            if (this.closed) subscription.close();
            else this.subscription = subscription;
            return undefined;
          },
          (error: unknown) => {
            clearTimeout(timeout);
            reject(error);
          },
        );
    }).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private receive(value: unknown, clientId: string): void {
    const tag = z.object({ type: z.string() }).parse(value).type;
    if (tag === "cancel") {
      const { eventId } = z.object({ eventId: z.string() }).parse(value);
      this.cancel(eventId);
      return;
    }
    if (tag !== "waterfall") return;
    const frame = WaterfallSchema.parse(value);
    const listener = this.listeners.get(frame.agentId);
    const supported =
      frame.event === "approval/request" || frame.event === "user-questions/request";
    if (!listener || !supported) {
      void this.transport
        .request("$events/result", { clientId, eventId: frame.eventId, outcome: { kind: "next" } })
        .catch(() => this.disconnected());
      return;
    }
    const request = permissionRequest(frame);
    this.pending.set(frame.eventId, { frame, clientId, request });
    listener({ type: "permission_requested", provider: "dsh", request });
  }

  private async reply(
    pending: PendingInteraction,
    outcome: Record<string, unknown>,
  ): Promise<void> {
    await this.transport.request("$events/result", {
      clientId: pending.clientId,
      eventId: pending.frame.eventId,
      outcome,
    });
  }

  private cancel(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.listeners.get(pending.frame.agentId)?.({
      type: "permission_resolved",
      provider: "dsh",
      requestId: id,
      resolution: { behavior: "deny", message: "DSH request is no longer pending" },
    });
  }

  private disconnected(): void {
    this.subscription?.close();
    this.subscription = null;
    for (const id of this.pending.keys()) this.cancel(id);
    if (this.closed || this.retry || this.listeners.size === 0) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.start().catch(() => this.disconnected());
    }, this.reconnectDelayMs);
    this.retry.unref();
  }
}

export function permissionRequest(frame: DshWaterfall): AgentPermissionRequest {
  if (frame.event === "approval/request") {
    const request = z
      .object({
        toolName: z.string(),
        callId: z.string().optional(),
        reason: z.string().optional(),
      })
      .parse(frame.request);
    return {
      id: frame.eventId,
      provider: "dsh",
      name: request.toolName,
      kind: "tool",
      title: `Allow ${request.toolName}?`,
      description: request.reason,
      metadata: request.callId ? { callId: request.callId } : undefined,
      actions: [
        { id: "allow-once", label: "Allow once", behavior: "allow", variant: "primary" },
        { id: "reject", label: "Reject", behavior: "deny", variant: "danger" },
      ],
    };
  }
  const { questions } = QuestionsSchema.parse(frame.request);
  return {
    id: frame.eventId,
    provider: "dsh",
    name: "ask_user",
    kind: "question",
    title: "DeepSeek Harness needs your input",
    input: {
      answerFormat: "structured",
      questions: questions.map((question) => ({
        question: question.detail
          ? `${question.question}\n\n${question.detail}`
          : question.question,
        header: question.id,
        options: question.options ?? [],
        multiSelect: question.multiSelect === true,
        allowOther: true,
      })),
    },
  };
}

export function questionAnswer(frame: DshWaterfall, input: unknown): unknown {
  const { questions } = QuestionsSchema.parse(frame.request);
  const response = z
    .object({
      structuredAnswers: z
        .record(
          z.string(),
          z.object({ selected: z.array(z.string()), custom: z.string().optional() }),
        )
        .optional(),
      answers: z.record(z.string(), z.string()).optional(),
    })
    .parse(input);
  const answers = questions.map((question) => {
    const structured = response.structuredAnswers?.[question.id];
    const plain = response.answers?.[question.id];
    if (structured) {
      const labels = new Set((question.options ?? []).map((option) => option.label));
      if (
        structured.selected.some((label) => !labels.has(label)) ||
        (!question.multiSelect && structured.selected.length > 1)
      ) {
        throw new Error("The selected DSH answers do not match this question.");
      }
      if (structured.selected.length === 0 && !structured.custom?.trim())
        throw new Error("Answer every DSH question.");
      return { id: question.id, selected: structured.selected, custom: structured.custom };
    }
    if (!plain?.trim()) throw new Error("Answer every DSH question.");
    if (question.multiSelect)
      throw new Error("Update the companion to answer multiple-choice DSH questions.");
    const selected = (question.options ?? []).some((option) => option.label === plain)
      ? [plain]
      : [];
    return { id: question.id, selected, custom: selected.length === 0 ? plain : undefined };
  });
  return { answers };
}
