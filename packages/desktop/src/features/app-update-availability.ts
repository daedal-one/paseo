import { access } from "node:fs/promises";
import { constants } from "node:fs";

/** Missing packaged metadata disables updates; other filesystem failures remain visible. */
export async function hasAppUpdateConfiguration(configPath: string): Promise<boolean> {
  try {
    await access(configPath, constants.R_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
