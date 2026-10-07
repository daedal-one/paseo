import { useCallback, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionId } from "@deepseek-ai/dsh-client";
import { Button } from "@/components/ui/button";
import type { DshContinuum, CachedConversation } from "../continuum";
import type { DshDirectory } from "../directory";
import { styles } from "./styles";
function CachedRow({ row, model }: { row: CachedConversation; model: DshDirectory }) {
  const { t } = useTranslation();
  const open = useCallback(
    () => model.openConversation(brandString<SessionId>(row.id), null),
    [model, row.id],
  );
  return (
    <View style={styles.row}>
      <Button variant="ghost" onPress={open}>
        {row.title}
      </Button>
      <Text style={styles.muted}>
        {t("nativeDsh.continuum.cached", { time: new Date(row.savedAt).toLocaleString() })}
      </Text>
    </View>
  );
}
export function CachedSessions({ cache, model }: { cache: DshContinuum; model: DshDirectory }) {
  const state = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  return (
    <>
      {state.rows.map((row) => (
        <CachedRow key={row.id} row={row} model={model} />
      ))}
    </>
  );
}
