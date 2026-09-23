import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import os from "node:os";
import path from "node:path";
import { expect, type BrowserContext, type Page } from "@playwright/test";

const repository = process.env.DSH_REPOSITORY ?? "/home/carlo/devel/deepseek-harness-daedal-dsh";
const testFixture = "session/text-turn/session.v1.jsonl";
const fixturePrompt = "Reply with exactly the word: PONG. Do not use any tools.";

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
function companionRepoRoot(): string {
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

interface MountedDshHostOptions {
  fixture?: string;
  /** Hold a real model turn until teardown so queue assertions need no timing window. */
  holdTurn?: boolean;
  /** Serialized provider replay entries, written only inside this test Host's private home. */
  replayOverride?: string;
}

export async function launchMountedDshHost(options: MountedDshHostOptions = {}) {
  const dist = path.resolve(companionRepoRoot(), ".dev/dsh-web/index.html");
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-mount-dsh-"));
  const fixture = path.join(repository, "snapshots", options.fixture ?? testFixture);
  const override = path.join(home, "replay.override.json");
  const replayOverride =
    options.replayOverride ?? (options.holdTurn ? JSON.stringify([{ kind: "hang" }]) : undefined);
  if (replayOverride !== undefined) await writeFile(override, replayOverride);
  const overlay = path.join(home, "companion-mounted.yml");
  await writeFile(
    overlay,
    [
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
      "",
    ].join("\n"),
  );
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
    const cwd = path.join(home, "workspace");
    await mkdir(cwd, { recursive: true });
    // The Host admits an existing directory; an initialised repository also satisfies the
    // automatic Git workspace opt-in used by the creation form.
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
      prompt: fixturePrompt,
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
