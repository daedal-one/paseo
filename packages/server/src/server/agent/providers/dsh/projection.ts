import type { AgentStreamEvent, AgentTimelineItem, ToolCallDetail } from "../../agent-sdk-types.js";
import { z } from "zod";
import {
  AssistantSchema,
  ToolCallSchema,
  ToolResultSchema,
  TurnEndSchema,
  TurnStartSchema,
  UserMessageSchema,
  type DshEvent,
} from "./wire.js";

export function contentText(content: Array<{ type: string; [key: string]: unknown }>): string {
  return content
    .map((block) => {
      if (typeof block.text === "string") return block.text;
      if (block.type === "image") return "[Image]";
      return "";
    })
    .join("");
}

export class DshProjection {
  readonly submitted = new Map<string, string>();
  private readonly calls = new Map<string, { name: string; arguments: string }>();
  private readonly attempts = new Map<
    string,
    { turn: number; step: number; text: string; reasoning: string; nextIndex: number }
  >();
  turn: number | null = null;

  constructor(
    readonly sessionId: string,
    private readonly maxToolTextChars = 16_384,
  ) {}

  get turnId(): string | undefined {
    return this.turn === null ? undefined : `${this.sessionId}:${this.turn}`;
  }

  getToolDetail(callId: string): ToolCallDetail | undefined {
    const call = this.calls.get(callId);
    return call ? this.toolDetail(call.name, call.arguments) : undefined;
  }

  accept(event: DshEvent): AgentStreamEvent[] {
    switch (event.type) {
      case "turn/start": {
        this.turn = TurnStartSchema.parse(event.data).turn;
        return [{ type: "turn_started", provider: "dsh", turnId: this.turnId }];
      }
      case "turn/end": {
        const { turn, reason } = TurnEndSchema.parse(event.data);
        const turnId = `${this.sessionId}:${turn}`;
        this.turn = null;
        if (reason.kind === "interrupted" || reason.kind === "aborted") {
          return [{ type: "turn_canceled", provider: "dsh", turnId, reason: reason.kind }];
        }
        if (reason.kind === "error") {
          return [
            {
              type: "turn_failed",
              provider: "dsh",
              turnId,
              error: z.object({ message: z.string() }).parse(reason.error).message,
            },
          ];
        }
        return [{ type: "turn_completed", provider: "dsh", turnId }];
      }
      case "user/message": {
        const message = UserMessageSchema.parse(event.data);
        if (message.source.kind !== "user") return [];
        const clientMessageId = message.source.rpcId
          ? this.submitted.get(message.source.rpcId)
          : undefined;
        return this.timeline(event, {
          type: "user_message",
          text: contentText(message.content),
          messageId: message.id,
          ...(clientMessageId ? { clientMessageId } : {}),
        });
      }
      case "assistant/message":
        return this.acceptAssistant(event);
      case "assistant/attempt": {
        const { turn, step } = z.object({ turn: z.number(), step: z.number() }).parse(event.data);
        for (const [id, attempt] of this.attempts) {
          if (attempt.turn !== turn || attempt.step !== step) continue;
          this.attempts.delete(id);
          return this.timeline(event, {
            type: "error",
            message: "DSH did not commit this response attempt.",
          });
        }
        return [];
      }
      case "tool/call": {
        const call = ToolCallSchema.parse(event.data);
        this.calls.set(call.callId, call);
        return this.timeline(event, {
          type: "tool_call",
          callId: call.callId,
          name: call.name,
          status: "running",
          error: null,
          detail: this.toolDetail(call.name, call.arguments),
        });
      }
      case "tool/result": {
        const { message } = ToolResultSchema.parse(event.data);
        return message.content.flatMap((block) => {
          const call = this.calls.get(block.toolCallId);
          const name = call ? call.name : "Tool";
          const args = call ? call.arguments : "";
          const output = this.boundToolText(contentText(block.content));
          const detail = this.toolDetail(name, args, output);
          return this.timeline(
            event,
            block.isError
              ? {
                  type: "tool_call",
                  callId: block.toolCallId,
                  name,
                  status: "failed",
                  error: output,
                  detail,
                }
              : {
                  type: "tool_call",
                  callId: block.toolCallId,
                  name,
                  status: "completed",
                  error: null,
                  detail,
                },
          );
        });
      }
      default:
        // Plugin-owned events that do not contribute Paseo transcript items stay in DSH's log.
        return [];
    }
  }

  private acceptAssistant(event: DshEvent): AgentStreamEvent[] {
    const { message, turn, step } = AssistantSchema.parse(event.data);
    const attemptEntry = [...this.attempts].findLast(
      ([, value]) => value.turn === turn && value.step === step,
    );
    const attempt = attemptEntry?.[1];
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    const reasoning = message.content
      .filter((block) => block.type === "reasoning")
      .map((block) => block.text)
      .join("");
    const remainingText = undelivered(text, attempt?.text ?? "");
    const remainingReasoning = undelivered(reasoning, attempt?.reasoning ?? "");
    const events: AgentStreamEvent[] = [];
    if (remainingReasoning)
      events.push(...this.timeline(event, { type: "reasoning", text: remainingReasoning }));
    if (remainingText)
      events.push(
        ...this.timeline(event, {
          type: "assistant_message",
          text: remainingText,
          messageId: attemptEntry?.[0] ?? message.id,
        }),
      );
    if (attemptEntry) this.attempts.delete(attemptEntry[0]);
    return events;
  }

