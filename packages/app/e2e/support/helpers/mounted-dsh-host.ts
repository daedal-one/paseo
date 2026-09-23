import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type BrowserContext, type Page } from "@playwright/test";

const repository = process.env.DSH_REPOSITORY ?? "/home/carlo/devel/deepseek-harness-daedal-dsh";
const testFixture = "session/text-turn/session.v1.jsonl";
const fixturePrompt = "Reply with exactly the word: PONG. Do not use any tools.";
export const APPROVAL_MARKER_NAME = "approval-marker.txt";
export const APPROVAL_MARKER_CONTENT = "approved marker\n";
export const APPROVAL_MARKER_REASON = "Approve one invocation writing private approval-marker.txt";
export const WORKSPACE_PROVENANCE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
export const WORKSPACE_PROVENANCE_PROMPT = "Reply with exactly: SDK snapshot OK";
export const WORKSPACE_PROVENANCE_REPLY = "SDK snapshot OK";

/** Reuse the committed storage-outcome fixture and the real auxiliary naming recorder. */
function workspaceProvenancePlugin(resultPath: string): string {
  const root = path.join(repository, "packages/sandbox/local-container-runtime");
  const outcomes = pathToFileURL(path.join(root, "tests/fixtures/workspace-outcomes.ts")).href;
  const names = pathToFileURL(path.join(root, "src/workspace-names.ts")).href;
  return [
    "import { rename, writeFile } from 'node:fs/promises';",
    `import { apply as applyOutcomes } from ${JSON.stringify(outcomes)};`,
    `import { generateWorkspaceTopics } from ${JSON.stringify(names)};`,
    "export const name = 'mounted-workspace-provenance';",
    "export const inject = ['agents', 'systemPrompt', 'sessions', 'llm'];",
    "export function apply(ctx) {",
    "  applyOutcomes(ctx, { provenance: true });",
    "  ctx.on('agent/turn-settled', async ({ agent, turn }) => {",
    "    const topics = await generateWorkspaceTopics(ctx, agent.session, turn, ['HEAD', 'refs/heads/main'],",
    "      'Recorded workspace return fixture; no repository mutation is performed.', {",
    "        messageProvider: 'deepseek-official', messageModel: 'deepseek-flash',",
    "        messageInputBytes: 16384, messageOutputTokens: 128,",
    "        messageTimeoutMs: 10000, maxOutputBytes: 16384,",
    "      });",
    "    if (topics?.HEAD !== 'fix-recovery' || topics?.['refs/heads/main'] !== 'fix-recovery')",
    "      throw new Error('Recorded workspace naming did not return the validated topics');",
    `    await writeFile(${JSON.stringify(`${resultPath}.tmp`)}, JSON.stringify(topics), { mode: 0o600 });`,
    `    await rename(${JSON.stringify(`${resultPath}.tmp`)}, ${JSON.stringify(resultPath)});`,
    "  });",
    "}",
    "",
  ].join("\n");
}

/** Preserve the recorded main turn and add one keyless response for the real naming helper. */
function workspaceNamingReplay(): string {
  const text = JSON.stringify({ HEAD: "fix-recovery", "refs/heads/main": "fix-recovery" });
  return JSON.stringify({
    patches: [
      {
        at: 1,
        entry: {
          kind: "chunks",
          chunks: [
            { type: "block-start", index: 0, blockType: "text" },
            { type: "text-delta", index: 0, text },
            { type: "block-end", index: 0, block: { type: "text", text } },
            { type: "finish", reason: { kind: "stop" } },
          ],
        },
      },
    ],
  });
}

function markerApprovalPolicy(cwd: string): string {
  return [
    "export const name = 'mounted-approval-policy';",
    "export const inject = ['tools'];",
    "export function apply(ctx) {",
    "  ctx.on('tools/pre-execute', async (exec, next) => {",
    "    const downstream = await next();",
    "    if (downstream.kind !== 'allow') return downstream;",
    "    const args = exec.arguments;",
    "    const exactArgs = args !== null && typeof args === 'object' && !Array.isArray(args)",
    `      && Object.keys(args).length === 2 && args.file_path === ${JSON.stringify(APPROVAL_MARKER_NAME)}`,
    `      && args.content === ${JSON.stringify(APPROVAL_MARKER_CONTENT)};`,
    `    if (exec.name === 'write' && exec.agent?.session.header.cwd === ${JSON.stringify(cwd)} && exactArgs) {`,
    `      return { kind: 'ask', reason: ${JSON.stringify(APPROVAL_MARKER_REASON)} };`,
    "    }",
    "    return downstream;",
    "  });",
    "}",
    "",
  ].join("\n");
}

