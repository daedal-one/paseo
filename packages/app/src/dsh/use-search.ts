import { useEffect, useSyncExternalStore } from "react";
import type { DshHostRuntime } from "./runtime";

/** Bind the mounted sheet's read lifetime to the Host-owned search model. */
export function useSearch(runtime: DshHostRuntime) {
  const search = runtime.search;
  useEffect(() => search.begin(), [search]);
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot);
  return { search, state };
}
