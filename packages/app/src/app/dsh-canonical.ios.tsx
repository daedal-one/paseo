import { useCallback, useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { connectionHostIdSchema } from "@deepseek-ai/dsh-client";
import { BackHeader } from "@/components/headers/back-header";
import { CanonicalDshView } from "@/dsh/canonical/view.ios";
import { dshDeviceStore } from "@/dsh/native/device-store";
import { styles } from "@/dsh/ui/styles";

/** Host credentials are never route parameters or React Native view props. */
export default function CanonicalDshScreen() {
  const { hostId } = useLocalSearchParams<{ hostId?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const [admitted, setAdmitted] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const back = useCallback(() => router.replace("/dsh-hosts"), [router]);
  const carrierError = useCallback(() => setFailed(true), []);
  useEffect(() => {
    let current = true;
    setAdmitted(null);
    setFailed(false);
    const parsed = connectionHostIdSchema.safeParse(hostId);
    if (!parsed.success) {
      setFailed(true);
      return;
    }
    void dshDeviceStore
      .list()
      .then((ids) => {
        if (!current) return undefined;
        if (ids.includes(parsed.data)) setAdmitted(parsed.data);
        else setFailed(true);
        return undefined;
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [hostId]);
  return (
    <View style={styles.screen}>
      <BackHeader title={t("nativeDsh.title")} onBack={back} />
      {failed ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.errors.transport-failed")}
        </Text>
      ) : null}
      {!failed && admitted === null ? <Text style={styles.text}>{t("common.loading")}</Text> : null}
      {!failed && admitted !== null ? (
        <CanonicalDshView
          key={admitted}
          hostId={admitted}
          style={fill}
          onCarrierError={carrierError}
        />
      ) : null}
    </View>
  );
}

const fill = { flex: 1 };