/**
 * The browser edition derives its DSH host from the page origin and stores no enrollment, so a
 * browser run has to be served by the Host itself. This launches the real built Host with the
 * companion export mounted at /daedal and returns the same-origin session for the runner.
 *
 * DSH_REPOSITORY must name a built DSH checkout; the default is the native migration checkout.
 */
/**
 * Playwright transpiles support helpers without their source directory, so locate the companion
 * checkout by walking up from the runner's working directory instead of trusting __dirname.
 */
export function companionRepoRoot(): string {
  if (process.env.DAEDAL_REPO_ROOT) return process.env.DAEDAL_REPO_ROOT;
  let current = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, "packages", "app", "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Could not locate the companion checkout for the mounted DSH preview");
}

export function mountedDshImageFixturePaths() {
  const root = companionRepoRoot();
  return {
    light: path.join(root, "packages", "app", "assets", "images", "favicon-light.png"),
    dark: path.join(root, "packages", "app", "assets", "images", "favicon-dark.png"),
  };
}

const imageObjectIdSchema = z.string().regex(/^sha256:([a-f0-9]{64})$/);

interface MountedDshHostOptions {
  fixture?: string;
  /** Hold a real model turn until teardown so queue assertions need no timing window. */
  holdTurn?: boolean;
  /** Serialized provider replay entries, written only inside this test Host's private home. */
  replayOverride?: string;
  requireMarkerApproval?: boolean;
  /** Required workspace events from the committed outcome fixture and real naming helper. */
  workspaceProvenance?: boolean;
}

