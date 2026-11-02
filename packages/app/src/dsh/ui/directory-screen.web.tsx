import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ProductHeader } from "./product-header";
import { qualifyCanonicalBrowser } from "../canonical/handoff";
import { styles } from "./styles";

/** Browser navigation mounts the Host's canonical graph, never a second Session runtime. */
export default function BrowserDshDirectoryScreen() {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    void qualifyCanonicalBrowser(fetch, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) location.assign("/daedal/workspace");
        return undefined;
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <View style={styles.screen}>
      <ProductHeader model={null} />
      {failed ? (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {t("nativeDsh.errors.runtime-unavailable")}
          </Text>
          <Button onPress={retry}>{t("nativeDsh.reloadBrowser")}</Button>
        </>
      ) : (
        <Text style={styles.text}>{t("common.loading")}</Text>
      )}
    </View>
  );
}
