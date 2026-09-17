import { useCallback, type ComponentType } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { DshDirectory, DshDirectoryHost, DshPairingState } from "../directory";
import type { DshAccessErrorCode } from "../access-error";
import { styles } from "./styles";

export function AccessError({ code }: { code: DshAccessErrorCode }) {
  const { t } = useTranslation();
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {t(`nativeDsh.errors.${code}`)}
    </Text>
  );
}

interface PairingProps {
  model: DshDirectory;
  pairing: DshPairingState;
  Entry: ComponentType<{ model: DshDirectory }>;
  deviceLabel: string;
  retryLabel: string;
}
export function Pairing({ model, pairing, Entry, deviceLabel, retryLabel }: PairingProps) {
  const { t } = useTranslation();
  const scan = useCallback(() => model.scan(), [model]);
  const cancel = useCallback(() => model.cancelPairing(), [model]);
  const pair = useCallback(() => model.pair(deviceLabel), [model, deviceLabel]);
  switch (pairing.status) {
    case "idle":
      return null;
    case "scanning":
      return <Entry model={model} />;
    case "claiming":
      return <Text style={styles.text}>{t("nativeDsh.pairing")}</Text>;
    case "failed":
      return (
        <View style={styles.group}>
          <AccessError code={pairing.error} />
          <Button onPress={scan}>{retryLabel}</Button>
          <Button variant="ghost" onPress={cancel}>
            {t("common.actions.cancel")}
          </Button>
        </View>
      );
    case "review":
      return (
        <View style={styles.group}>
          <Text style={styles.title}>{t("nativeDsh.confirmPairing")}</Text>
          <Text style={styles.text} selectable>
            {pairing.pairing.origin}
          </Text>
          <Text style={styles.muted} selectable>
            {t("nativeDsh.identity", { id: pairing.pairing.enrollment.hostId })}
          </Text>
          <Text style={styles.muted}>{t("nativeDsh.pairingTrust")}</Text>
          <Button variant="default" testID="dsh-confirm-pairing" onPress={pair}>
            {t("nativeDsh.pair")}
          </Button>
          <Button variant="ghost" onPress={cancel}>
            {t("common.actions.cancel")}
          </Button>
        </View>
      );
  }
}

interface HostRowProps {
  model: DshDirectory;
  host: DshDirectoryHost;
  busy: boolean;
}
export function HostRow({ model, host, busy }: HostRowProps) {
  const { t } = useTranslation();
  const forget = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("nativeDsh.forget"),
      message: t("nativeDsh.forgetHint"),
      confirmLabel: t("nativeDsh.forget"),
      cancelLabel: t("common.actions.cancel"),
      destructive: true,
    });
    if (confirmed) await model.forget(host.hostId);
  }, [model, host.hostId, t]);
  const connect = useCallback(() => model.connect(host.hostId), [model, host.hostId]);
  return (
    <View style={styles.row}>
      {host.status === "paired" ? (
        <>
          <Text style={styles.title}>{host.origin}</Text>
          <Text style={styles.muted}>{host.label}</Text>
        </>
      ) : (
        <AccessError code={host.error} />
      )}
      <Text style={styles.muted} selectable>
        {host.hostId}
      </Text>
      <View style={styles.actions}>
        {host.status === "paired" && (
          <Button size="sm" disabled={busy} onPress={connect}>
            {t("nativeDsh.connect")}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onPress={forget}>
          {t("nativeDsh.forget")}
        </Button>
      </View>
    </View>
  );
}
