import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { BackHeader } from "@/components/headers/back-header";
import { openDesktopDshDirectory } from "../desktop/directory";
import type { DshDirectory } from "../directory";
import { AccessError, HostRow, Pairing } from "./host-pairing";
import { HostDiscovery } from "./host-discovery";
import { Sessions } from "./sessions";
import { WebConversation } from "./web-conversation";
import { styles } from "./styles";

function EnrollmentEntry({ model }: { model: DshDirectory }) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState("");
  const review = useCallback(() => {
    model.scanned(raw);
    setRaw("");
  }, [model, raw]);
  const cancel = useCallback(() => model.cancelPairing(), [model]);
  return (
    <View style={styles.group}>
      <Text style={styles.muted}>{t("nativeDsh.desktopPairingHint")}</Text>
      <Field label={t("nativeDsh.enrollmentContents")}>
        <FormTextInput
          initialValue=""
          onChangeText={setRaw}
          multiline
          numberOfLines={4}
          maxLength={4096}
          accessibilityLabel={t("nativeDsh.enrollmentContents")}
          testID="dsh-enrollment-contents"
        />
      </Field>
      <Button disabled={raw.trim() === ""} onPress={review}>
        {t("nativeDsh.reviewEnrollment")}
      </Button>
      <Button variant="ghost" onPress={cancel}>
        {t("common.actions.cancel")}
      </Button>
    </View>
  );
}

function DesktopContent({ model }: { model: DshDirectory }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const scan = useCallback(() => model.scan(), [model]);
  const reload = useCallback(() => model.reload(), [model]);
  if (state.runtime !== null && state.conversation !== null)
    return <WebConversation model={model} state={state} />;
  const idle = state.pairing.status === "idle";
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.muted}>{t("nativeDsh.desktopAccess")}</Text>
      {state.error !== null && <AccessError code={state.error} />}
      <Pairing
        model={model}
        pairing={state.pairing}
        Entry={EnrollmentEntry}
        deviceLabel={t("nativeDsh.desktopDeviceLabel")}
        retryLabel={t("nativeDsh.addHost")}
      />
      {idle && (
        <Button disabled={state.busy} testID="dsh-add-host" onPress={scan}>
          {t("nativeDsh.addHost")}
        </Button>
      )}
      {idle && state.directory.status === "loading" && (
        <Text style={styles.text}>{t("common.loading")}</Text>
      )}
      {idle && state.directory.status === "failed" && <AccessError code={state.directory.error} />}
      {idle && state.directory.status === "ready" && state.directory.hosts.length === 0 && (
        <Text style={styles.text}>{t("nativeDsh.emptyHosts")}</Text>
      )}
      {idle &&
        state.directory.status === "ready" &&
        state.directory.hosts.map((host) => (
          <HostRow key={host.hostId} model={model} host={host} busy={state.busy} />
        ))}
      {idle && (
        <Button variant="ghost" disabled={state.busy} onPress={reload}>
          {t("nativeDsh.reload")}
        </Button>
      )}
      {idle && state.discovery !== null && (
        <HostDiscovery model={model} discovery={state.discovery} pairing="device" />
      )}
      {idle && state.runtime !== null && (
        <Sessions runtime={state.runtime} model={model} busy={state.busy} />
      )}
    </ScrollView>
  );
}

export default function DesktopDshDirectoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const focused = useIsFocused();
  const [model, setModel] = useState<DshDirectory | null>(null);
  const [failed, setFailed] = useState(false);
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, [router]);
  useEffect(() => {
    if (!focused) return;
    let visible = true;
    let owned: DshDirectory | null = null;
    void openDesktopDshDirectory()
      .then(async (directory) => {
        if (!visible) {
          await directory.dispose();
          return;
        }
        owned = directory;
        setModel(directory);
        setFailed(false);
        return directory.reload();
      })
      .catch(() => {
        if (visible) setFailed(true);
      });
    return () => {
      visible = false;
      setModel(null);
      if (owned !== null) void owned.dispose().catch(() => setFailed(true));
    };
  }, [focused]);
  return (
    <View style={styles.screen}>
      <BackHeader title={t("nativeDsh.title")} onBack={back} />
      {failed && <AccessError code="runtime-unavailable" />}
      {focused && model !== null && <DesktopContent model={model} />}
    </View>
  );
}
