import path from "node:path";
import { DSH_AGENT_PRESET, DSH_MODEL_OVERRIDE } from "@getpaseo/protocol/dsh-profiles";
import { z } from "zod";
import type {
  AgentClient,
  AgentFeature,
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentSessionConfig,
  FetchCatalogOptions,
  ImportableProviderSession,
  ImportProviderSessionContext,
  ImportProviderSessionInput,
  ImportedProviderSession,
  ListImportableSessionsOptions,
  ProviderCatalog,
  ProviderRefreshContext,
} from "../../agent-sdk-types.js";
import { DshConfigSchema, DshConnection, type DshTransport } from "./connection.js";
import { DshInteractions } from "./interactions.js";
import { DSH_CAPABILITIES, DshSession } from "./session.js";
import { AgentPresetRosterSchema, CatalogSchema, ListSchema } from "./wire.js";

export class DshAgentClient implements AgentClient {
  readonly provider = "dsh";
  readonly capabilities = DSH_CAPABILITIES;
  private readonly config;
  private readonly transport: DshTransport | null;
  private readonly interactions: DshInteractions | null;
  private readonly sessions = new Map<string, DshSession>();

  constructor(params?: unknown, transport?: DshTransport) {
    this.config = params === undefined ? null : DshConfigSchema.parse(params);
    this.transport = this.config ? (transport ?? new DshConnection(this.config)) : null;
    this.interactions =
      this.transport && this.config
        ? new DshInteractions(
            this.transport,
            this.config.reconnectDelayMs,
            this.config.requestTimeoutMs,
          )
        : null;
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    if (!this.transport) return false;
    CatalogSchema.parse(await this.transport.request("session/modelCatalog", {}, signal));
    return true;
  }

  async getDiagnostic() {
    return { diagnostic: "Connect the existing DSH Web host using npm run companion:setup." };
  }

  async fetchCatalog(
    _options: FetchCatalogOptions,
    context?: ProviderRefreshContext,
  ): Promise<ProviderCatalog> {
    const catalog = CatalogSchema.parse(
      await this.requireTransport().request("session/modelCatalog", {}, context?.signal),
    );
    return {
      modes: [],
      defaultModeId: null,
      models: catalog.groups.flatMap((group) =>
        group.models.map((model) => ({
          provider: "dsh",
          id: JSON.stringify([group.id, model.id]),
          label: `${group.name} · ${model.name}`,
          description: model.description,
          isDefault: group.id === catalog.default.provider && model.id === catalog.default.model,
          thinkingOptions: model.reasoning?.efforts.map((effort) => ({
            id: effort.id,
            label: effort.name,
          })),
          defaultThinkingOptionId: model.reasoning?.defaultEffort,
        })),
      ),
    };
  }

  async listFeatures(_config: AgentSessionConfig): Promise<AgentFeature[]> {
    const roster = AgentPresetRosterSchema.parse(
      await this.requireTransport().request("agentPresets/list", {}),
    );
    const presets = roster.presets.filter((preset) => preset.broken === undefined);
    return [
      {
        type: "select",
        id: DSH_AGENT_PRESET,
        label: "DSH profile",
        value: presets.find((preset) => preset.isDefault)?.id ?? null,
        options: presets.map((preset) => ({
          id: preset.id,
          label: preset.name ?? preset.id,
          description: preset.description,
          isDefault: preset.isDefault,
        })),
      },
      {
        type: "toggle",
        id: DSH_MODEL_OVERRIDE,
        label: "Override profile model",
        value: false,
      },
    ];
  }

