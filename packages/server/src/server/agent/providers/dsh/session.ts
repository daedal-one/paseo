import { DSH_AGENT_PRESET } from "@getpaseo/protocol/dsh-profiles";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  AgentCapabilityFlags,
  AgentFeature,
  AgentPermissionResponse,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentSession,
  AgentStreamEvent,
  SteerActiveTurnOptions,
  SteerResult,
} from "../../agent-sdk-types.js";
import {
  DshConnectionError,
  type DshConfig,
  type DshSubscription,
  type DshTransport,
} from "./connection.js";
import { DshInteractions } from "./interactions.js";
import { DshProjection } from "./projection.js";
import {
  PermissionSelectSchema,
  PageSchema,
  RecordSchema,
  SelectionSchema,
  SnapshotSchema,
  UserMessageSchema,
  type DshEvent,
  type DshSnapshot,
} from "./wire.js";

export const DSH_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsSessionListing: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

interface TurnReceipt {
  requestId: string;
  resolve(turnId: string): void;
  reject(error: Error): void;
}

export class DshSession implements AgentSession {
  readonly provider = "dsh";
  readonly capabilities = DSH_CAPABILITIES;
  private readonly projection: DshProjection;
  private readonly listeners = new Set<(event: AgentStreamEvent) => void>();
  private readonly history: AgentStreamEvent[] = [];
  private readonly waiting: AgentStreamEvent[] = [];
  private readonly interactionEvents: AgentStreamEvent[] = [];
  private readonly lifetime = new AbortController();
  private readonly inbox = new Map<string, z.infer<typeof UserMessageSchema>[]>();
  private subscription: DshSubscription | null = null;
  private unregisterInteractions: (() => void) | null = null;
  private cursor = -1;
  private followGeneration = 0;
  private reconnectAttempt = 0;
  private snapshot: DshSnapshot | null = null;
  private serial: Promise<void> = Promise.resolve();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private receipt: TurnReceipt | null = null;
  private connectionError: Error | null = null;
  private opening: Promise<void> | null = null;
  private agentPreset: string | null = null;
  private controlCursor = -1;
  private permissions: z.infer<typeof PermissionSelectSchema> | null = null;
  private selection: z.infer<typeof SelectionSchema> | null = null;

  constructor(
    readonly id: string,
    readonly cwd: string,
    private readonly transport: DshTransport,
    private readonly interactions: DshInteractions,
    private readonly config: DshConfig,
  ) {
    this.projection = new DshProjection(id, config.maxToolTextChars);
  }

