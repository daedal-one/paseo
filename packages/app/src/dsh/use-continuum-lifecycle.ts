import { useEffect } from "react";
import { AppState } from "react-native";
import { isWeb } from "@/constants/platform";
import type { DshDirectory } from "./directory";
/** Foreground refreshes observation only; it never repeats a submitted operation. */
export function useContinuumLifecycle(model: DshDirectory | null): void {
  useEffect(() => {
    if (model === null) return;
    function change(active: boolean) {
      if (active) model?.reconnect();
      else void model?.suspend();
    }
    if (isWeb) {
      const listener = () => change(document.visibilityState === "visible");
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    }
    const subscription = AppState.addEventListener("change", (state) => change(state === "active"));
    return () => subscription.remove();
  }, [model]);
}
