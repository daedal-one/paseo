import { DshDirectory, createDshDirectoryOwner, type DshDirectoryAccess } from "../directory";
import { listDesktopDshHosts, openDesktopDshHost, pairDesktopDshHost } from "./access";
import { desktopDshRequest } from "./bridge";
const access: DshDirectoryAccess = {
  async list() {
    return (await listDesktopDshHosts()).map((host) => ({
      hostId: host.hostId,
      origin: host.origin,
      label: host.label,
      status: "paired",
    }));
  },
  pair: pairDesktopDshHost,
  open: openDesktopDshHost,
  async forget(hostId) {
    await desktopDshRequest({ type: "forget", hostId });
  },
};
export const openDesktopDshDirectory = createDshDirectoryOwner(() => new DshDirectory(access));
