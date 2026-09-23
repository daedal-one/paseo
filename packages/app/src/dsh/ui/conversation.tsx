import { memo, useCallback, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type * as dsh from "@deepseek-ai/dsh-client";
import { Button } from "@/components/ui/button";
import type { DshDirectory } from "../directory";
import type { DshConversation, DshHostRuntime } from "../runtime";
import type { DshHistory } from "../history";
import { HistoryList } from "./history-list";
import { ForkControl } from "./fork-sheet";
import { styles } from "./styles";
import { WorkspaceOutcome } from "./workspace-outcome";

// The installed Chat Definitions own the payload for each registered renderer kind.
function nodeIs<K extends dsh.ChatNodeKind>(
  node: dsh.ChatConversationViewNode,
  kind: K,
): node is dsh.ChatNode<K> {
  return node.kind === kind;
}

/* eslint-disable react/no-array-index-key -- DSH message blocks are ordered slots; streamed text changes within a slot. */
type ContentBlock = dsh.UserMessageNode["content"][number];

/**
 * Render one durable content block. Images and files are shown by their stored metadata; the
 * native client does not own attachment URLs, so the current DSH interface renders the pixels.
 */
function MessageBlock({ block }: { block: ContentBlock }) {
  const { t } = useTranslation();
  if (block.type === "text")
    return (
      <Text selectable style={styles.message} testID="dsh-block-text">
        {block.text}
      </Text>
    );
  if (block.type === "reasoning")
    return (
      <View style={styles.group} testID="dsh-block-reasoning">
        <Text style={styles.muted}>{t("nativeDsh.conversation.reasoning")}</Text>
        <Text selectable style={styles.message}>
          {block.text}
        </Text>
      </View>
    );
  if (block.type === "image")
    return (
      <View style={styles.group} testID="dsh-block-image">
        <Text style={styles.muted}>{t("nativeDsh.conversation.image")}</Text>
        <Text selectable style={styles.text}>
          {t("nativeDsh.conversation.imageDetail", {
            name: block.attachment.name ?? t("nativeDsh.conversation.imageUnnamed"),
            media: block.attachment.mediaType,
            width: block.attachment.width,
            height: block.attachment.height,
            bytes: block.attachment.bytes,
          })}
        </Text>
      </View>
    );
  if (block.type === "file")
    return (
      <View style={styles.group} testID="dsh-block-file">
        <Text style={styles.muted}>{t("nativeDsh.conversation.file")}</Text>
        <Text selectable style={styles.text}>
          {t("nativeDsh.conversation.fileDetail", {
            name: block.attachment.name,
            bytes: block.attachment.bytes,
          })}
        </Text>
      </View>
    );
  if (block.type === "tool-call")
    return (
      <View style={styles.group} testID="dsh-block-tool-call">
        <Text style={styles.muted}>{t("nativeDsh.conversation.toolCall")}</Text>
        <Text selectable style={styles.text}>
          {block.name}
        </Text>
        {block.arguments !== "" && (
          <ScrollView style={styles.detail} nestedScrollEnabled>
            <Text selectable style={styles.muted}>
              {block.arguments}
            </Text>
          </ScrollView>
        )}
      </View>
    );
  if (block.type === "tool-result")
    return (
      <View style={styles.group} testID="dsh-block-tool-result">
        <Text style={styles.muted}>
          {block.isError === true
            ? t("nativeDsh.conversation.toolFailed")
            : t("nativeDsh.conversation.toolResult")}
        </Text>
        <MessageContent content={block.content} />
      </View>
    );
  return (
    <Text style={styles.muted} testID="dsh-block-unsupported">
      {t("nativeDsh.conversation.unsupportedContent")}
    </Text>
  );
}

function MessageContent({ content }: { content: readonly ContentBlock[] }) {
  return (
    <>
      {content.map((block, index) => (
        <MessageBlock key={index} block={block} />
      ))}
    </>
  );
}

function DetailControl({ history, seq }: { history: DshHistory; seq: number }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(history.subscribe, history.getSnapshot);
  const status = state.details.get(seq);
  const load = useCallback(() => history.loadDetail(seq), [history, seq]);
  return (
    <View style={styles.group}>
      {state.detail !== "available" && (
        <Text style={styles.muted}>{t(`nativeDsh.history.${state.detail}`)}</Text>
      )}
      {status === "failed" && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.history.detailFailed")}
        </Text>
      )}
      {status === "too-large" && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.history.tooLarge")}
        </Text>
      )}
      <Button
        size="sm"
        variant="outline"
        loading={status === "loading"}
        disabled={state.detail !== "available" || status === "loading" || status === "too-large"}
        onPress={load}
      >
        {t(status === "failed" ? "nativeDsh.history.retryDetail" : "nativeDsh.history.loadDetail")}
      </Button>
    </View>
  );
}

