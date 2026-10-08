import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
const UserMessageSchema = z.object({
  source: z.object({ kind: z.string() }),
  content: z.array(z.looseObject({ type: z.string() })),
});

const fork = path.resolve(__dirname, "../..");
const repository = process.env.DSH_REPOSITORY ?? path.join(path.dirname(fork), "deepseek-harness");

export interface DshTestHostOptions {
  /** Absolute index.html of a built companion export to serve from the Host's own origin. */
  absoluteDistIndex?: string;
  mountPath?: string;
}

export async function launchDshTestHost(
  fixtureName: string,
  permissionMode = "workspace-write",
  profileControls = false,
  options: DshTestHostOptions = {},
) {
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
    "- id: session-title-llm\n  disabled: true\n- id: session-telemetry-otel\n  disabled: true\n" +
      (profileControls
        ? `
- id: agent-default-model
  config:
    provider: deepseek-official
    model: global-model
    presets:
      minimal: { provider: deepseek-official, model: deepseek-flash }
- id: llm-replay
  config:
    providers:
      - id: deepseek-official
        name: DeepSeek
        models: [{ id: deepseek-flash }, { id: global-model }]
- id: permission
  config:
    defaultPreset: workspace-write
    presets:
      read-only: { sandbox: read-only, approval: ask }
      workspace-write: { sandbox: workspace-write, approval: ask }
      policy-reviewed: { sandbox: danger-full-access, approval: ask }
      danger-full-access: { sandbox: danger-full-access, approval: never }
`
        : "") +
      (options.absoluteDistIndex === undefined
        ? ""
        : `
- insert:
    - id: daedal-browser-preview
      name: '@deepseek-ai/dsh-host-frontend-static'
      config:
        distIndex: ${options.absoluteDistIndex}
        mountPath: ${options.mountPath ?? "/daedal"}
        indexPaths: [/dsh-hosts]
`),
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
    if (login.status !== 303) throw new Error("DSH test login failed");
    const origin = new URL(loginUrl).origin;
    const cookie = login.headers.getSetCookie()[0].split(";", 1)[0];
    const cookieFile = path.join(home, "companion-auth.json");
    await writeFile(cookieFile, JSON.stringify({ origin, cookie }), { mode: 0o600 });
    const config = { url: origin, cookieFile };
    const cwd = path.join(home, "workspace");
    await mkdir(cwd);
    return {
      config,
      prompt,
      cwd,
      close: async () => {
        await closeProcess();
      },
    };
  } catch (error) {
    await closeProcess();
    throw error;
  }
}
