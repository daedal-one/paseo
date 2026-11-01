import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ConversationScheduler, SessionListState, SessionId } from "@deepseek-ai/dsh-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DshDirectory } from "../directory";
import type { DshHostRuntime } from "../runtime";
import type { workspaceOverview } from "../workspace-overview";
import { SearchControl } from "./search-sheet";
import { CreationControl } from "./creation-sheet";
import { useSnapshot } from "./use-snapshot";
import { styles } from "./styles";
import { workspaceStyles as ws } from "./workspace-styles";

export const workspaceConversationScheduler: ConversationScheduler = {
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
export function SessionRow({ session, model, busy, pending }: SessionRowProps) {
  const { t } = useTranslation();
  const open = useCallback(
    () => model.openConversation(session.id, workspaceConversationScheduler),
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
      <Button
        size="sm"
        variant="ghost"
        style={ws.touch}
        disabled={busy}
        testID={`dsh-open-session-${session.id}`}
        onPress={open}
      >
        {t("nativeDsh.conversation.open")}
      </Button>
    </View>
  );
}

export function WorkspaceExecutions({
  overview,
  runtime,
  model,
}: {
  overview: ReturnType<typeof workspaceOverview>;
  runtime: DshHostRuntime;
  model: DshDirectory;
}) {
  const { t } = useTranslation();
  const directory = useSnapshot(model);
  const list = useSnapshot(runtime.sessions.list);
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const openCreated = useCallback(
    (id: SessionId) => {
      void model.openConversation(id, workspaceConversationScheduler);
    },
    [model],
  );
  const active = overview.activity.filter((item) => item.status !== "idle");
  const recent = overview.activity.filter((item) => item.status === "idle");
  const rows = [...active, ...(expanded ? recent : recent.slice(0, 4))];
  return (
    <View style={[ws.section, ws.separator]} testID="dsh-workspace-executions">
      <View style={ws.heading}>
        <View style={ws.headingLabel}>
          <Text accessibilityRole="header" style={ws.sectionTitle}>
            {t("nativeDsh.work.executions")}
          </Text>
          <Text style={ws.muted}>{overview.activity.length}</Text>
        </View>
        <View style={ws.actions}>
          <SearchControl runtime={runtime} busy={directory.busy} onOpenSession={openCreated} />
          <CreationControl runtime={runtime} onOpenSession={openCreated} busy={directory.busy} />
        </View>
      </View>
      {rows.map((item) => (
        <SessionRow
          key={item.session.id}
          session={item.session}
          model={model}
          busy={directory.busy}
          pending={item.status === "waiting"}
        />
      ))}
      {list.phase !== "ready" && <Text style={ws.muted}>{t("nativeDsh.waiting")}</Text>}
      {list.phase === "ready" && rows.length === 0 && (
        <Text style={ws.muted}>{t("nativeDsh.workspaceOverview.noActivity")}</Text>
      )}
      {!expanded && recent.length > 4 && (
        <Button size="sm" variant="ghost" onPress={toggle}>
          {t("nativeDsh.workspaceOverview.allActivity")}
        </Button>
      )}
      {overview.unloaded > 0 && (
        <Text style={ws.muted}>
          {t("nativeDsh.workspaceOverview.unloaded", { count: overview.unloaded })}
        </Text>
      )}
    </View>
  );
}
