import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useIsFocused } from "@react-navigation/native";
import { Button } from "@/components/ui/button";
import { ProductHeader } from "./product-header";
import { getIsElectron } from "@/constants/platform";
import { openBrowserDshDirectory } from "../browser/directory";
import type { DshDirectory } from "../directory";
import { WebConversation } from "./web-conversation";
import { HostDiscovery } from "./host-discovery";
import { DirectoryView } from "./workspace-screen";
import { styles } from "./styles";

async function connectPageHost(model: DshDirectory): Promise<void> {
  await model.reload();
  const { directory } = model.getSnapshot();
  if (directory.status !== "ready") return;
  const host = directory.hosts[0];
  if (host?.status === "paired") await model.connect(host.hostId);
}

function BrowserContent({ model }: { model: DshDirectory }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const retry = useCallback(() => connectPageHost(model), [model]);
  const error = state.error ?? (state.directory.status === "failed" ? state.directory.error : null);
  const conversation = useMemo(
    () =>
      state.runtime !== null && state.conversation !== null ? (
        <WebConversation model={model} state={state} />
      ) : null,
    [model, state],
  );
  return (
    <DirectoryView model={model} state={state} conversation={conversation}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.muted}>{t("nativeDsh.browserAccess")}</Text>
        {error !== null && (
          <Text accessibilityRole="alert" style={styles.error}>
            {t(`nativeDsh.errors.${error}`)}
          </Text>
        )}
        {state.busy && <Text style={styles.text}>{t("common.loading")}</Text>}
        {state.discovery !== null && (
          <HostDiscovery model={model} discovery={state.discovery} pairing="browser" />
        )}
        {state.runtime === null && (
          <Button onPress={retry} disabled={state.busy}>
            {t("nativeDsh.reloadBrowser")}
          </Button>
        )}
      </ScrollView>
    </DirectoryView>
  );
}

export default function BrowserDshDirectoryScreen() {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const electron = getIsElectron();
  const [model, setModel] = useState<DshDirectory | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!focused || electron) return;
    let visible = true;
    let owned: DshDirectory | null = null;
    void openBrowserDshDirectory()
      .then(async (directory) => {
        if (!visible) {
          await directory.dispose();
          return;
        }
        owned = directory;
        setModel(directory);
        setFailed(false);
        return connectPageHost(directory);
      })
      .catch(() => {
        if (visible) setFailed(true);
      });
    return () => {
      visible = false;
      setModel(null);
      if (owned !== null) void owned.dispose().catch(() => setFailed(true));
    };
  }, [focused, electron]);
  return (
    <View style={styles.screen}>
      <ProductHeader model={model} />
      {electron && <Text style={styles.text}>{t("nativeDsh.desktopPending")}</Text>}
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.errors.runtime-unavailable")}
        </Text>
      )}
      {focused && model !== null && <BrowserContent model={model} />}
    </View>
  );
}
