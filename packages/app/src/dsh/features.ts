import { selectRemoteCapabilities, type RemoteResult } from "@deepseek-ai/dsh-client";
import type { DshHostRuntime } from "./runtime";

/** Optional operations match this build's generated descriptors within the admitted generation. */
export function featureAvailable(
  runtime: DshHostRuntime,
  endpoints: Parameters<typeof selectRemoteCapabilities>[0],
): boolean {
  if (runtime.connection.generation.getSnapshot() === undefined) return false;
  const offered = runtime.remote.$host.capabilities?.capabilities;
  return selectRemoteCapabilities(endpoints).every((expected) =>
    offered?.some(
      (actual) =>
        actual.endpoint === expected.endpoint &&
        actual.availability !== "unavailable" &&
        actual.mode === expected.mode &&
        actual.wireFingerprint === expected.wireFingerprint &&
        actual.semanticRevision === expected.semanticRevision,
    ),
  );
}
export function remoteValue<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
