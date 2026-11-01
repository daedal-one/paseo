import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type {
  ConversationScheduler,
  SessionListState,
  SessionId,
  WorkspaceId,
} from "@deepseek-ai/dsh-client";
import { SelectField } from "@/components/ui/select-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { workspaceOverview } from "../workspace-overview";
import { Button } from "@/components/ui/button";
import type { DshDirectory, WorkspaceSection } from "../directory";
import type { DshHostRuntime } from "../runtime";
import { SearchControl } from "./search-sheet";
import { RegistrationControl } from "./registration-sheet";
import { CreationControl } from "./creation-sheet";
import { useSnapshot } from "./use-snapshot";
import { ChoiceTab } from "./choice-tab";
import { styles } from "./styles";

const conversationScheduler: ConversationScheduler = {
  schedule(publish) {
    const frame = requestAnimationFrame(publish);
    return () => cancelAnimationFrame(frame);
  },
};

interface SessionRowProps {
  pending: boolean;
  session: SessionListState["byId"][SessionId];
  model: DshDirectory;
  busy: boolean;
}
function SessionRow({ session, model, busy, pending }: SessionRowProps) {
  const { t } = useTranslation();
  const open = useCallback(
    () => model.openConversation(session.id, conversationScheduler),
    [model, session.id],
  );
  let variant: "warning" | "success" | "muted" = "muted";
  let statusKey: "nativeDsh.idle" | "nativeDsh.running" | "nativeDsh.interactions.waiting" =
    "nativeDsh.idle";
  if (session.running) {
    variant = "success";
    statusKey = "nativeDsh.running";
  }
  if (pending) {
    variant = "warning";
    statusKey = "nativeDsh.interactions.waiting";
  }
  return (
    <View style={styles.activityRow}>
      <Text style={[styles.text, styles.activityTitle]} numberOfLines={2}>
        {session.displayTitle}
      </Text>
      <StatusBadge variant={variant} label={t(statusKey)} />
      <Button size="sm" disabled={busy} testID={`dsh-open-session-${session.id}`} onPress={open}>
        {t("nativeDsh.conversation.open")}
      </Button>
    </View>
  );
}

