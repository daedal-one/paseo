import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Plus } from "lucide-react-native";
import type { WorkspaceId } from "@deepseek-ai/dsh-client";
import { SelectField } from "@/components/ui/select-field";
import { workspaceOverview } from "../workspace-overview";
import { Button } from "@/components/ui/button";
import type { DshDirectory, WorkspaceSection } from "../directory";
import type { DshHostRuntime } from "../runtime";
import { RegistrationControl } from "./registration-sheet";
import { useSnapshot } from "./use-snapshot";
import { ChoiceTab } from "./choice-tab";
import { styles } from "./styles";
import { workspaceStyles as ws } from "./workspace-styles";
import { WorkspaceContents } from "./workspace-contents";

interface SessionsProps {
  runtime: DshHostRuntime;
  model: DshDirectory;
  busy: boolean;
}
export function Sessions({ runtime, model, busy }: SessionsProps) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const directory = useSnapshot(model);
  const workspaceData = useSnapshot(runtime.workspaceData);
  const workspaces = useSnapshot(runtime.workspaces.list);
  const generation = useSnapshot(runtime.connection.generation);
  const connection = useSnapshot(runtime.connection.state);
  const list = useSnapshot(runtime.sessions.list);
  const pending = useSnapshot(runtime.pending);
  const [creating, setCreating] = useState(false);
  const overview = useMemo(
    () =>
      workspaceOverview(workspaces, list, directory.selectedWorkspaceId, (id) => pending.has(id)),
    [workspaces, list, directory.selectedWorkspaceId, pending],
  );
  const select = useCallback(
    (id: WorkspaceId | "all") => {
      setCreating(false);
      model.selectWorkspace(id === "all" ? null : id);
    },
    [model],
  );
  const setTab = useCallback(
    (tab: WorkspaceSection) => {
      setCreating(false);
      model.selectWorkspaceSection(tab);
    },
    [model],
  );
  const newWork = useCallback(() => {
    model.selectWork(null);
    model.selectWorkspaceSection("work");
    setCreating(true);
  }, [model]);
  const closeCreate = useCallback(() => setCreating(false), []);
  const options = useMemo(
    () => [
      { id: "all", value: "all" as const, label: t("nativeDsh.workspaceOverview.all") },
      ...workspaces.items.map((item) => ({
        id: item.workspaceId,
        value: item.workspaceId,
        label: item.title,
        description: item.path,
      })),
    ],
    [workspaces.items, t],
  );
  const display = useMemo(
    () => ({ label: overview.workspace?.title ?? t("nativeDsh.workspaceOverview.all") }),
    [overview.workspace, t],
  );
  const connected = generation !== undefined;
  const reconnect = useCallback(() => model.reconnect(), [model]);
  const refresh = useCallback(() => {
    void model.refreshSessions();
    void runtime.workspaceData.refresh();
  }, [model, runtime]);
  const loadMore = useCallback(() => model.loadMoreSessions(), [model]);
  return (
    <View style={ws.shell} testID="dsh-session-list">
      <View style={ws.toolbar}>
        <View style={ws.picker}>
          <SelectField<WorkspaceId | "all">
            field={false}
            label={t("nativeDsh.workspaceOverview.select")}
            value={directory.selectedWorkspaceId ?? "all"}
            selectedDisplay={display}
            options={options}
            onChange={select}
            placeholder={t("nativeDsh.workspaceOverview.select")}
            emptyText={t("nativeDsh.workspaceOverview.empty")}
            disabled={busy}
            searchable
            searchPlaceholder={t("nativeDsh.workspaceOverview.search")}
            testID="dsh-workspace-picker"
          />
        </View>
        <Button
          size="sm"
          variant="default"
          style={ws.touch}
          leftIcon={Plus}
          disabled={
            busy ||
            !connected ||
            overview.workspace === null ||
            !workspaceData.canCreate ||
            (workspaceData.work.status === "ready" &&
              workspaceData.work.value.binding === null &&
              workspaceData.work.value.adoptionCandidate !== null)
          }
          onPress={newWork}
          testID="dsh-new-work"
        >
          {t("nativeDsh.work.new")}
        </Button>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={ws.navigation} accessibilityRole="tablist">
          {(["overview", "work", "files", "memory"] as const).map((item) => (
            <ChoiceTab
              size={compact ? "md" : "sm"}
              key={item}
              value={item}
              selected={directory.workspaceSection}
              label={t(`nativeDsh.workspaceOverview.tabs.${item}`)}
              onSelect={setTab}
              testID={`dsh-workspace-tab-${item}`}
            />
          ))}
        </View>
      </ScrollView>
      {!connected && (
        <View style={styles.inlineNotice}>
          <Text style={ws.muted}>
            {t(
              `nativeDsh.connection.${connection === "disconnected" ? "disconnected" : "connecting"}`,
            )}
          </Text>
          <Button size="sm" variant="ghost" onPress={reconnect} disabled={busy}>
            {t("nativeDsh.reconnect")}
          </Button>
        </View>
      )}
      {(list.error !== null || workspaces.error !== null) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.workspaceOverview.readFailed")}
        </Text>
      )}
      {overview.removed ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.workspaceOverview.removed")}
        </Text>
      ) : (
        <WorkspaceContents
          key={directory.selectedWorkspaceId ?? "all"}
          runtime={runtime}
          model={model}
          overview={overview}
          creating={creating}
          onCloseCreate={closeCreate}
        />
      )}
      {directory.workspaceSection === "overview" && (
        <View style={ws.footer}>
          <RegistrationControl runtime={runtime} busy={busy} />
          {connected && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || list.state === "loading"}
              onPress={refresh}
            >
              {t("nativeDsh.refresh")}
            </Button>
          )}
          {list.phase === "ready" && list.hasMore && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || list.loadingMore}
              loading={list.loadingMore}
              onPress={loadMore}
            >
              {t("nativeDsh.loadMore")}
            </Button>
          )}
        </View>
      )}
    </View>
  );
}
