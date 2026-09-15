import { z } from "zod";

export const DshEventSchema = z.object({
  type: z.string(),
  seq: z.number().int().nonnegative(),
  time: z.number(),
  data: z.unknown(),
  surfaceOp: z.unknown().optional(),
});
export type DshEvent = z.infer<typeof DshEventSchema>;
export const RecordSchema = z.object({
  type: z.literal("event"),
  event: DshEventSchema,
  detail: z.object({ kind: z.literal("tool-result"), bytes: z.number() }).optional(),
});
export const PageSchema = z.object({ records: z.array(RecordSchema), hasMore: z.boolean() });
export const SelectionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().optional(),
});
export const SnapshotSchema = PageSchema.extend({
  type: z.literal("snapshot"),
  cursor: z.number().int(),
  header: z.object({ id: z.string(), cwd: z.string().optional(), version: z.number() }),
  projections: z.object({ asOfSeq: z.number(), values: z.record(z.string(), z.unknown()) }),
  assistantStream: z.unknown().optional(),
});
export type DshSnapshot = z.infer<typeof SnapshotSchema>;
export const ListSchema = z.object({
  items: z.array(
    z.object({
      sessionId: z.string(),
      updatedAt: z.number(),
      running: z.boolean(),
      blank: z.boolean(),
      cwd: z.string().optional(),
      parentSessionId: z.string().optional(),
      projections: z.object({ values: z.record(z.string(), z.unknown()) }).optional(),
    }),
  ),
  hasMore: z.boolean(),
  nextCursor: z.string().optional(),
});
export const CatalogSchema = z.object({
  default: SelectionSchema,
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      models: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional(),
          reasoning: z
            .object({
              efforts: z.array(z.object({ id: z.string(), name: z.string() })),
              defaultEffort: z.string().optional(),
            })
            .optional(),
        }),
      ),
    }),
  ),
});
export const ContentSchema = z.array(z.looseObject({ type: z.string() }));
export const UserMessageSchema = z.object({
  id: z.string(),
  content: ContentSchema,
  source: z.object({ kind: z.string(), rpcId: z.string().optional() }),
});
export const ToolCallSchema = z.object({
  turn: z.number(),
  step: z.number(),
  callId: z.string(),
  name: z.string(),
  arguments: z.string(),
});
export const ToolResultSchema = z.object({
  turn: z.number(),
  step: z.number(),
  message: z.object({
    content: z.array(
      z.object({
        type: z.literal("tool-result"),
        toolCallId: z.string(),
        content: ContentSchema,
        isError: z.boolean().optional(),
      }),
    ),
  }),
});
export const AssistantSchema = z.object({
  turn: z.number(),
  step: z.number(),
  message: z.object({ id: z.string(), content: ContentSchema }),
});
export const TurnStartSchema = z.object({ turn: z.number() });
export const TurnEndSchema = TurnStartSchema.extend({
  reason: z.looseObject({ kind: z.string() }),
});
export const WaterfallSchema = z.object({
  type: z.literal("waterfall"),
  event: z.string(),
  eventId: z.string(),
  agentId: z.string(),
  request: z.record(z.string(), z.unknown()),
});
export type DshWaterfall = z.infer<typeof WaterfallSchema>;
export const QuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  header: z.string().optional(),
  detail: z.string().optional(),
  multiSelect: z.boolean().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })).optional(),
});
export const QuestionsSchema = z.object({ questions: z.array(QuestionSchema).min(1) });
