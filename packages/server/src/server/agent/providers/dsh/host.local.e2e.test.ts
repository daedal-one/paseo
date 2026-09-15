import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { z } from "zod";
import { DshAgentClient } from "./agent.js";
import { DshConfigSchema, DshConnection } from "./connection.js";
import { UserMessageSchema } from "./wire.js";

const fork = fileURLToPath(new URL("../../../../../../..", import.meta.url));
const repository = process.env.DSH_REPOSITORY ?? path.join(path.dirname(fork), "deepseek-harness");

async function launch(fixtureName: string, permissionMode = "workspace-write") {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-dsh-test-"));
  const fixture = path.join(repository, "snapshots", fixtureName);
  const rows: unknown[] = (await readFile(fixture, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const messages = rows.flatMap((row) => {
    const event = z.object({ type: z.string(), data: z.unknown().optional() }).parse(row);
    if (event.type !== "user/message") return [];
    const message = UserMessageSchema.parse(event.data);
    return message.source.kind === "user" ? [message] : [];
  });
  const prompt = messages[0].content
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("");
  const overlay = path.join(home, "companion-test.yml");
  await writeFile(
    overlay,
    "- id: session-title-llm\n  disabled: true\n- id: session-telemetry-otel\n  disabled: true\n",
  );
  const process = spawn(
    globalThis.process.execPath,
    [
      "apps/cli/lib/bin.js",
      "--profile",
      "web",
      "--patch",
      "apps/cli/config/examples/paseo/cordis.yml",
      "--patch",
      overlay,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--no-open",
    ],
    {
      cwd: repository,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...globalThis.process.env,
        DSH_HOME: home,
        DSH_SNAPSHOT: "replay",
        DSH_SNAPSHOT_FILE: fixture,
        DSH_SNAPSHOT_SESSIONS_ROOT: path.join(home, "sessions"),
        DSH_PERMISSION_MODE: permissionMode,
      },
    },
  );
  let output = "";
  let stopped = false;
  const exited = new Promise<void>((resolve) =>
    process.once("exit", () => {
      stopped = true;
      resolve();
    }),
  );
  const closeProcess = async () => {
    if (!stopped) {
      process.kill("SIGTERM");
      const timeout = setTimeout(() => process.kill("SIGKILL"), 10_000);
      try {
        await exited;
      } finally {
        clearTimeout(timeout);
      }
    }
    await rm(home, { recursive: true, force: true });
  };
  try {
    const loginUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("DSH test host did not start")), 30_000);
      const receive = (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_.~-]+/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      };
      process.stdout.on("data", receive);
      process.stderr.on("data", receive);
      process.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      process.once("exit", () => {
        clearTimeout(timeout);
        reject(
          new Error(
            `DSH host exited: ${output.replace(/token=\S+/g, "token=[redacted]").slice(-2000)}`,
          ),
        );
      });
    });
    const login = await fetch(loginUrl, { redirect: "manual" });
    expect(login.status).toBe(303);
    const origin = new URL(loginUrl).origin;
    const cookie = login.headers.getSetCookie()[0].split(";", 1)[0];
    const cookieFile = path.join(home, "companion-auth.json");
    await writeFile(cookieFile, JSON.stringify({ origin, cookie }), { mode: 0o600 });
    const config = DshConfigSchema.parse({ url: origin, cookieFile });
    const native = new DshConnection(config);
    const client = new DshAgentClient(config);
    const cwd = path.join(home, "workspace");
    await mkdir(cwd);
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(await native.request("session/create", { request: { cwd } }));
    const imported = await client.importSession(
      { providerHandleId: sessionId, cwd },
      { storedConfig: { provider: "dsh", cwd } },
    );
    return {
      prompt,
      imported,
      client,
      sessionId,
      cwd,
      native,
      close: async () => {
        await client.shutdown();
        await native.close();
        await closeProcess();
      },
    };
  } catch (error) {
    await closeProcess();
    throw error;
  }
}

test("attaches, streams a real DSH replay turn, and reloads the same durable session", async () => {
  const host = await launch("session/text-turn/session.v1.jsonl");
  try {
    const result = await host.imported.session.run(host.prompt);
    expect(result.sessionId).toBe(host.sessionId);
    expect(result.finalText).toBe("PONG");
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
