import { useCallback } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { BackHeader } from "@/components/headers/back-header";
import { styles } from "./styles";

export default function DshDirectoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, [router]);
  return (
    <View style={styles.screen}>
      <BackHeader title={t("nativeDsh.title")} onBack={back} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.text}>{t("nativeDsh.iosOnly")}</Text>
      </ScrollView>
    </View>
  );
}