/** Exported for the transcript presentation harness; the row wires it to its own node source. */
export function ChatContent({
  node,
  history,
}: {
  node: dsh.ChatConversationViewNode;
  history: DshHistory;
}) {
  const { t } = useTranslation();
  if (nodeIs(node, "user") || nodeIs(node, "steering") || nodeIs(node, "context")) {
    const role = node.kind === "context" ? "context" : "user";
    return (
      <>
        <Text style={styles.title}>{t(`nativeDsh.conversation.${role}`)}</Text>
        <MessageContent content={node.data.content} />
      </>
    );
  }
  if (nodeIs(node, "assistant-step")) {
    return (
      <>
        <Text style={styles.title}>{t("nativeDsh.conversation.assistant")}</Text>
        {node.data.blocks.map((block, index) => {
          if (block.kind === "text")
            return (
              <Text key={index} selectable style={styles.message} testID="dsh-block-text">
                {block.text}
              </Text>
            );
          if (block.kind === "reasoning")
            return (
              <View key={index} style={styles.group} testID="dsh-block-reasoning">
                <Text style={styles.muted}>{t("nativeDsh.conversation.reasoning")}</Text>
                <Text selectable style={styles.message}>
                  {block.text}
                </Text>
              </View>
            );
          if (block.kind === "image")
            return (
              <View key={index} style={styles.group} testID="dsh-block-image">
                <Text style={styles.muted}>{t("nativeDsh.conversation.image")}</Text>
                <Text selectable style={styles.text}>
                  {t("nativeDsh.conversation.imageDetail", {
                    name: block.attachment.name ?? t("nativeDsh.conversation.imageUnnamed"),
                    media: block.attachment.mediaType,
                    width: block.attachment.width,
                    height: block.attachment.height,
                    bytes: block.attachment.bytes,
                  })}
                </Text>
              </View>
            );
          if (block.kind === "tool-call")
            return (
              <View key={index} style={styles.group} testID="dsh-block-tool-call">
                <Text style={styles.muted}>{t("nativeDsh.conversation.toolCall")}</Text>
                <Text selectable style={styles.text}>
                  {block.name}
                </Text>
              </View>
            );
          return (
            <Text key={index} style={styles.muted} testID="dsh-block-unsupported">
              {t("nativeDsh.conversation.unsupportedContent")}
            </Text>
          );
        })}
        {node.data.status === "interrupted" && (
          <Text style={styles.muted}>{t("nativeDsh.conversation.interrupted")}</Text>
        )}
      </>
    );
  }
  if (nodeIs(node, "tool-call")) {
    const root = node.data.root;
    if ("kind" in root)
      return (
        <View style={styles.group} testID="dsh-tool-result">
          <Text style={styles.title}>
            {root.call === null ? t("nativeDsh.conversation.tool") : root.call.name}
          </Text>
          <Text style={styles.muted} testID="dsh-tool-status">
            {root.isError
              ? t("nativeDsh.conversation.toolFailed")
              : t("nativeDsh.conversation.toolFinished")}
          </Text>
          {root.subCalls.length > 0 && (
            <Text style={styles.muted} testID="dsh-tool-subcalls">
              {String(root.subCalls.length)}
            </Text>
          )}
          {root.deferred ? (
            <DetailControl history={history} seq={root.seq} />
          ) : (
            <ScrollView
              style={styles.detail}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              <MessageContent content={root.content} />
            </ScrollView>
          )}
        </View>
      );
    return (
      <View style={styles.group} testID="dsh-tool-running">
        <Text style={styles.title}>{root.name}</Text>
        <Text style={styles.muted}>{t("nativeDsh.running")}</Text>
      </View>
    );
  }
  if (nodeIs(node, "turn-process"))
    return (
      <Text style={styles.muted} testID="dsh-turn-process">
        {node.data.subagentCount > 0
          ? t("nativeDsh.conversation.processSubagents", {
              messages: node.data.messageCount,
              tools: node.data.toolCallCount,
              subagents: node.data.subagentCount,
            })
          : t("nativeDsh.conversation.process", {
              messages: node.data.messageCount,
              tools: node.data.toolCallCount,
            })}
      </Text>
    );
  if (nodeIs(node, "workspace-state")) return <WorkspaceOutcome node={node} />;
  if (nodeIs(node, "turn-tail")) return null;
  if (nodeIs(node, "turn-error"))
    return (
      <View style={styles.group} testID="dsh-turn-error">
        <Text style={styles.error}>{t("nativeDsh.conversation.turnFailed")}</Text>
        {node.data.message !== "" && (
          <Text selectable style={styles.error}>
            {node.data.message}
          </Text>
        )}
      </View>
    );
  return (
    <Text style={styles.muted} testID="dsh-node-unsupported">
      {t("nativeDsh.conversation.unsupportedContent")}
    </Text>
  );
}

