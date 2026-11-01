import { useCallback, useSyncExternalStore } from "react";

/** Retain the receiver for service snapshots whose methods own mutable state. */
export function useSnapshot<T>(source: {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}): T {
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source]);
  const read = useCallback(() => source.getSnapshot(), [source]);
  return useSyncExternalStore(subscribe, read);
}
