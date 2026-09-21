import { useCallback, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ConversationScheduler, SessionListState, SessionId } from "@deepseek-ai/dsh-client";
import { Button } from "@/components/ui/button";
import type { DshDirectory } from "../directory";
import type { DshHostRuntime } from "../runtime";
import { CreationControl } from "./creation-sheet";
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
  return (
    <View style={styles.row}>
      <Text style={styles.text}>{session.displayTitle}</Text>
      {pending && <Text style={styles.muted}>{t("nativeDsh.interactions.waiting")}</Text>}
      <Text style={styles.muted}>
        {session.running ? t("nativeDsh.running") : t("nativeDsh.idle")}
      </Text>
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
  const pending = useSyncExternalStore(runtime.pending.subscribe, runtime.pending.getSnapshot);
  const { t } = useTranslation();
  const generation = useSyncExternalStore(
    runtime.connection.generation.subscribe,
    runtime.connection.generation.getSnapshot,
  );
  const connection = useSyncExternalStore(
    runtime.connection.state.subscribe,
    runtime.connection.state.getSnapshot,
  );
  const list = useSyncExternalStore(
    runtime.sessions.list.subscribe,
    runtime.sessions.list.getSnapshot,
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
  return (
    <View style={styles.group} testID="dsh-session-list">
      <Text style={styles.title}>{t("nativeDsh.sessions")}</Text>
      <CreationControl runtime={runtime} onOpenSession={openCreated} busy={busy} />
      <Text style={styles.muted}>{runtime.hostId}</Text>
      <Text style={styles.text}>{t(`nativeDsh.connection.${status}`)}</Text>
      {!ready && !readFailed && <Text style={styles.muted}>{t("nativeDsh.waiting")}</Text>}
      {readFailed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.errors.session-refresh-failed")}
        </Text>
      )}
      {ready && !readFailed && list.ids.length === 0 && (
        <Text style={styles.text}>{t("nativeDsh.emptySessions")}</Text>
      )}
      {ready &&
        list.ids.map((id) => (
          <SessionRow
            key={id}
            session={list.byId[id]}
            model={model}
            busy={busy}
            pending={pending.has(id)}
          />
        ))}
      <View style={styles.actions}>
        <Button size="sm" disabled={busy} onPress={reconnect}>
          {t("nativeDsh.reconnect")}
        </Button>
        {connected && (
          <Button
            size="sm"
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
            loading={list.loadingMore}
            disabled={busy || reading || list.loadingMore}
            onPress={loadMore}
          >
            {t("nativeDsh.loadMore")}
          </Button>
        )}
      </View>
    </View>
  );
}
