import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Linking, ScrollView, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeSettings,
} from "expo-camera";
import { Button } from "@/components/ui/button";
import { BackHeader } from "@/components/headers/back-header";
import { DshDirectory, openDshDirectory } from "../native/directory";
import type { SessionPendingInteraction } from "@deepseek-ai/dsh-client";
import { Conversation } from "./conversation";
import { Sessions } from "./sessions";
import { SessionComposer } from "./interactions";
import type { DshInteractionForm } from "../interaction-form";
import { KeyboardDock } from "@/components/keyboard-dock";
import { ComposerViewport, ComposerViewportContent } from "@/composer/viewport";
import { useSettledKeyboardShift } from "@/hooks/keyboard-shift-context";
import { AccessError, HostRow, Pairing } from "./host-pairing";
import { styles } from "./styles";

const barcodeSettings: BarcodeSettings = { barcodeTypes: ["qr"] };

function Scanner({ model }: { model: DshDirectory }) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [failed, setFailed] = useState(false);
  const focused = useIsFocused();
  const requestCamera = useCallback(async () => {
    setFailed(false);
    try {
      if (permission?.canAskAgain === false) await Linking.openSettings();
      else await requestPermission();
    } catch {
      setFailed(true);
    }
  }, [permission, requestPermission]);
  const scan = useCallback((result: BarcodeScanningResult) => model.scanned(result.data), [model]);
  const mountError = useCallback(() => setFailed(true), []);
  const cancel = useCallback(() => model.cancelPairing(), [model]);
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{t("nativeDsh.scanHint")}</Text>
      {permission?.granted && focused && !failed ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={barcodeSettings}
          onBarcodeScanned={scan}
          onMountError={mountError}
        />
      ) : (
        <Button onPress={requestCamera}>{t("nativeDsh.cameraPermission")}</Button>
      )}
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.cameraFailed")}
        </Text>
      )}
      <Button variant="ghost" onPress={cancel}>
        {t("common.actions.cancel")}
      </Button>
    </View>
  );
}

function DirectoryContent({ model }: { model: DshDirectory }) {
  const [forms] = useState(() => new WeakMap<SessionPendingInteraction, DshInteractionForm>());
  const { t } = useTranslation();
  const keyboardShift = useSettledKeyboardShift();
  const historyInset = useMemo(() => ({ height: keyboardShift }), [keyboardShift]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const idle = state.pairing.status === "idle";
  const scan = useCallback(() => model.scan(), [model]);
  const reload = useCallback(() => model.reload(), [model]);
  if (state.runtime !== null && state.conversation !== null)
    return (
      <ComposerViewport key={state.conversation.sessionId} style={layoutStyles.viewport}>
        <KeyboardDock style={layoutStyles.fill}>
          <ScrollView
            style={layoutStyles.fill}
            contentInsetAdjustmentBehavior="never"
            keyboardShouldPersistTaps="handled"
          >
            <View style={historyInset} />
            <View style={styles.content}>
              {state.error !== null && <AccessError code={state.error} />}
              <Conversation
                model={model}
                runtime={state.runtime}
                view={state.conversation}
                busy={state.busy}
              />
            </View>
          </ScrollView>
          <ComposerViewportContent style={layoutStyles.composer}>
            <SessionComposer runtime={state.runtime} view={state.conversation} forms={forms} />
          </ComposerViewportContent>
        </KeyboardDock>
      </ComposerViewport>
    );
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.muted}>{t("nativeDsh.preview")}</Text>
      {state.error !== null && <AccessError code={state.error} />}
      <Pairing
        model={model}
        pairing={state.pairing}
        Entry={Scanner}
        deviceLabel={t("nativeDsh.deviceLabel")}
        retryLabel={t("nativeDsh.scanAgain")}
      />
      {idle && (
        <Button variant="default" disabled={state.busy} testID="dsh-scan-pairing" onPress={scan}>
          {t("nativeDsh.scan")}
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
          <HostRow key={host.hostId} host={host} model={model} busy={state.busy} />
        ))}
      {idle && (
        <Button variant="ghost" disabled={state.busy} onPress={reload}>
          {t("nativeDsh.reload")}
        </Button>
      )}
      {idle && state.runtime !== null && (
        <Sessions runtime={state.runtime} model={model} busy={state.busy} />
      )}
    </ScrollView>
  );
}

export default function DshDirectoryScreen() {
  const insets = useSafeAreaInsets();
  const safeArea = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
  const { t } = useTranslation();
  const router = useRouter();
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, [router]);
  const focused = useIsFocused();
  const [model, setModel] = useState<DshDirectory | null>(null);
  const [disposeFailed, setDisposeFailed] = useState(false);
  useEffect(() => {
    if (!focused) return;
    let visible = true;
    let owned: DshDirectory | null = null;
    void openDshDirectory()
      .then(async (directory) => {
        if (!visible) {
          await directory.dispose();
          return;
        }
        owned = directory;
        setModel(owned);
        setDisposeFailed(false);
        return owned.reload();
      })
      .catch(() => {
        if (visible) setDisposeFailed(true);
      });
    return () => {
      visible = false;
      setModel(null);
      if (owned !== null) void owned.dispose().catch(() => setDisposeFailed(true));
    };
  }, [focused]);
  return (
    <View style={[styles.screen, safeArea]}>
      <BackHeader title={t("nativeDsh.title")} onBack={back} />
      {disposeFailed && <AccessError code="runtime-unavailable" />}
      {focused && model !== null && <DirectoryContent model={model} />}
    </View>
  );
}

const layoutStyles = RNStyleSheet.create({
  viewport: { flex: 1, overflow: "hidden" },
  fill: { flex: 1 },
  composer: { width: "100%", flexShrink: 1 },
});
