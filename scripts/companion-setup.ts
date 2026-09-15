import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { BUILTIN_PROVIDER_IDS } from "../packages/protocol/src/provider-manifest.js";
import { PersistedConfigSchema } from "../packages/server/src/server/persisted-config.js";
import {
  DshAuthSchema,
  DshConfigSchema,
  DshConnection,
} from "../packages/server/src/server/agent/providers/dsh/connection.js";
import { CatalogSchema } from "../packages/server/src/server/agent/providers/dsh/wire.js";

const { values } = parseArgs({ options: { home: { type: "string" } } });
const companionHome = path.resolve(values.home ?? ".dev/dsh-companion");
const configFile = path.join(companionHome, "config.json");
const cookieFile = path.join(companionHome, "dsh-auth.json");

async function main(): Promise<void> {
  const input = createInterface({ input: process.stdin, output: process.stderr });
  let loginText: string;
  try {
    if (process.stdin.isTTY)
      loginText = await input.question("Paste the DSH Web login URL (kept on this host): ");
    else {
      const line = await input[Symbol.asyncIterator]().next();
      if (line.done) throw new Error("Provide the DSH Web login URL on standard input.");
      loginText = line.value;
    }
  } finally {
    input.close();
  }
  const parsed = URL.parse(loginText.trim());
  if (
    !parsed ||
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.hash
  ) {
    throw new Error("Use the root login URL printed by DSH Web.");
  }
  const origin = parsed.origin;
  DshConfigSchema.parse({ url: origin });
  const login = await fetch(parsed, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (login.status !== 303)
    throw new Error("DSH did not accept the login URL. Use a fresh URL from the running host.");
  const cookies = login.headers.getSetCookie().map((header) => header.split(";", 1)[0]);
  const cookie = cookies.find((value) => value.startsWith("dsh-auth-"));
  const auth = DshAuthSchema.safeParse({ origin, cookie });
  if (!auth.success) throw new Error("DSH did not issue the expected browser credential.");

  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(configFile, "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const config = PersistedConfigSchema.parse(
    existing ?? {
      version: 1,
      daemon: {
        listen: "127.0.0.1:6769",
        relay: { enabled: false },
        mcp: { enabled: false, injectIntoAgents: false },
      },
      features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
      agents: {
        providers: Object.fromEntries(BUILTIN_PROVIDER_IDS.map((id) => [id, { enabled: false }])),
      },
    },
  );
  await mkdir(companionHome, { recursive: true, mode: 0o700 });
  const temporaryCookie = `${cookieFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryCookie, `${JSON.stringify(auth.data)}\n`, { mode: 0o600, flag: "wx" });
  const connection = new DshConnection(
    DshConfigSchema.parse({ url: origin, cookieFile: temporaryCookie }),
  );
  try {
    CatalogSchema.parse(await connection.request("session/modelCatalog", {}));
  } finally {
    await connection.close();
  }
  await rename(temporaryCookie, cookieFile);
  await chmod(cookieFile, 0o600);
  const updated = PersistedConfigSchema.parse({
    ...config,
    agents: {
      ...config.agents,
      providers: {
        ...config.agents?.providers,
        dsh: { enabled: true, params: { url: origin, cookieFile } },
      },
    },
  });
  const temporaryConfig = `${configFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryConfig, `${JSON.stringify(updated, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporaryConfig, configFile);
  console.log(`Connected to DSH at ${origin}. Companion home: ${companionHome}`);
}

main().catch(() => {
  // Login URLs and validation errors may contain credentials; never print them.
  console.error(
    "Companion setup failed. Check the DSH login URL, host availability, and writable companion home.",
  );
  process.exitCode = 1;
});
