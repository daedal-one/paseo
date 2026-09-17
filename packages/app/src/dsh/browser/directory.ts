import { DshDirectory, createDshDirectoryOwner, type DshDirectoryAccess } from "../directory";
import { DshAccessError } from "../access-error";
import { openBrowserDshHost, readBrowserDshHost } from "./access";

const browserAccess: DshDirectoryAccess = {
  async list(signal) {
    const host = await readBrowserDshHost(signal);
    return [{ ...host, status: "paired", label: host.origin }];
  },
  open: openBrowserDshHost,
  async pair() {
    throw new DshAccessError("unsupported-platform");
  },
  async forget() {
    throw new DshAccessError("unsupported-platform");
  },
};
export const openBrowserDshDirectory = createDshDirectoryOwner(
  () => new DshDirectory(browserAccess),
);
