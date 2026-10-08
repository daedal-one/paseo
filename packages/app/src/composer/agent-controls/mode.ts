import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { AgentMode } from "@getpaseo/protocol/agent-types";

export function resolveNextAgentModeId({
  modeOptions,
  selectedMode,
}: {
  modeOptions: readonly AgentMode[];
  selectedMode: string | null | undefined;
}): string | null {
  if (modeOptions.length < 2) return null;

  const selectedIndex = modeOptions.findIndex((mode) => mode.id === selectedMode);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const nextIndex = (currentIndex + 1) % modeOptions.length;
  return modeOptions[nextIndex]?.id ?? null;
}

export function resolveAgentControlsMode(agentControls?: DraftAgentControlsProps) {
  return agentControls ? "draft" : "ready";
}

/** Keep DSH's derived Custom state visible without adding it to the switchable modes. */
export function resolveDisplayedAgentMode(input: {
  provider: string;
  modeOptions: readonly AgentMode[];
  selectedModeId: string | null | undefined;
}): AgentMode | null {
  if (input.modeOptions.length === 0) return null;
  return (
    input.modeOptions.find((mode) => mode.id === input.selectedModeId) ??
    (input.provider === "dsh" && input.selectedModeId
      ? { id: input.selectedModeId, label: input.selectedModeId }
      : input.modeOptions[0])
  );
}
