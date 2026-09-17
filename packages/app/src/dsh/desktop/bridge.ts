import {
  DshAccessError,
  type DesktopDshBridge,
  type DesktopDshCommand,
} from "@getpaseo/protocol/dsh-access";

declare global {
  interface Window {
    daedalDsh?: DesktopDshBridge;
  }
}
export function desktopDshBridge(): DesktopDshBridge {
  if (typeof window === "undefined" || window.daedalDsh === undefined)
    throw new DshAccessError("unsupported-platform");
  return window.daedalDsh;
}
export async function desktopDshRequest(command: DesktopDshCommand): Promise<unknown> {
  let reply;
  try {
    reply = await desktopDshBridge().request(command);
  } catch {
    throw new DshAccessError("transport-failed");
  }
  if (!reply.ok) throw new DshAccessError(reply.error);
  return reply.value;
}
