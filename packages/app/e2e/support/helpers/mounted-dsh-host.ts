import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";

const repository = process.env.DSH_REPOSITORY ?? "/home/carlo/devel/deepseek-harness-daedal-dsh";
const testFixture = "session/text-turn/session.v1.jsonl";

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

export async function launchMountedDshHost() {
  const dist = path.resolve(companionRepoRoot(), ".dev/dsh-web/index.html");
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-mount-dsh-"));
  const fixture = path.join(repository, "snapshots", testFixture);
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
      /** Captured Host output, for diagnosing a Host that exits during a run. */
      outputTail: () => output.replace(/token=\S+/g, "token=[redacted]").slice(-3000),
      close: closeProcess,
    };
  } catch (error) {
    await closeProcess();
    throw error;
  }
}

/*
 * Remaining work for the fork gesture. A Session must exist before the conversation header (and
 * its visible fork control) can render, and the replay fixture persists none. Create it through
 * the app's own creation form so the request carries the app's generated compatibility
 * descriptor; a direct `session/create` RPC is refused with `gateway/api-incompatible` because
 * that endpoint needs the descriptor rather than the `session/list` fingerprint.
 *
 * The form needs a directory and then a profile from the Host roster. The profile control stays
 * disabled until that roster resolves, and one attempt to drive it lost the Host connection
 * mid-form. Both the roster wait and that disconnect need to be understood before a fork gesture
 * can be qualified here.
 */

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
