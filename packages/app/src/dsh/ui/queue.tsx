import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type * as dsh from "@deepseek-ai/dsh-client";
import { Button } from "@/components/ui/button";
import { styles } from "./styles";

type ContentBlock = dsh.UserMessageNode["content"][number];
type QueueEntry = Pick<
  dsh.SessionSnapshot["queue"][number],
  "content" | "placement" | "preview" | "text"
> & {
  readonly id: string;
  readonly messageId: string;
};

export type QueueAvailability = "available" | "stale" | "unavailable";

export function queueAvailability(
  state: dsh.SessionSnapshot,
  connected: boolean,
): QueueAvailability {
  // The shared snapshot has no control-baseline readiness flag. Even online rows
  // are last observed, never proof of current absence or prompt admission.
  if (state.removed || state.openState === "error") return "unavailable";
  if (!connected || state.syncing || state.openState !== "open") return "stale";
  return "available";
}

/* eslint-disable react/no-array-index-key -- DSH message blocks are ordered slots; streamed text changes within a slot. */
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

export function MessageContent({ content }: { content: readonly ContentBlock[] }) {
  return (
    <>
      {content.map((block, index) => (
        <MessageBlock key={index} block={block} />
      ))}
    </>
  );
}
/* eslint-enable react/no-array-index-key */

function QueueContent({ item }: { item: QueueEntry }) {
  const { t } = useTranslation();
  if (item.content.length > 0) return <MessageContent content={item.content} />;
  if (item.text !== null)
    return (
      <Text selectable style={styles.message}>
        {item.text}
      </Text>
    );
  if (item.preview !== "")
    return (
      <Text selectable style={styles.muted}>
        {item.preview}
      </Text>
    );
  return <Text style={styles.muted}>{t("nativeDsh.queue.unsupportedContent")}</Text>;
}

function QueueStatus({ availability, empty }: { availability: QueueAvailability; empty: boolean }) {
  const { t } = useTranslation();
  if (availability === "stale")
    return <Text style={styles.muted}>{t("nativeDsh.queue.stale")}</Text>;
  if (availability === "unavailable")
    return <Text style={styles.muted}>{t("nativeDsh.queue.unavailable")}</Text>;
  if (empty) return <Text style={styles.text}>{t("nativeDsh.queue.empty")}</Text>;
  return null;
}

interface QueueProps {
  queue: readonly QueueEntry[];
  availability: QueueAvailability;
}

export function Queue({ queue, availability }: QueueProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const empty = availability === "available" && queue.length === 0;
  return (
    <View style={styles.group}>
      <Button
        size="sm"
        variant="ghost"
        testID="dsh-queue-toggle"
        accessibilityState={accessibilityState}
        onPress={toggle}
      >
        {t("nativeDsh.queue.toggle", { count: queue.length })}
      </Button>
      {expanded && (
        <View style={styles.group}>
          <Text style={styles.title}>{t("nativeDsh.queue.title")}</Text>
          <Text style={styles.muted}>{t("nativeDsh.queue.readOnly")}</Text>
          <ScrollView
            style={styles.queue}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            testID="dsh-queue"
          >
            <QueueStatus availability={availability} empty={empty} />
            {queue.length > 20 && (
              <Text style={styles.muted} testID="dsh-queue-overflow">
                {t("nativeDsh.queue.overflow", { count: queue.length })}
              </Text>
            )}
            {queue.slice(0, 20).map((item) => (
              <View key={item.id} style={styles.queueItem} testID="dsh-queue-item">
                <Text style={styles.muted}>{t(`nativeDsh.queue.placement.${item.placement}`)}</Text>
                <QueueContent item={item} />
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
