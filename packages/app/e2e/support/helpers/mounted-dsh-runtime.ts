import path from "node:path";
import { build } from "esbuild";
import type { JSHandle, Page } from "@playwright/test";
import { companionRepoRoot } from "./mounted-dsh-host";
import type { createMountedDshOwner } from "./mounted-dsh-runtime-entry";

export type MountedDshOwner = JSHandle<Awaited<ReturnType<typeof createMountedDshOwner>>>;

/** Bundle only for an explicit test; the production export never contains this entry. */
export async function openMountedDshOwner(page: Page, sessionId: string): Promise<MountedDshOwner> {
  const root = companionRepoRoot();
  const result = await build({
    entryPoints: [path.join(root, "packages/app/e2e/support/helpers/mounted-dsh-runtime-entry.ts")],
    absWorkingDir: root,
    tsconfig: path.join(root, "packages/app/tsconfig.json"),
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  if (result.outputFiles.length !== 1)
    throw new Error("Expected exactly one JavaScript product-owner test bundle without assets");
  const code = result.outputFiles[0]!.text;
  return page.evaluateHandle(
    async ({ code: source, sessionId: targetSessionId }) => {
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      try {
        const entry: typeof import("./mounted-dsh-runtime-entry") = await import(url);
        return await entry.createMountedDshOwner(targetSessionId);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { code, sessionId },
  );
}

export async function closeMountedDshOwner(owner: MountedDshOwner): Promise<void> {
  try {
    await owner.evaluate((value) => value.dispose());
  } finally {
    await owner.dispose();
  }
}