  async listImportableSessions(
    options: ListImportableSessionsOptions = {},
  ): Promise<ImportableProviderSession[]> {
    const transport = this.requireTransport();
    const scanLimit = Math.min(500, Math.max(1, options.scanLimit ?? 500));
    const limit = Math.min(scanLimit, Math.max(1, options.limit ?? 100));
    const rows: ImportableProviderSession[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let scanned = 0;
    while (scanned < scanLimit && rows.length < limit) {
      const page = ListSchema.parse(
        await transport.request("session/list", { request: cursor ? { cursor } : {} }),
      );
      for (const row of page.items) {
        if (++scanned > scanLimit) break;
        const candidate = importableRow(row, options);
        if (!candidate) continue;
        rows.push(candidate);
        if (rows.length >= limit) break;
      }
      if (!page.hasMore || rows.length >= limit || scanned >= scanLimit) break;
      if (!page.nextCursor || cursors.has(page.nextCursor))
        throw new Error("DSH session listing did not advance.");
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    return rows;
  }

  async importSession(
    input: ImportProviderSessionInput,
    context: ImportProviderSessionContext,
  ): Promise<ImportedProviderSession> {
    const session = await this.attach(input.providerHandleId, input.cwd);
    const runtime = await session.getRuntimeInfo();
    const config: AgentSessionConfig = {
      ...context.storedConfig,
      provider: "dsh",
      cwd: input.cwd,
      model: runtime.model ?? undefined,
      thinkingOptionId: runtime.thinkingOptionId ?? undefined,
    };
    const timeline: ImportedProviderSession["timeline"] = [];
    for await (const event of session.streamHistory()) {
      if (event.type === "timeline")
        timeline.push({ item: event.item, timestamp: event.timestamp });
    }
    return { session, config, persistence: session.describePersistence(), timeline };
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
  ): Promise<DshSession> {
    if (!this.config || handle.metadata?.origin !== new URL(this.config.url).origin) {
      throw new Error(
        "The saved DSH session belongs to a different host. Import it from the correct host.",
      );
    }
    const metadata = z.object({ cwd: z.string() }).parse(handle.metadata);
    return this.attach(handle.nativeHandle ?? handle.sessionId, overrides?.cwd ?? metadata.cwd);
  }

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
  ): Promise<DshSession> {
    if (config.systemPrompt)
      throw new Error("DSH session instructions are configured by its profile.");
    const profileSelection = config.featureValues?.[DSH_AGENT_PRESET];
    const profileBased =
      config.featureValues !== undefined && Object.hasOwn(config.featureValues, DSH_AGENT_PRESET);
    const agentPreset = profileBased
      ? z.string().min(1).nullable().parse(profileSelection)
      : undefined;
    const response = await this.requireTransport().request("session/create", {
      request: { cwd: config.cwd, ...(agentPreset ? { agentPreset } : {}) },
    });
    const { sessionId } = z.object({ sessionId: z.string() }).parse(response);
    const session = await this.attach(sessionId, config.cwd);
    try {
      if (profileBased) {
        const modes = await session.getAvailableModes();
        if (modes.some((mode) => mode.id === "policy-reviewed")) {
          await session.setMode("policy-reviewed");
        }
      }
      // COMPAT(dshProfileDefaults): added in v0.8.0, remove after 2027-03-20 once all clients send the profile feature.
      if (!profileBased || config.featureValues?.[DSH_MODEL_OVERRIDE] === true) {
        if (config.model) await session.setModel(config.model);
        if (config.thinkingOptionId) await session.setThinkingOption(config.thinkingOptionId);
      }
      return session;
    } catch (error) {
      await session.close();
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
    this.interactions?.close();
    await this.transport?.close();
  }

  private requireTransport(): DshTransport {
    if (!this.transport)
      throw new Error("Configure the DSH Web connection with npm run companion:setup.");
    return this.transport;
  }

  private async attach(id: string, cwd: string): Promise<DshSession> {
    const transport = this.requireTransport();
    if (!this.config || !this.interactions) throw new Error("DSH connection is not configured.");
    const previous = this.sessions.get(id);
    if (previous) await previous.close();
    const session = new DshSession(id, cwd, transport, this.interactions, this.config);
    await session.initialize();
    this.sessions.set(id, session);
    return session;
  }
}

function importableRow(
  row: z.infer<typeof ListSchema>["items"][number],
  options: ListImportableSessionsOptions,
): ImportableProviderSession | null {
  if (!row.cwd || row.parentSessionId || row.blank) return null;
  if (options.cwd && path.resolve(row.cwd) !== path.resolve(options.cwd)) return null;
  const titleValue = z.string().nullable().safeParse(row.projections?.values.title);
  const title = titleValue.success ? titleValue.data : null;
  const descriptor = `${title ?? ""} ${row.cwd} ${row.sessionId}`.toLowerCase();
  if (options.query && !descriptor.includes(options.query.toLowerCase())) return null;
  return {
    providerHandleId: row.sessionId,
    cwd: row.cwd,
    title,
    firstPromptPreview: null,
    lastPromptPreview: null,
    lastActivityAt: new Date(row.updatedAt),
  };
}