  acceptStream(value: unknown): AgentStreamEvent[] {
    const frame = z.looseObject({ type: z.string(), attemptId: z.string() }).parse(value);
    if (frame.type === "start") {
      const start = z.object({ turn: z.number(), step: z.number() }).parse(frame);
      if (!this.attempts.has(frame.attemptId)) {
        this.attempts.set(frame.attemptId, { ...start, text: "", reasoning: "", nextIndex: 0 });
      }
      return [];
    }
    if (frame.type !== "chunk") return [];
    const chunkFrame = z
      .object({ index: z.number().int(), chunk: z.looseObject({ type: z.string() }) })
      .parse(frame);
    const attempt = this.attempts.get(frame.attemptId);
    if (!attempt) throw new Error("DSH assistant stream has no opening frame");
    if (chunkFrame.index < attempt.nextIndex) return [];
    if (chunkFrame.index !== attempt.nextIndex)
      throw new Error("DSH assistant stream has a missing chunk");
    attempt.nextIndex++;
    const { chunk } = chunkFrame;
    if (chunk.type !== "text-delta" && chunk.type !== "reasoning-delta") return [];
    const { text } = z.object({ text: z.string() }).parse(chunk);
    const item: AgentTimelineItem =
      chunk.type === "text-delta"
        ? { type: "assistant_message", text, messageId: frame.attemptId }
        : { type: "reasoning", text };
    if (chunk.type === "text-delta") attempt.text += text;
    else attempt.reasoning += text;
    return [
      { type: "timeline", provider: "dsh", turnId: `${this.sessionId}:${attempt.turn}`, item },
    ];
  }

  restoreStream(value: unknown): AgentStreamEvent[] {
    const baseline = z
      .object({
        activeAttempt: z
          .object({
            attemptId: z.string(),
            turn: z.number(),
            step: z.number(),
            nextIndex: z.number().int(),
            stream: z.array(z.unknown()),
          })
          .optional(),
      })
      .parse(value);
    if (!baseline.activeAttempt) return [];
    const attempt = baseline.activeAttempt;
    this.acceptStream({ type: "start", ...attempt });
    let index = 0;
    const events: AgentStreamEvent[] = [];
    for (const raw of attempt.stream) {
      const record = z.looseObject({ type: z.string() }).parse(raw);
      if (record.type === "chunk") {
        events.push(
          ...this.acceptStream({
            type: "chunk",
            attemptId: attempt.attemptId,
            index: index++,
            chunk: record.chunk,
          }),
        );
      } else {
        const run = z
          .object({ dt: z.array(z.number()), texts: z.array(z.string()).optional() })
          .parse(record);
        for (let offset = 0; offset <= run.dt.length; offset++) {
          const text = run.texts?.[offset];
          let chunk: Record<string, unknown> = { type: "tool-call-delta" };
          if (record.type === "text-chunks") chunk = { type: "text-delta", text };
          if (record.type === "reasoning-chunks") chunk = { type: "reasoning-delta", text };
          events.push(
            ...this.acceptStream({
              type: "chunk",
              attemptId: attempt.attemptId,
              index: index++,
              chunk,
            }),
          );
        }
      }
    }
    if (index !== attempt.nextIndex) throw new Error("DSH assistant baseline is incomplete");
    return events;
  }

  private boundToolText(text: string): string {
    if (text.length <= this.maxToolTextChars) return text;
    const suffix = "\n\n[Preview truncated. Full result remains in DSH Web.]";
    return text.slice(0, this.maxToolTextChars - suffix.length) + suffix;
  }

  private toolDetail(name: string, input: string, output?: string): ToolCallDetail {
    return {
      type: "plain_text",
      label: name,
      text: this.boundToolText(output === undefined ? input : `${input}\n\n${output}`),
    };
  }

  private timeline(event: DshEvent, item: AgentTimelineItem): AgentStreamEvent[] {
    return [
      {
        type: "timeline",
        provider: "dsh",
        item,
        timestamp: new Date(event.time).toISOString(),
        ...(this.turnId ? { turnId: this.turnId } : {}),
      },
    ];
  }
}

function undelivered(committed: string, delivered: string): string {
  if (committed.startsWith(delivered)) return committed.slice(delivered.length);
  // Finalized blocks can remove trailing whitespace from the provider's deltas.
  if (committed.trimEnd() === delivered.trimEnd()) return "";
  throw new Error("DSH committed response differs from its streamed prefix");
}
