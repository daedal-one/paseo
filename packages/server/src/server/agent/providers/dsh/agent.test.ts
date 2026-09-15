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
