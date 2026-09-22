import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { DshHostRuntime } from "./runtime";

/**
 * Render an anchor as the exact integer the shared fork owner transmits, or null
 * when the field is empty or not a whole position. Empty means no anchor.
 */
export function forkAnchor(value: string): number | null {
  const text = value.trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** The anchor field is only invalid when something was typed that is not a position. */
export function forkAnchorInvalid(value: string): boolean {
  return value.trim() !== "" && forkAnchor(value) === null;
}

/**
 * Hold one review view for the mounted fork sheet and bind the shared owner's
 * durable attempt to it. Closing releases only the review reader; the retained
 * attempt and any dispatched work stay owned by the runtime.
 */
export function useFork(runtime: DshHostRuntime) {
  const fork = runtime.fork;
  useEffect(() => fork.begin(), [fork]);
  const state = useSyncExternalStore(fork.subscribe, fork.getSnapshot);
  const [anchor, setAnchorText] = useState("");
  const [working, setWorking] = useState(false);
  const setAnchor = useCallback((next: string) => setAnchorText(next), []);
  const invalid = forkAnchorInvalid(anchor);
  const run = useCallback((action: () => Promise<void>) => {
    setWorking(true);
    void action().finally(() => setWorking(false));
  }, []);
  const forkSession = useCallback(
    (sessionId: Parameters<typeof fork.fork>[0]) => {
      const atSeq = forkAnchor(anchor);
      if (atSeq === null && anchor.trim() !== "") return;
      run(() => fork.fork(sessionId, atSeq ?? undefined));
    },
    [anchor, fork, run],
  );
  const checkCurrent = useCallback(() => run(() => fork.checkCurrent()), [fork, run]);
  const adoptCurrent = useCallback(() => run(() => fork.adoptCurrent()), [fork, run]);
  const reset = useCallback(() => run(() => fork.reset()), [fork, run]);
  const restore = useCallback(() => run(() => fork.restore()), [fork, run]);
  return {
    fork,
    state,
    anchor,
    invalid,
    setAnchor,
    working,
    forkSession,
    checkCurrent,
    adoptCurrent,
    reset,
    restore,
  };
}
