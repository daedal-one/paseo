import { useCallback, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { DshDirectory } from "../directory";
import { styles } from "./styles";
import { AccessError } from "./host-pairing";
export function CachedConversation({ model }: { model: DshDirectory }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const back = useCallback(() => model.closeConversation(), [model]);
  const reconnect = useCallback(() => model.reconnect(), [model]);
  const row = state.cache?.getSnapshot().rows.find((item) => item.id === state.cachedSessionId);
  return (
    <View style={styles.fill} testID="dsh-cached-conversation">
      <View style={styles.conversationHeader}>
        <Button variant="ghost" onPress={back}>
          {t("nativeDsh.conversation.back")}
        </Button>
        <Text style={styles.title}>{row?.title ?? t("nativeDsh.conversation.title")}</Text>
        <Text style={styles.muted}>
          {row === undefined
            ? t("nativeDsh.waiting")
            : t("nativeDsh.continuum.cached", { time: new Date(row.savedAt).toLocaleString() })}
        </Text>
        <Button onPress={reconnect}>{t("nativeDsh.reconnect")}</Button>
      </View>
      {state.error !== null && <AccessError code={state.error} />}
      <ScrollView contentContainerStyle={styles.content}>
        <Text selectable style={styles.message}>
          {row?.text ?? ""}
        </Text>
      </ScrollView>
    </View>
  );
}
