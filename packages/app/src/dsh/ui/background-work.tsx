import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { SessionListState, SessionId } from "@deepseek-ai/dsh-client";
import { Button } from "@/components/ui/button";
import type { DshDirectory } from "../directory";
import type { DshConversation, DshHostRuntime } from "../runtime";
import { featureAvailable, remoteValue } from "../features";
import { styles } from "./styles";
type Child = SessionListState["subagentsByParent"][SessionId]["entries"][number];
function ChildControl({
  child,
  runtime,
  view,
  model,
  enabled,
}: {
  child: Child;
  runtime: DshHostRuntime;
  view: DshConversation;
  model: DshDirectory;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const mutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!featureAvailable(runtime, ["subagents/interruptByParent"])) throw new Error("offline");
      return remoteValue(
        await runtime.remote.subagents.interruptByParent(child.id, view.sessionId, "continuable"),
      );
    },
  });
  const stop = useCallback(() => mutation.mutate(), [mutation]);
  const open = useCallback(() => {
    if (child.kind === "child")
      model.openSubagent({
        parentSessionId: view.sessionId,
        childSessionId: child.id,
        mode: child.mode,
      });
  }, [child, model, view.sessionId]);
  if (child.kind === "diagnostic")
    return <Text style={styles.muted}>{t("nativeDsh.features.unavailable")}</Text>;
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{child.label ?? child.id}</Text>
      <Text style={styles.muted}>
        {t(child.activity === "running" ? "nativeDsh.running" : "nativeDsh.idle")}
      </Text>
      <View style={styles.actions}>
        <Button variant="ghost" onPress={open} disabled={!enabled}>
          {t("nativeDsh.conversation.open")}
        </Button>
        {child.mode === "continuable" && (
          <Button
            variant="outline"
            onPress={stop}
            disabled={!enabled || mutation.isPending || child.activity !== "running"}
          >
            {t("nativeDsh.tasks.stop")}
          </Button>
        )}
      </View>
      {mutation.isError && <Text style={styles.error}>{t("nativeDsh.features.failed")}</Text>}
    </View>
  );
}
export function BackgroundWork({
  runtime,
  view,
  model,
}: {
  runtime: DshHostRuntime;
  view: DshConversation;
  model: DshDirectory;
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(
    runtime.sessions.list.subscribe,
    runtime.sessions.list.getSnapshot,
  );
  useSyncExternalStore(
    runtime.connection.generation.subscribe,
    runtime.connection.generation.getSnapshot,
  );
  const enabled = featureAvailable(runtime, ["subagents/list"]);
  useEffect(() => {
    runtime.sessions.setSubagentCatalogOpen(view.sessionId, true);
    return () => runtime.sessions.setSubagentCatalogOpen(view.sessionId, false);
  }, [runtime, view.sessionId]);
  const refresh = useCallback(() => {
    void runtime.sessions.refreshSubagents(view.sessionId);
  }, [runtime, view.sessionId]);
  const catalog = state.subagentsByParent[view.sessionId];
  return (
    <View style={styles.group} testID="dsh-background-work">
      <Text style={styles.title}>{t("nativeDsh.features.tasks")}</Text>
      {!enabled && <Text style={styles.muted}>{t("nativeDsh.features.unavailable")}</Text>}
      {state.jobsBySession[view.sessionId]?.map((job) => (
        <View key={job.id}>
          <Text style={styles.text}>{job.label}</Text>
          <Text style={styles.muted}>{t(`nativeDsh.tasks.status.${job.status}`)}</Text>
          {job.detail !== undefined && (
            <Text selectable style={styles.text}>
              {job.detail}
            </Text>
          )}
        </View>
      ))}
      {catalog?.entries.map((child) => (
        <ChildControl
          key={child.id}
          child={child}
          runtime={runtime}
          view={view}
          model={model}
          enabled={enabled && catalog.state === "ready"}
        />
      ))}
      <Button
        size="sm"
        variant="ghost"
        disabled={!enabled || catalog?.state === "loading"}
        onPress={refresh}
      >
        {t("nativeDsh.refresh")}
      </Button>
      {catalog?.state === "error" && (
        <Text style={styles.error}>{t("nativeDsh.features.failed")}</Text>
      )}
    </View>
  );
}
