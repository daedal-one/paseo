import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { launchDshTestHost } from "../../../../../../../scripts/testing/dsh-host";
import { DshAgentClient } from "./agent.js";
import { DshConfigSchema, DshConnection } from "./connection.js";
import { z } from "zod";

async function launch(
  fixture: string,
  permissionMode = "workspace-write",
  profileControls = false,
) {
  const host = await launchDshTestHost(fixture, permissionMode, profileControls);
  const config = DshConfigSchema.parse(host.config);
  const native = new DshConnection(config);
  const client = new DshAgentClient(config);
  try {
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(await native.request("session/create", { request: { cwd: host.cwd } }));
    const imported = await client.importSession(
      { providerHandleId: sessionId, cwd: host.cwd },
      { storedConfig: { provider: "dsh", cwd: host.cwd } },
    );
    return {
      ...host,
      native,
      client,
      imported,
      sessionId,
      close: async () => {
        await client.shutdown();
        await native.close();
        await host.close();
      },
    };
  } catch (error) {
    await client.shutdown();
    await native.close();
    await host.close();
    throw error;
  }
}

test("attaches, streams a real DSH replay turn, and reloads the same durable session", async () => {
  const host = await launch("session/text-turn/session.v1.jsonl");
  try {
    const result = await host.imported.session.run(host.prompt);
    expect(result.sessionId).toBe(host.sessionId);
    expect(result.finalText).toBe("PONG");
    expect((await host.imported.session.getRuntimeInfo()).model).toContain("deepseek");
    await host.imported.session.close();
    const rows = await host.client.listImportableSessions({ cwd: host.cwd });
    expect(rows.map((row) => row.providerHandleId)).toEqual([host.sessionId]);
    const resumed = await host.client.resumeSession(host.imported.persistence);
    const text: string[] = [];
    for await (const event of resumed.streamHistory()) {
      if (event.type === "timeline" && event.item.type === "assistant_message")
        text.push(event.item.text);
    }
    expect(text.join("")).toBe("PONG");
  } finally {
    await host.close();
  }
}, 60_000);

test("answers an actual DSH tool approval and exposes the exact command", async () => {
  const host = await launch("web/approval-composer/session.v3.jsonl", "read-only");
  try {
    const approval = new Promise<string>((resolve, reject) =>
      host.imported.session.subscribe((event) => {
        if (event.type !== "permission_requested") return;
        try {
          expect(event.request.kind).toBe("tool");
          expect(event.request.detail?.type).toBe("plain_text");
          const detail = z.object({ text: z.string() }).parse(event.request.detail);
          expect(detail.text).toContain("notes.txt");
          void host.imported.session
            .respondToPermission(event.request.id, { behavior: "allow" })
            .then(() => resolve(event.request.id), reject);
        } catch (error) {
          reject(error);
        }
      }),
    );
    const [result] = await Promise.all([host.imported.session.run(host.prompt), approval]);
    expect(result.finalText).toBe("DONE");
    expect(await readFile(path.join(host.cwd, "notes.txt"), "utf8")).toContain("tok");
  } finally {
    await host.close();
  }
}, 60_000);

test("returns structured answers to an actual DSH multi-select question", async () => {
  const host = await launch("web/question-composer/session.v3.jsonl");
  try {
    const answer = new Promise<void>((resolve, reject) =>
      host.imported.session.subscribe((event) => {
        if (event.type !== "permission_requested") return;
        try {
          expect(event.request.kind).toBe("question");
          void host.imported.session
            .respondToPermission(event.request.id, {
              behavior: "allow",
              updatedInput: {
                structuredAnswers: {
                  color: { selected: ["Blue"], custom: "Include accessibility notes" },
                },
              },
            })
            .then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      }),
    );
    const [result] = await Promise.all([host.imported.session.run(host.prompt), answer]);
    expect(result.finalText).toBe("DONE");
    expect(host.imported.session.getPendingPermissions()).toEqual([]);
  } finally {
    await host.close();
  }
}, 60_000);

test("selects a real Host profile before its first turn and exposes permission modes in settings", async () => {
  const host = await launch("session/text-turn/session.v1.jsonl", "workspace-write", true);
  try {
    const features = await host.client.listFeatures({ provider: "dsh", cwd: host.cwd });
    const profile = features.find((feature) => feature.id === "dsh.agentPreset");
    expect(profile?.type).toBe("select");
    if (profile?.type !== "select") throw new Error("Missing DSH profiles");
    expect(profile.options.some((option) => option.id === "minimal")).toBe(true);
    const selected = await host.client.createSession({
      provider: "dsh",
      cwd: host.cwd,
      model: '["not-a-provider","must-not-override-profile"]',
      thinkingOptionId: "not-an-effort",
      featureValues: { "dsh.agentPreset": "minimal" },
    });
    expect(selected.features).toEqual([expect.objectContaining({ value: "minimal" })]);
    expect(await selected.getCurrentMode()).toBe("policy-reviewed");
    await selected.setMode("read-only");
    expect(await selected.getCurrentMode()).toBe("read-only");
    await selected.setMode("policy-reviewed");
    const result = await selected.run(host.prompt);
    expect(result.finalText).toBe("PONG");
    const persistence = selected.describePersistence();
    await selected.close();
    const resumed = await host.client.resumeSession(persistence);
    expect((await resumed.getRuntimeInfo()).model).toBe('["deepseek-official","deepseek-flash"]');
    expect(resumed.features).toEqual([expect.objectContaining({ value: "minimal" })]);
    expect(await resumed.getCurrentMode()).toBe("policy-reviewed");
    await expect(
      host.client.createSession({
        provider: "dsh",
        cwd: host.cwd,
        featureValues: { "dsh.agentPreset": "removed-profile" },
      }),
    ).rejects.toThrow();
  } finally {
    await host.close();
  }
}, 60_000);
