import { useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { DshDirectory } from "../directory";
import type { DshHostRuntime } from "../runtime";
import type { WorkspaceOverview } from "../workspace-overview";
import { useSnapshot } from "./use-snapshot";
import { WorkspaceWork } from "./workspace-work";
import { WorkspaceFiles } from "./workspace-files";
import { WorkspaceMemory } from "./workspace-memory";
import { WorkspaceExecutions } from "./workspace-executions";
import { workspaceStyles as ws } from "./workspace-styles";
import { styles } from "./styles";

export function WorkspaceContents({
  runtime,
  model,
  overview,
  creating,
  onCloseCreate,
}: {
  runtime: DshHostRuntime;
  model: DshDirectory;
  overview: WorkspaceOverview;
  creating: boolean;
  onCloseCreate(): void;
}) {
  const { t } = useTranslation();
  const directory = useSnapshot(model);
  const state = useSnapshot(runtime.workspaceData);
  const tab = directory.workspaceSection;
  const showFiles = useCallback(() => model.selectWorkspaceSection("files"), [model]);
  const showMemory = useCallback(() => model.selectWorkspaceSection("memory"), [model]);
  const refresh = useCallback(() => {
    void runtime.workspaceData.refresh();
  }, [runtime]);
  const dismiss = useCallback(() => runtime.workspaceData.clearMutation(), [runtime]);
  if (overview.workspace === null) {
    let message = "nativeDsh.work.selectWorkspace" as
      | "nativeDsh.work.selectWorkspace"
      | "nativeDsh.workspaceFiles.selectWorkspace"
      | "nativeDsh.workspaceMemory.selectWorkspace";
    if (tab === "files") message = "nativeDsh.workspaceFiles.selectWorkspace";
    else if (tab === "memory") message = "nativeDsh.workspaceMemory.selectWorkspace";
    return (
      <View style={ws.canvas}>
        <Text style={ws.muted}>{t(message)}</Text>
        {tab === "overview" && (
          <WorkspaceExecutions runtime={runtime} model={model} overview={overview} />
        )}
      </View>
    );
  }
  return (
    <View style={ws.canvas}>
      {state.mutation.status !== "idle" && (
        <View style={ws.section} testID={`dsh-workspace-mutation-${state.mutation.status}`}>
          <View style={ws.receipt}>
            <Text
              accessibilityRole={
                state.mutation.status === "rejected" || state.mutation.status === "unknown"
                  ? "alert"
                  : undefined
              }
              accessibilityLiveRegion="polite"
              style={state.mutation.status === "rejected" ? styles.error : ws.muted}
            >
              {t(`nativeDsh.workspaceData.mutation.${state.mutation.status}`)}
            </Text>
            <View style={ws.actions}>
              {(state.mutation.status === "rejected" || state.mutation.status === "unknown") && (
                <Button size="sm" variant="ghost" onPress={refresh}>
                  {t("nativeDsh.workspaceData.refresh")}
                </Button>
              )}
              {state.mutation.status !== "sending" && (
                <Button size="sm" variant="ghost" onPress={dismiss}>
                  {t(
                    state.mutation.status === "unknown"
                      ? "nativeDsh.workspaceData.checked"
                      : "nativeDsh.workspaceData.mutation.dismiss",
                  )}
                </Button>
              )}
            </View>
          </View>
          {state.mutation.status === "unknown" && state.mutation.targetId !== null && (
            <Text selectable style={ws.muted}>
              {state.mutation.targetId}
            </Text>
          )}
        </View>
      )}
      {tab === "overview" && (
        <>
          <View style={ws.columns}>
            <View style={ws.main}>
              <WorkspaceWork
                runtime={runtime}
                model={model}
                overview={overview}
                creating={false}
                onCloseCreate={onCloseCreate}
              />
            </View>
            <View style={ws.aside}>
              <WorkspaceFiles runtime={runtime} preview onBrowse={showFiles} />
              <WorkspaceMemory runtime={runtime} preview onBrowse={showMemory} />
            </View>
          </View>
          <WorkspaceExecutions runtime={runtime} model={model} overview={overview} />
        </>
      )}
      {tab === "work" && (
        <WorkspaceWork
          runtime={runtime}
          model={model}
          overview={overview}
          creating={creating}
          onCloseCreate={onCloseCreate}
        />
      )}
      {tab === "files" && (
        <View style={ws.section}>
          {overview.workspace !== null && (
            <Text selectable style={ws.muted}>
              {overview.workspace.path}
            </Text>
          )}
          <WorkspaceFiles runtime={runtime} />
        </View>
      )}
      {tab === "memory" && <WorkspaceMemory runtime={runtime} />}
    </View>
  );
}
