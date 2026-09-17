import {
  DshDirectory as SharedDirectory,
  createDshDirectoryOwner,
  type DshDirectoryAccess,
  type DshDirectoryHost,
} from "../directory";
import { DshAccessError } from "../access-error";
import { openSavedDshHost, pairDshHost } from "./access";
import { dshDeviceStore } from "./device-store";
export type {
  DshDirectoryHost,
  DshDirectoryLoad,
  DshPairingState,
  DshDirectorySnapshot,
} from "../directory";

const nativeAccess: DshDirectoryAccess = {
  async list() {
    const hosts: DshDirectoryHost[] = [];
    for (const hostId of await dshDeviceStore.list()) {
      try {
        const record = await dshDeviceStore.load(hostId);
        if (record === null) hosts.push({ hostId, status: "unavailable", error: "not-paired" });
        else
          hosts.push({
            hostId,
            status: "paired",
            origin: record.origin,
            label: record.grant.device.label,
          });
      } catch (error) {
        hosts.push({
          hostId,
          status: "unavailable",
          error: error instanceof DshAccessError ? error.code : "storage-unavailable",
        });
      }
    }
    return hosts;
  },
  pair: pairDshHost,
  open: openSavedDshHost,
  forget: (hostId) => dshDeviceStore.forget(hostId),
};

export class DshDirectory extends SharedDirectory {
  constructor() {
    super(nativeAccess);
  }
}
export const openDshDirectory = createDshDirectoryOwner(() => new DshDirectory());