  async initialize(): Promise<void> {
    this.unregisterInteractions = await this.interactions.register(this.id, (event) => {
      this.interactionEvents.push(event);
      this.serial = this.serial.then(() => this.flushInteractions());
    });
    try {
      await this.follow();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    this.assertConnected();
    if (options?.outputSchema || options?.maxThinkingTokens)
      throw new Error("DSH controls its own output and thinking configuration.");
    if (this.receipt) throw new Error("A DSH prompt is already awaiting admission.");
    const content = promptContent(prompt);
    const requestId = randomUUID();
    if (options?.clientMessageId) this.projection.submitted.set(requestId, options.clientMessageId);
    const receipt = new Promise<string>((resolve, reject) => {
      this.receipt = { requestId, resolve, reject };
    });
    // A failed HTTP response does not authorize resending a potentially accepted prompt.
    const timeout = setTimeout(() => {
      this.receipt?.reject(
        new Error("DSH accepted-state is uncertain. Check the session before sending again."),
      );
      this.receipt = null;
    }, this.config.requestTimeoutMs);
    try {
      const request = this.transport.request(
        "session/prompt",
        {
          request: { requestId, sessionId: this.id, mode: "queue", content },
        },
        this.lifetime.signal,
      );
      const [, turnId] = await Promise.all([request, receipt]);
      return { turnId };
    } finally {
      clearTimeout(timeout);
      this.receipt = null;
    }
  }

  async steerActiveTurn(
    prompt: AgentPromptInput,
    options: SteerActiveTurnOptions,
  ): Promise<SteerResult> {
    this.assertConnected();
    if (options.expectedTurnId !== this.projection.turnId || options.clearPendingPermissions) {
      return { status: "unavailable" };
    }
    const requestId = randomUUID();
    if (options.clientMessageId) this.projection.submitted.set(requestId, options.clientMessageId);
    await this.transport.request(
      "session/prompt",
      {
        request: { requestId, sessionId: this.id, mode: "steer", content: promptContent(prompt) },
      },
      this.lifetime.signal,
    );
    return { status: "accepted" };
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    const timeline: AgentRunResult["timeline"] = [];
    let unsubscribe = () => {};
    const completion = new Promise<AgentRunResult>((resolve, reject) => {
      unsubscribe = this.subscribe((event) => {
        if (event.type === "timeline") timeline.push(event.item);
        if (event.type === "turn_failed") reject(new Error(event.error));
        if (event.type === "turn_completed" || event.type === "turn_canceled") {
          const finalText = timeline
            .filter((item) => item.type === "assistant_message")
            .map((item) => item.text)
            .join("");
          resolve({
            sessionId: this.id,
            finalText,
            timeline,
            canceled: event.type === "turn_canceled",
          });
        }
      });
    });
    try {
      const [, result] = await Promise.all([this.startTurn(prompt, options), completion]);
      return result;
    } finally {
      unsubscribe();
    }
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.listeners.add(callback);
    for (const event of this.waiting.splice(0)) callback(event);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    yield* this.history;
  }

  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.selection
        ? JSON.stringify([this.selection.provider, this.selection.model])
        : null,
      thinkingOptionId: this.selection?.reasoningEffort ?? null,
      modeId: this.permissions?.currentValue ?? null,
      extra: { connection: this.connectionError ? "disconnected" : "connected" },
    };
  }
  get features(): AgentFeature[] {
    return this.agentPreset === null
      ? []
      : [
          {
            type: "select",
            id: DSH_AGENT_PRESET,
            label: "DSH profile",
            value: this.agentPreset,
            options: [{ id: this.agentPreset, label: this.agentPreset }],
          },
        ];
  }
  async getAvailableModes() {
    return (this.permissions?.options ?? [])
      .filter((option) => option.value !== "custom")
      .map((option) => ({
        id: option.value,
        label: option.name,
        description: option.description,
      }));
  }
  async getCurrentMode() {
    return this.permissions?.currentValue ?? null;
  }
  async setMode(modeId: string): Promise<void> {
    this.assertConnected();
    if (!(await this.getAvailableModes()).some((mode) => mode.id === modeId)) {
      throw new Error("This DSH session does not offer that permission mode.");
    }
    const value = await this.transport.request(
      "commands/execute",
      {
        agentId: this.id,
        line: `/permission ${modeId}`,
        submittedAttachments: [],
      },
      this.lifetime.signal,
    );
    const response = z
      .object({ result: z.object({ kind: z.string(), text: z.string().optional() }) })
      .parse(value);
    if (response.result.kind !== "success")
      throw new Error(response.result.text ?? "DSH refused the permission change.");
    await this.refreshControls();
  }

  /** Read one authoritative projection cut, then detach the temporary reader. */
  private async refreshControls(): Promise<void> {
    this.lifetime.signal.throwIfAborted();
    let subscription: DshSubscription | undefined;
    let release = () => {};
    try {
      const snapshot = await new Promise<DshSnapshot>((resolve, reject) => {
        const abort = () => reject(new Error("DSH companion detached"));
        const timeout = setTimeout(
          () => reject(new Error("DSH control refresh timed out")),
          this.config.requestTimeoutMs,
        );
        this.lifetime.signal.addEventListener("abort", abort, { once: true });
        let settled = false;
        release = () => {
          settled = true;
          clearTimeout(timeout);
          this.lifetime.signal.removeEventListener("abort", abort);
        };
        void this.transport
          .open(
            "session/follow",
            {
              request: { address: { kind: "session", sessionId: this.id }, maxMessages: 1 },
            },
            {
              value: (value) => {
                if (settled) return;
                const parsed = SnapshotSchema.safeParse(value);
                if (parsed.success) resolve(parsed.data);
                else reject(new Error("Invalid DSH control snapshot"));
                release();
              },
              error: reject,
            },
          )
          .then((reader) => {
            if (settled) reader.close();
            else subscription = reader;
            return undefined;
          }, reject);
      });
      this.lifetime.signal.throwIfAborted();
      if (snapshot.header.id !== this.id) throw new Error("DSH control snapshot identity changed");
      this.acceptControls(snapshot);
      this.emit({
        type: "model_changed",
        provider: "dsh",
        runtimeInfo: await this.getRuntimeInfo(),
      });
      this.emit({
        type: "mode_changed",
        provider: "dsh",
        currentModeId: this.permissions?.currentValue ?? null,
        availableModes: await this.getAvailableModes(),
      });
    } finally {
      release();
      subscription?.close();
    }
  }

  private acceptControls(snapshot: DshSnapshot): void {
    if (snapshot.cursor < this.controlCursor) return;
    this.controlCursor = snapshot.cursor;
    const permissions = PermissionSelectSchema.safeParse(snapshot.projections.values.permissions);
    this.permissions = permissions.success ? permissions.data : null;
    const selection = z
      .object({ next: SelectionSchema.nullable() })
      .safeParse(snapshot.projections.values.modelSelection);
    if (selection.success) this.selection = selection.data.next;
  }

  getPendingPermissions() {
    return this.interactions.list(this.id);
  }
  async respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void> {
    this.lifetime.signal.throwIfAborted();
    // The interaction stream owns request validity independently of transcript catch-up.
    await this.interactions.respond(this.id, requestId, response);
  }
  describePersistence() {
    return {
      provider: "dsh",
      sessionId: this.id,
      nativeHandle: this.id,
      metadata: { origin: new URL(this.config.url).origin, cwd: this.cwd },
    };
  }
  async setModel(modelId: string | null): Promise<void> {
    if (!modelId) throw new Error("Select an explicit DSH model.");
    const [provider, model] = z.tuple([z.string(), z.string()]).parse(JSON.parse(modelId));
    await this.selectModel({ provider, model });
  }
  async setThinkingOption(reasoningEffort: string | null): Promise<void> {
    if (!this.selection) throw new Error("Select a DSH model before changing reasoning effort.");
    const { provider, model } = this.selection;
    await this.selectModel({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) });
  }
  async interrupt(): Promise<void> {
    this.assertConnected();
    if (this.projection.turn === null) return;
    let unsubscribe = () => {};
    let timeout: ReturnType<typeof setTimeout>;
    const completion = new Promise<void>((resolve, reject) => {
      unsubscribe = this.subscribe((event) => {
        if (["turn_completed", "turn_canceled", "turn_failed"].includes(event.type)) resolve();
      });
      timeout = setTimeout(
        () => reject(new Error("DSH cancellation could not be confirmed.")),
        this.config.requestTimeoutMs,
      );
    });
    try {
      await Promise.all([
        this.transport.request(
          "session/cancel",
          { request: { sessionId: this.id } },
          this.lifetime.signal,
        ),
        completion,
      ]);
    } finally {
      clearTimeout(timeout!);
      unsubscribe();
    }
  }
  async close(): Promise<void> {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    if (this.retry) clearTimeout(this.retry);
    this.subscription?.close();
    this.unregisterInteractions?.();
    this.receipt?.reject(new Error("DSH companion detached"));
    this.listeners.clear();
    this.waiting.length = 0;
    await this.serial;
  }

  private async selectModel(selection: z.infer<typeof SelectionSchema>): Promise<void> {
    this.assertConnected();
    const response = await this.transport.request(
      "session/selectModel",
      {
        request: { sessionId: this.id, ...selection },
      },
      this.lifetime.signal,
    );
    this.selection = z.object({ selected: SelectionSchema }).parse(response).selected;
    this.emit({ type: "model_changed", provider: "dsh", runtimeInfo: await this.getRuntimeInfo() });
  }

  private isCurrentFollow(generation: number): boolean {
    return generation === this.followGeneration && !this.lifetime.signal.aborted;
  }

  private follow(): Promise<void> {
    if (this.opening) return this.opening;
    const generation = ++this.followGeneration;
    const current = () => this.isCurrentFollow(generation);
    let releaseAbort = () => {};
    this.opening = new Promise<void>((resolve, reject) => {
      let opened = false;
      const timeout = setTimeout(() => {
        if (!current()) return;
        const error = new Error("DSH session snapshot timed out");
        reject(error);
        this.disconnected(error);
      }, this.config.requestTimeoutMs);
      const abort = () => {
        clearTimeout(timeout);
        reject(new Error("DSH companion detached"));
      };
      this.lifetime.signal.addEventListener("abort", abort, { once: true });
      releaseAbort = () => this.lifetime.signal.removeEventListener("abort", abort);
      if (this.lifetime.signal.aborted) {
        abort();
        return;
      }
      void this.transport
        .open(
          "session/follow",
          {
            request: {
              address: { kind: "session", sessionId: this.id },
              maxMessages: 50,
              assistantStream: true,
            },
          },
          {
            value: (value) => {
              this.serial = this.serial
                .then(async () => {
                  if (!current()) return undefined;
                  if (!opened) {
                    await this.acceptSnapshot(SnapshotSchema.parse(value), generation);
                    if (!current()) return undefined;
                    opened = true;
                    this.reconnectAttempt = 0;
                    this.connectionError = null;
                    clearTimeout(timeout);
                    resolve();
                  } else {
                    const incoming = z
                      .object({ type: z.string(), frame: z.unknown().optional() })
                      .parse(value);
                    if (incoming.type === "assistant-stream") {
                      for (const event of this.projection.acceptStream(incoming.frame)) {
                        this.history.push(event);
                        this.emit(event);
                      }
                    } else await this.acceptRecord(RecordSchema.parse(value), false, generation);
                  }
                  return undefined;
                })
                .catch((error: unknown) => {
                  if (!current()) return;
                  const failure =
                    error instanceof Error ? error : new Error("Invalid DSH session update");
                  clearTimeout(timeout);
                  reject(failure);
                  this.disconnected(failure);
                });
            },
            error: (error) => {
              if (!current()) return;
              clearTimeout(timeout);
              reject(error);
              this.disconnected(error);
            },
          },
        )
        .then(
          (subscription) => {
            if (!current()) subscription.close();
            else this.subscription = subscription;
            return undefined;
          },
          (error: unknown) => {
            clearTimeout(timeout);
            reject(error);
          },
        );
    }).finally(() => {
      releaseAbort();
      this.opening = null;
    });
    return this.opening;
  }

  private async acceptSnapshot(snapshot: DshSnapshot, generation: number): Promise<void> {
    if (
      snapshot.header.id !== this.id ||
      (snapshot.header.cwd && snapshot.header.cwd !== this.cwd)
    ) {
      throw new DshConnectionError("DSH session identity or workspace changed", "session/identity");
    }
    if (snapshot.cursor < this.cursor)
      throw new DshConnectionError("DSH session history moved backwards", "session/history");
    const initial = this.snapshot === null;
    const pages = [snapshot.records];
    let records = snapshot.records;
    let hasMore = snapshot.hasMore;
    while (hasMore && (records.length === 0 || records[0].event.seq > this.cursor + 1)) {
      const beforeSeq = records[0]?.event.seq;
      if (beforeSeq === undefined)
        throw new DshConnectionError("DSH history page has no cursor", "protocol");
      const page = PageSchema.parse(
        await this.transport.request(
          "session/page",
          {
            request: {
              address: { kind: "session", sessionId: this.id },
              throughSeq: snapshot.cursor,
              beforeSeq,
              maxMessages: 50,
            },
          },
          this.lifetime.signal,
        ),
      );
      if (!this.isCurrentFollow(generation)) return;
      if (page.records.length === 0 || page.records.at(-1)!.event.seq >= beforeSeq) {
        throw new DshConnectionError("DSH history pagination did not advance", "protocol");
      }
      pages.push(page.records);
      records = page.records;
      hasMore = page.hasMore;
    }
    for (const record of pages.toReversed().flat()) {
      await this.acceptRecord(record, initial, generation);
      if (!this.isCurrentFollow(generation)) return;
    }
    if (this.cursor !== snapshot.cursor)
      throw new DshConnectionError("DSH snapshot has a history gap", "protocol");
    const preset = z.string().nullable().safeParse(snapshot.projections.values.agentPreset);
    this.agentPreset = preset.success ? preset.data : null;
    this.acceptControls(snapshot);
    this.snapshot = snapshot;
    this.flushInteractions();
    this.restoreAssistant(snapshot, initial);
  }

  private restoreAssistant(snapshot: DshSnapshot, initial: boolean): void {
    if (snapshot.assistantStream) {
      for (const event of this.projection.restoreStream(snapshot.assistantStream)) {
        this.history.push(event);
        if (!initial) this.emit(event);
      }
    }
    if (initial && this.projection.turnId) {
      this.emit({ type: "turn_started", provider: "dsh", turnId: this.projection.turnId });
    }
  }

  private async acceptRecord(
    record: z.infer<typeof RecordSchema>,
    initial: boolean,
    generation: number,
  ): Promise<void> {
    if (!this.isCurrentFollow(generation)) return;
    if (record.event.seq <= this.cursor) return;
    if (record.event.seq !== this.cursor + 1)
      throw new DshConnectionError("DSH live history has a sequence gap", "protocol");
    let event = record.event;
    if (record.detail) {
      const complete = RecordSchema.parse(
        await this.transport.request(
          "session/historyDetail",
          {
            request: { address: { kind: "session", sessionId: this.id }, seq: event.seq },
          },
          this.lifetime.signal,
        ),
      );
      if (!this.isCurrentFollow(generation)) return;
      if (complete.event.seq !== event.seq)
        throw new DshConnectionError("DSH tool detail identity mismatch", "protocol");
      event = complete.event;
    }
    const events = this.projection.accept(event);
    this.cursor = event.seq;
    this.history.push(...events);
    this.acceptReceipt(event);
    if (initial) return;
    if (
      [
        "permission/preset",
        "sandbox/mode",
        "approval/policy",
        "model/selection",
        "request/header",
      ].includes(event.type) &&
      event.seq > this.controlCursor
    ) {
      await this.refreshControls();
    }
    for (const projected of events) this.emit(projected);
  }

  private acceptReceipt(event: DshEvent): void {
    if (event.type === "agent/inbox/spliced") {
      const splice = z
        .object({
          target: z.string(),
          start: z.number().int().nonnegative(),
          removedCount: z.number().int().nonnegative().optional(),
          inserted: z.array(UserMessageSchema),
          outcome: z.literal("canceled").optional(),
        })
        .parse(event.data);
      const pending = this.inbox.get(splice.target) ?? [];
      const removed = pending.splice(splice.start, splice.removedCount ?? 0, ...splice.inserted);
      this.inbox.set(splice.target, pending);
      if (
        this.receipt &&
        removed.some((message) => message.source.rpcId === this.receipt?.requestId)
      ) {
        if (splice.outcome === "canceled")
          this.receipt.reject(new Error("DSH removed the queued message before running it."));
        else if (this.projection.turnId) this.receipt.resolve(this.projection.turnId);
      }
    }
    if (!this.receipt || !this.projection.turnId) return;
    if (event.type !== "user/message") return;
    const message = z
      .object({ source: z.object({ rpcId: z.string().optional() }) })
      .parse(event.data);
    if (message.source.rpcId === this.receipt.requestId)
      this.receipt.resolve(this.projection.turnId);
  }

  private disconnected(error: Error): void {
    this.followGeneration++;
    this.subscription?.close();
    this.subscription = null;
    const firstFailure = this.connectionError === null;
    this.connectionError = error;
    this.receipt?.reject(error);
    if (this.lifetime.signal.aborted || this.retry) return;
    if (firstFailure && this.snapshot) {
      this.emit({
        type: "timeline",
        provider: "dsh",
        item: {
          type: "error",
          message: "DSH connection lost. Reconnecting; work continues on the host.",
        },
      });
    }
    const delay = Math.min(
      this.config.reconnectDelayMs * 2 ** Math.min(this.reconnectAttempt++, 16),
      this.config.reconnectMaxDelayMs,
    );
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.reconnect();
    }, delay);
    this.retry.unref();
  }

  private async reconnect(): Promise<void> {
    try {
      await this.follow();
    } catch (error) {
      this.disconnected(error instanceof Error ? error : new Error("DSH reconnection failed"));
    }
  }

  private assertConnected(): void {
    this.lifetime.signal.throwIfAborted();
    if (this.connectionError) throw this.connectionError;
    if (!this.snapshot) throw new Error("DSH session is still connecting.");
  }

  private flushInteractions(): void {
    if (!this.snapshot) return;
    for (const event of this.interactionEvents.splice(0)) {
      if (event.type === "permission_requested") {
        const callId = event.request.metadata?.callId;
        if (typeof callId === "string")
          event.request.detail = this.projection.getToolDetail(callId);
      }
      this.emit(event);
    }
  }

  private emit(event: AgentStreamEvent): void {
    if (this.lifetime.signal.aborted) return;
    if (this.listeners.size === 0) this.waiting.push(event);
    else for (const listener of this.listeners) listener(event);
  }
}

function promptContent(prompt: AgentPromptInput) {
  if (typeof prompt === "string") {
    if (!prompt.trim()) throw new Error("Enter a message for DSH.");
    return [{ type: "text", text: prompt }];
  }
  return prompt.map((block) => {
    if (block.type === "text") return block;
    if (block.type === "image")
      return { type: "image", mediaType: block.mimeType, data: block.data };
    throw new Error("This attachment type is not supported by the DSH companion.");
  });
}