/* eslint-enable react/no-array-index-key */

const ChatRow = memo(function ChatRow({
  source,
  history,
}: {
  source: dsh.ChatNodeSource;
  history: DshHistory;
}) {
  const node = useSyncExternalStore(source.subscribe, source.getSnapshot);
  if (node === undefined || node.visibility === "hidden") return null;
  if (node.kind === "turn-tail") return null;
  return (
    <View style={[styles.row, styles.historyRow]}>
      <ChatContent node={node} history={history} />
    </View>
  );
});

const Transcript = memo(function Transcript({
  view,
  ready,
}: {
  view: DshConversation;
  ready: boolean;
}) {
  const { t } = useTranslation();
  const target = view.conversation.target("chat");
  const snapshot = useSyncExternalStore(target.subscribe, target.getSnapshot);
  const order = snapshot?.order;
  const renderItem = useCallback(
    (key: string) => {
      if (snapshot === undefined) return null;
      return <ChatRow source={snapshot.nodes.source(key)} history={view.history} />;
    },
    [snapshot, view],
  );
  if (snapshot === undefined || order === undefined) return null;
  if (ready && order.length === 0)
    return <Text style={styles.text}>{t("nativeDsh.conversation.empty")}</Text>;
  return (
    <HistoryList keys={order} renderItem={renderItem} latestLabel={t("nativeDsh.history.latest")} />
  );
});

interface ConversationProps {
  model: DshDirectory;
  runtime: DshHostRuntime;
  view: DshConversation;
  busy: boolean;
}

export function Conversation({ model, runtime, view, busy }: ConversationProps) {
  const { t } = useTranslation();
  const session = view.session;
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  const getSnapshot = useCallback(() => session.getSnapshot(), [session]);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const list = useSyncExternalStore(
    runtime.sessions.list.subscribe,
    runtime.sessions.list.getSnapshot,
  );
  const title = list.byId[view.sessionId]?.displayTitle ?? t("nativeDsh.conversation.title");
  const generation = useSyncExternalStore(
    runtime.connection.generation.subscribe,
    runtime.connection.generation.getSnapshot,
  );
  const back = useCallback(() => model.closeConversation(), [model]);
  const retry = useCallback(() => model.retryConversation(), [model]);
  const reconnect = useCallback(() => model.reconnect(), [model]);
  const history = useSyncExternalStore(view.history.subscribe, view.history.getSnapshot);
  const loading = state.openState === "cold" || state.openState === "loading";
  const ready = state.openState === "open";
  return (
    <View style={styles.fill} testID="dsh-conversation">
      <View style={styles.conversationHeader}>
        <Button variant="ghost" onPress={back}>
          {t("nativeDsh.conversation.back")}
        </Button>
        <Text style={styles.title}>{title}</Text>
        <ForkControl runtime={runtime} sessionId={view.sessionId} busy={busy} />
        {generation === undefined && (
          <>
            <Text style={styles.muted}>{t("nativeDsh.conversation.offline")}</Text>
            <Button size="sm" disabled={busy} onPress={reconnect}>
              {t("nativeDsh.reconnect")}
            </Button>
          </>
        )}
        {loading && <Text style={styles.text}>{t("common.loading")}</Text>}
        {state.syncing && <Text style={styles.muted}>{t("nativeDsh.conversation.syncing")}</Text>}
        {state.removed && <Text style={styles.error}>{t("nativeDsh.conversation.removed")}</Text>}
        {state.openState === "error" && (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              {t("nativeDsh.conversation.readFailed")}
            </Text>
            <Button
              size="sm"
              disabled={busy || generation === undefined || state.removed}
              onPress={retry}
            >
              {t("nativeDsh.conversation.retry")}
            </Button>
          </>
        )}
        {state.hasMore && (
          <View style={styles.group}>
            {history.older !== "available" && (
              <Text style={styles.muted}>{t(`nativeDsh.history.${history.older}`)}</Text>
            )}
            {state.olderError !== null && (
              <Text accessibilityRole="alert" style={styles.error}>
                {t("nativeDsh.history.pageFailed")}
              </Text>
            )}
            <Button
              variant="ghost"
              size="sm"
              loading={state.loadingOlder}
              disabled={
                busy ||
                !ready ||
                state.syncing ||
                state.removed ||
                state.loadingOlder ||
                history.older !== "available"
              }
              onPress={view.history.loadOlder}
              testID="dsh-load-older"
            >
              {t(
                state.olderError === null
                  ? "nativeDsh.history.loadOlder"
                  : "nativeDsh.history.retryOlder",
              )}
            </Button>
          </View>
        )}
      </View>
      <Transcript view={view} ready={ready} />
    </View>
  );
}
