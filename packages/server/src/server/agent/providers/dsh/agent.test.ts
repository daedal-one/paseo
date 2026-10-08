import { expect, test } from "vitest";
import { DshAgentClient } from "./agent.js";
import { DshTestTransport } from "./test-transport.js";

test("finds existing sessions by DSH title across listing pages", async () => {
  const transport = new DshTestTransport();
  const base = { updatedAt: 1000, running: false, blank: false, cwd: "/workspace" };
  transport.respond = ({ args }) =>
    Object.keys(args.request ?? {}).length === 0
      ? {
          items: [
            { ...base, sessionId: "child", parentSessionId: "parent" },
            { ...base, sessionId: "blank", blank: true },
          ],
          hasMore: true,
          nextCursor: "page-2",
        }
      : {
          items: [
            {
              ...base,
              sessionId: "native-session",
              projections: { values: { title: "Mobile companion" } },
            },
          ],
          hasMore: false,
        };
  const client = new DshAgentClient({ url: "http://127.0.0.1:3080" }, transport);
  try {
    expect(await client.listImportableSessions({ cwd: "/workspace", query: "COMPANION" })).toEqual([
      {
        providerHandleId: "native-session",
        cwd: "/workspace",
        title: "Mobile companion",
        firstPromptPreview: null,
        lastPromptPreview: null,
        lastActivityAt: new Date(1000),
      },
    ]);
    expect(transport.requests.map((request) => request.args)).toEqual([
      { request: {} },
      { request: { cursor: "page-2" } },
    ]);
  } finally {
    await client.shutdown();
  }
});

test("refuses to resume a native session against a different DSH host", async () => {
  const transport = new DshTestTransport();
  const client = new DshAgentClient({ url: "http://127.0.0.1:3080" }, transport);
  try {
    await expect(
      client.resumeSession({
        provider: "dsh",
        sessionId: "native-session",
        nativeHandle: "native-session",
        metadata: { origin: "http://127.0.0.1:3097", cwd: "/workspace" },
      }),
    ).rejects.toThrow("different host");
    expect(transport.requests).toEqual([]);
  } finally {
    await client.shutdown();
  }
});

const profileConfig = {
  provider: "dsh",
  cwd: "/workspace",
  featureValues: { "dsh.agentPreset": "review" },
  model: '["global","model"]',
  thinkingOptionId: "high",
};
function creationTransport() {
  const transport = new DshTestTransport();
  transport.initial = (endpoint) =>
    endpoint === "$events"
      ? { type: "ready", clientId: "client" }
      : {
          type: "snapshot",
          header: { id: "created", version: 3 },
          cursor: -1,
          records: [],
          hasMore: false,
          projections: {
            asOfSeq: -1,
            values: {
              agentPreset: "review",
              permissions: {
                currentValue: "workspace-write",
                options: [
                  { value: "workspace-write", name: "Workspace" },
                  { value: "policy-reviewed", name: "Policy reviewed" },
                ],
              },
            },
          },
        };
  transport.respond = ({ endpoint }) => {
    if (endpoint === "session/create") return { sessionId: "created" };
    if (endpoint === "commands/execute")
      return { commandId: "command", result: { kind: "success", text: "preset policy-reviewed" } };
    return { selected: { provider: "global", model: "model" } };
  };
  return transport;
}
test("offers healthy Host profiles and its deployment default without creating a Session", async () => {
  const transport = new DshTestTransport();
  transport.respond = () => ({
    presets: [
      { id: "standard", name: "Standard", isDefault: false },
      { id: "review", name: "Review", description: "Use the review model", isDefault: true },
      { id: "broken", isDefault: false, broken: "Invalid composition" },
    ],
  });
  const client = new DshAgentClient({ url: "http://127.0.0.1:3080" }, transport);
  try {
    const [profile] = await client.listFeatures(profileConfig);
    expect(profile).toMatchObject({
      type: "select",
      value: "review",
      options: [
        { id: "standard", label: "Standard" },
        { id: "review", label: "Review", description: "Use the review model" },
      ],
    });
    expect(transport.requests).toEqual([{ endpoint: "agentPresets/list", args: {} }]);
  } finally {
    await client.shutdown();
  }
});
test("creates the selected composition and policy-reviewed without overriding profile model settings", async () => {
  const transport = creationTransport();
  const client = new DshAgentClient({ url: "http://127.0.0.1:3080" }, transport);
  try {
    const session = await client.createSession(profileConfig);
    expect(transport.requests).toEqual([
      {
        endpoint: "session/create",
        args: { request: { cwd: "/workspace", agentPreset: "review" } },
      },
      {
        endpoint: "commands/execute",
        args: { agentId: "created", line: "/permission policy-reviewed", submittedAttachments: [] },
      },
    ]);
    expect(session.features[0]).toMatchObject({ value: "review" });
  } finally {
    await client.shutdown();
  }
});
test.each([false, true])(
  "honors explicit model selection for legacy clients or an opted-in override: %s",
  async (modern) => {
    const transport = creationTransport();
    const client = new DshAgentClient({ url: "http://127.0.0.1:3080" }, transport);
    try {
      await client.createSession({
        ...profileConfig,
        featureValues: modern
          ? { ...profileConfig.featureValues, "dsh.modelOverride": true }
          : undefined,
      });
      expect(
        transport.requests.filter((request) => request.endpoint === "session/selectModel"),
      ).toHaveLength(2);
    } finally {
      await client.shutdown();
    }
  },
);
test("does not retry creation or substitute the default when the selected profile is refused", async () => {
  const transport = creationTransport();
  transport.respond = () => {
    throw new Error("Selected profile was removed");
  };
  const client = new DshAgentClient({ url: "http://127.0.0.1:3080" }, transport);
  try {
    await expect(client.createSession(profileConfig)).rejects.toThrow("removed");
    expect(transport.requests).toHaveLength(1);
  } finally {
    await client.shutdown();
  }
});

test("lets the Host choose its default profile while its roster is loading", async () => {
  const transport = creationTransport();
  const client = new DshAgentClient({ url: "http://127.0.0.1:3080" }, transport);
  try {
    await client.createSession({
      ...profileConfig,
      featureValues: { "dsh.agentPreset": null, "dsh.modelOverride": false },
    });
    expect(transport.requests[0]).toEqual({
      endpoint: "session/create",
      args: { request: { cwd: "/workspace" } },
    });
    expect(transport.requests.some((request) => request.endpoint === "session/selectModel")).toBe(
      false,
    );
  } finally {
    await client.shutdown();
  }
});