export async function launchMountedDshHost(options: MountedDshHostOptions = {}) {
  const dist = path.resolve(companionRepoRoot(), ".dev/dsh-web/index.html");
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-mount-dsh-"));
  const fixture = path.join(
    repository,
    "snapshots",
    options.fixture ??
      (options.workspaceProvenance ? "sdk/workspace-provenance/session.v3.jsonl" : testFixture),
  );
  const cwd = path.join(home, "workspace");
  const marker = path.join(cwd, APPROVAL_MARKER_NAME);
  const override = path.join(home, "replay.override.json");
  const heldReplay = options.holdTurn ? JSON.stringify([{ kind: "hang" }]) : undefined;
  const replayOverride =
    options.replayOverride ?? (options.workspaceProvenance ? workspaceNamingReplay() : heldReplay);
  if (replayOverride !== undefined) await writeFile(override, replayOverride);
  const approvalPolicy = path.join(home, "mounted-approval-policy.mjs");
  if (options.requireMarkerApproval) await writeFile(approvalPolicy, markerApprovalPolicy(cwd));
  const workspacePlugin = path.join(home, "mounted-workspace-provenance.mjs");
  const workspaceNamingResult = path.join(home, "workspace-naming-result.json");
  if (options.workspaceProvenance)
    await writeFile(workspacePlugin, workspaceProvenancePlugin(workspaceNamingResult));
  const overlay = path.join(home, "companion-mounted.yml");
  const overlayRows = [
    "- id: session-title-llm",
    "  disabled: true",
    "- id: session-telemetry-otel",
    "  disabled: true",
    "- insert:",
    "    - id: daedal-browser-preview",
    "      name: '@deepseek-ai/dsh-host-frontend-static'",
    "      config:",
    `        distIndex: ${dist}`,
    "        mountPath: /daedal",
    "        indexPaths: [/dsh-hosts]",
  ];
  if (options.requireMarkerApproval) {
    overlayRows.push(
      "- insert:",
      "    - id: mounted-approval-policy",
      `      name: ${approvalPolicy}`,
    );
  }
  if (options.workspaceProvenance) {
    overlayRows.push(
      "- insert:",
      "    - id: mounted-workspace-provenance",
      `      name: ${workspacePlugin}`,
    );
  }
  overlayRows.push("");
  await writeFile(overlay, overlayRows.join("\n"));
  if (process.env.DAEDAL_E2E_DEBUG === "1") {
    console.log("[mounted-dsh-host] spawn cwd", repository, "overlay");
    console.log(await readFile(overlay, "utf8"));
  }
  const child = spawn(
    process.execPath,
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
        ...process.env,
        DSH_HOME: home,
        DSH_SNAPSHOT: "replay",
        DSH_SNAPSHOT_FILE: fixture,
        ...(replayOverride === undefined ? {} : { DSH_SNAPSHOT_OVERRIDE: override }),
        DSH_SNAPSHOT_SESSIONS_ROOT: path.join(home, "sessions"),
        DSH_PERMISSION_MODE: "workspace-write",
      },
    },
  );
  let output = "";
  let stopped = false;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => {
      stopped = true;
      resolve();
    }),
  );
  const closeProcess = async () => {
    if (!stopped) {
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
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
      const timeout = setTimeout(() => reject(new Error("Mounted DSH host did not start")), 60_000);
      const receive = (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_.~-]+/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      };
      child.stdout?.on("data", receive);
      child.stderr?.on("data", receive);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Mounted DSH host exited: ${output.replace(/token=\S+/g, "token=[redacted]").slice(-2000)}`,
          ),
        );
      });
    });
    if (process.env.DAEDAL_E2E_DEBUG === "1") {
      console.log(
        "[mounted-dsh-host]",
        output.replace(/token=\S+/g, "token=[redacted]").slice(-4000),
      );
    }
    const login = await fetch(loginUrl, { redirect: "manual" });
    if (login.status !== 303) throw new Error("Mounted DSH test login failed");
    const origin = new URL(loginUrl).origin;
    const cookie = login.headers.getSetCookie()[0].split(";", 1)[0];
    const cookieFile = path.join(home, "companion-auth.json");
    await writeFile(cookieFile, JSON.stringify({ origin, cookie }), { mode: 0o600 });
    await mkdir(cwd, { recursive: true });
    // Keep setup within the owned process cleanup boundary; creation opts into this Git workspace.
    await new Promise<void>((resolve) =>
      execFile("git", ["init", "--quiet"], { cwd }, () => resolve()),
    );
    if (process.env.DAEDAL_E2E_DEBUG === "1") {
      const probe = await fetch(`${origin}/daedal/dsh-hosts`, {
        headers: { cookie },
        redirect: "manual",
      });
      console.log(
        "[mounted-dsh-host] mount probe",
        probe.status,
        probe.headers.get("set-cookie")?.slice(0, 40),
      );
    }
    return {
      config: { url: origin, cookieFile },
      /** The companion route served by the Host at its own origin. */
      companionUrl: `${origin}/daedal/dsh-hosts`,
      /** Scratch working directory this Host owns, usable as a Session target. */
      workspaceDir: cwd,
      /** The recorded prompt the replay fixture answers, for driving one completed turn. */
      prompt: options.workspaceProvenance ? WORKSPACE_PROVENANCE_PROMPT : fixturePrompt,
      /** The fixture file this Host replays. */
      fixture,
      /** Captured Host output, for diagnosing a Host that exits during a run. */
      outputTail: () => output.replace(/token=\S+/g, "token=[redacted]").slice(-3000),
      /** Read the only test Session's durable log, never the live Host's Session store. */
      async readSessionLog() {
        const root = path.join(home, "sessions");
        const logs = (await readdir(root, { recursive: true })).filter(
          (file) => path.basename(file) === "session.v3.jsonl",
        );
        if (logs.length !== 1)
          throw new Error(`Expected one private Session log, got ${logs.length}`);
        const text = await readFile(path.join(root, logs[0]!), "utf8");
        // Ignore an in-progress final physical row; the next observation will include it.
        const rows: unknown[] = text
          .slice(0, text.lastIndexOf("\n"))
          .split("\n")
          .map((line) => JSON.parse(line));
        const header = z.object({ type: z.literal("session"), id: z.string() }).parse(rows[0]);
        return { sessionId: header.id, rows: rows.slice(1) };
      },
      async readMarker() {
        return existsSync(marker) ? readFile(marker, "utf8") : null;
      },
      /** Test-only acknowledgement from the real helper, never a fabricated Session event. */
      async readWorkspaceNaming() {
        if (!existsSync(workspaceNamingResult)) return null;
        return z
          .object({ HEAD: z.literal("fix-recovery"), "refs/heads/main": z.literal("fix-recovery") })
          .strict()
          .parse(JSON.parse(await readFile(workspaceNamingResult, "utf8")));
      },
      async imageObjectIds() {
        const objects = path.join(home, "attachments", "v1", "objects");
        if (!existsSync(objects)) return [];
        const entries = await readdir(objects, { recursive: true });
        return entries
          .filter((entry) => {
            const parsed = path.parse(entry);
            return (
              parsed.dir === parsed.base.slice(0, 2) &&
              /^[a-f0-9]{64}$/.test(parsed.base) &&
              parsed.dir.length === 2
            );
          })
          .map((entry) => `sha256:${path.basename(entry)}`)
          .sort();
      },
      async readImageObject(id: string) {
        const digest = imageObjectIdSchema.parse(id).slice("sha256:".length);
        return readFile(
          path.join(home, "attachments", "v1", "objects", digest.slice(0, 2), digest),
        );
      },
      /** Generic files live in a different verbatim object namespace from normalized images. */
      async fileObjectIds() {
        const objects = path.join(home, "attachments", "v1", "file-objects");
        if (!existsSync(objects)) return [];
        const entries = await readdir(objects, { recursive: true });
        return entries
          .filter((entry) => {
            const parsed = path.parse(entry);
            return parsed.dir === parsed.base.slice(0, 2) && /^[a-f0-9]{64}$/.test(parsed.base);
          })
          .map((entry) => `sha256:${path.basename(entry)}`)
          .sort();
      },
      async readFileObject(id: string) {
        const digest = imageObjectIdSchema.parse(id).slice("sha256:".length);
        return readFile(
          path.join(home, "attachments", "v1", "file-objects", digest.slice(0, 2), digest),
        );
      },
      close: closeProcess,
    };
  } catch (error) {
    await closeProcess();
    throw error;
  }
}

/**
 * Create one Session through the app's own creation form so the request carries the app's
 * generated compatibility descriptor. A direct `session/create` RPC is refused with
 * `gateway/api-incompatible` because that endpoint needs the descriptor rather than the
 * `session/list` fingerprint. The replay fixture persists no Session, so a browser run has to
 * create its subject before the conversation header (and its visible fork control) can render.
 *
 * The form needs a directory and then a profile: read the Host roster explicitly, wait for the
 * profile control to leave its disabled placeholder state, then take the Host default.
 */
export async function createHostSession(page: Page, cwd: string): Promise<void> {
  await page.getByTestId("dsh-create-session").click();
  const directory = page.getByTestId("dsh-create-directory");
  await directory.waitFor({ state: "visible", timeout: 30_000 });
  await directory.fill(cwd);
  await page.getByTestId("dsh-create-profiles-refresh").click({ timeout: 30_000 });
  const profile = page.getByTestId("dsh-create-profile");
  await profile.waitFor({ state: "visible", timeout: 30_000 });
  await expect(profile).toBeEnabled({ timeout: 60_000 });
  await profile.click();
  const option = page.locator('[data-testid^="dsh-create-profile-"]').first();
  await option.waitFor({ state: "visible", timeout: 30_000 });
  await option.click();
  const submit = page.getByTestId("dsh-create-submit");
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await page
    .getByTestId("dsh-create-outcome-accepted")
    .waitFor({ state: "visible", timeout: 60_000 });
}

/** Reproduce the Host's signed-in browser session without printing credentials. */
export async function attachDshSession(
  context: BrowserContext,
  config: { url: string; cookieFile: string },
): Promise<void> {
  const auth = JSON.parse(await readFile(config.cookieFile, "utf8")) as { cookie: string };
  const [name, value] = auth.cookie.split("=", 2);
  await context.addCookies([
    { name, value, url: config.url, httpOnly: true, sameSite: "Lax" as const },
  ]);
}