interface SessionsProps {
  runtime: DshHostRuntime;
  model: DshDirectory;
  busy: boolean;
}
export function Sessions({ runtime, model, busy }: SessionsProps) {
  const openCreated = useCallback(
    (id: SessionId) => {
      void model.openConversation(id, conversationScheduler);
    },
    [model],
  );
  const setTab = useCallback((tab: WorkspaceSection) => model.selectWorkspaceSection(tab), [model]);
  const directory = useSnapshot(model);
  const tab = directory.workspaceSection;
  const workspaces = useSnapshot(runtime.workspaces.list);
  const pending = useSnapshot(runtime.pending);
  const { t } = useTranslation();
  const generation = useSnapshot(runtime.connection.generation);
  const connection = useSnapshot(runtime.connection.state);
  const list = useSnapshot(runtime.sessions.list);
  const overview = useMemo(
    () =>
      workspaceOverview(workspaces, list, directory.selectedWorkspaceId, (id) => pending.has(id)),
    [workspaces, list, directory.selectedWorkspaceId, pending],
  );
  const select = useCallback(
    (id: WorkspaceId | "all") => model.selectWorkspace(id === "all" ? null : id),
    [model],
  );
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
  let status: "connected" | "connecting" | "disconnected" = "connecting";
  if (generation !== undefined) status = "connected";
  else if (connection === "disconnected") status = "disconnected";
  const connected = generation !== undefined;
  const ready = connected && list.phase === "ready";
  const readFailed = connected && list.error !== null;
  const reading = connected && list.state === "loading";
  const reconnect = useCallback(() => model.reconnect(), [model]);
  const refresh = useCallback(() => model.refreshSessions(), [model]);
  const loadMore = useCallback(() => model.loadMoreSessions(), [model]);
  const display = useMemo(
    () => ({ label: overview.workspace?.title ?? t("nativeDsh.workspaceOverview.all") }),
    [overview.workspace, t],
  );
  const showWork = useCallback(() => setTab("work"), [setTab]);
  const showFiles = useCallback(() => setTab("files"), [setTab]);
  const empty = useMemo(
    () =>
      ready &&
      workspaces.phase === "ready" &&
      !readFailed &&
      workspaces.error === null &&
      overview.activity.length === 0 &&
      overview.unloaded === 0,
    [ready, workspaces, readFailed, overview],
  );
  return (
    <View style={styles.workspace} testID="dsh-session-list">
      <View style={styles.workspaceToolbar}>
        <View style={styles.workspacePicker}>
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
        <View style={styles.workspaceActions}>
          <SearchControl runtime={runtime} busy={busy} onOpenSession={openCreated} />
          <CreationControl runtime={runtime} onOpenSession={openCreated} busy={busy} />
        </View>
      </View>
      <View style={styles.workspaceBody}>
        <View style={styles.workspaceTabs} accessibilityRole="tablist">
          {(["overview", "work", "files", "memory"] as const).map((item) => (
            <ChoiceTab
              key={item}
              value={item}
              selected={tab}
              label={t(`nativeDsh.workspaceOverview.tabs.${item}`)}
              onSelect={setTab}
              testID={`dsh-workspace-tab-${item}`}
            />
          ))}
        </View>
        <View style={styles.workspaceCanvas}>
          <View style={styles.workspaceHeading}>
            <Text accessibilityRole="header" style={styles.workspaceTitle}>
              {overview.workspace?.title ?? t("nativeDsh.workspaceOverview.all")}
            </Text>
            <Text style={styles.muted}>{t(`nativeDsh.workspaceOverview.descriptions.${tab}`)}</Text>
          </View>
          <WorkspaceNotices
            connected={connected}
            status={status}
            failed={readFailed || workspaces.error !== null}
            waiting={!ready || workspaces.phase !== "ready"}
            removed={overview.removed}
            busy={busy}
            onReconnect={reconnect}
          />
          <WorkspacePanels
            overview={overview}
            tab={tab}
            model={model}
            busy={busy}
            empty={empty}
            showWork={showWork}
            showFiles={showFiles}
          />
        </View>
      </View>
      <View style={styles.workspaceFooter}>
        <RegistrationControl runtime={runtime} busy={busy} />
        {connected && (
          <Button
            size="sm"
            variant="ghost"
            loading={reading}
            disabled={busy || reading || list.loadingMore}
            onPress={refresh}
          >
            {t("nativeDsh.refresh")}
          </Button>
        )}
        {ready && list.hasMore && (
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
    </View>
  );
}

type Overview = ReturnType<typeof workspaceOverview>;
function WorkspaceNotices({
  connected,
  status,
  failed,
  waiting,
  removed,
  busy,
  onReconnect,
}: {
  connected: boolean;
  status: "connected" | "connecting" | "disconnected";
  failed: boolean;
  waiting: boolean;
  removed: boolean;
  busy: boolean;
  onReconnect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View>
      {!connected && (
        <View style={styles.inlineNotice}>
          <Text style={styles.muted}>{t(`nativeDsh.connection.${status}`)}</Text>
          <Button size="sm" variant="ghost" onPress={onReconnect} disabled={busy}>
            {t("nativeDsh.reconnect")}
          </Button>
        </View>
      )}
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.workspaceOverview.readFailed")}
        </Text>
      )}
      {waiting && <Text style={styles.muted}>{t("nativeDsh.waiting")}</Text>}
      {removed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.workspaceOverview.removed")}
        </Text>
      )}
    </View>
  );
}
function WorkspacePanels({
  overview,
  tab,
  model,
  busy,
  empty,
  showWork,
  showFiles,
}: {
  overview: Overview;
  tab: "overview" | "work" | "files" | "memory";
  model: DshDirectory;
  busy: boolean;
  empty: boolean;
  showWork: () => void;
  showFiles: () => void;
}) {
  const { t } = useTranslation();
  if (overview.removed) return null;
  if (tab === "files")
    return (
      <View style={styles.workspaceSection}>
        <Text style={styles.sectionTitle}>{t("nativeDsh.workspaceOverview.filesTitle")}</Text>
        <Text selectable style={styles.text}>
          {overview.workspace?.path}
        </Text>
        <Text style={styles.muted}>{t("nativeDsh.workspaceOverview.filesScope")}</Text>
        <Text style={styles.muted}>{t("nativeDsh.workspaceOverview.filesUnavailable")}</Text>
      </View>
    );
  if (tab === "memory")
    return <Text style={styles.muted}>{t("nativeDsh.workspaceOverview.memoryUnavailable")}</Text>;
  return (
    <View style={styles.workspaceColumns}>
      <WorkspaceActivity
        overview={overview}
        all={tab === "work"}
        model={model}
        busy={busy}
        empty={empty}
        showWork={showWork}
      />
      {tab === "overview" && (
        <View style={styles.workspaceAside}>
          <View style={styles.workspaceSection}>
            <Text style={styles.sectionTitle}>{t("nativeDsh.workspaceOverview.tabs.files")}</Text>
            <Text selectable style={styles.muted}>
              {overview.workspace?.path}
            </Text>
            <Text style={styles.muted}>{t("nativeDsh.workspaceOverview.filesScope")}</Text>
            <Button size="sm" variant="ghost" onPress={showFiles}>
              {t("nativeDsh.workspaceOverview.viewFiles")}
            </Button>
          </View>
          <View style={styles.workspaceSection}>
            <Text style={styles.sectionTitle}>{t("nativeDsh.workspaceOverview.tabs.memory")}</Text>
            <Text style={styles.muted}>{t("nativeDsh.workspaceOverview.memoryUnavailable")}</Text>
          </View>
        </View>
      )}
    </View>
  );
}
function WorkspaceActivity({
  overview,
  all,
  model,
  busy,
  empty,
  showWork,
}: {
  overview: Overview;
  all: boolean;
  model: DshDirectory;
  busy: boolean;
  empty: boolean;
  showWork: () => void;
}) {
  const { t } = useTranslation();
  const groups = [
    { key: "needsYou", rows: overview.activity.filter((item) => item.status === "waiting") },
    { key: "inProgress", rows: overview.activity.filter((item) => item.status === "running") },
    { key: "recent", rows: overview.activity.filter((item) => item.status === "idle") },
  ] as const;
  return (
    <View style={styles.workspaceMain}>
      {groups.map((group) =>
        group.rows.length === 0 ? null : (
          <View key={group.key} style={styles.workspaceSection}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>
                {t(`nativeDsh.workspaceOverview.${group.key}`)}
              </Text>
              <Text style={styles.muted}>{group.rows.length}</Text>
            </View>
            {(group.key === "recent" && !all ? group.rows.slice(0, 8) : group.rows).map((item) => (
              <SessionRow
                key={item.session.id}
                session={item.session}
                model={model}
                busy={busy}
                pending={item.status === "waiting"}
              />
            ))}
          </View>
        ),
      )}
      {!all && groups[2].rows.length > 8 && (
        <Button size="sm" variant="ghost" onPress={showWork}>
          {t("nativeDsh.workspaceOverview.allActivity")}
        </Button>
      )}
      {empty && <Text style={styles.muted}>{t("nativeDsh.workspaceOverview.noActivity")}</Text>}
      {overview.unloaded > 0 && (
        <Text style={styles.muted}>
          {t("nativeDsh.workspaceOverview.unloaded", { count: overview.unloaded })}
        </Text>
      )}
    </View>
  );
}
