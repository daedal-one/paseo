import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeSettings,
} from "expo-camera";
import { Button } from "@/components/ui/button";
import { ProductHeader } from "./product-header";
import { DshDirectory, openDshDirectory } from "../native/directory";
import type { ConnectionHostId } from "@deepseek-ai/dsh-client";
import { useRouter } from "expo-router";
import { HostDiscovery } from "./host-discovery";
import { DirectoryView } from "./workspace-screen";
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

function DirectoryContent({
  model,
  onConnect,
}: {
  model: DshDirectory;
  onConnect(hostId: ConnectionHostId): Promise<void>;
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const idle = state.pairing.status === "idle";
  const scan = useCallback(() => model.scan(), [model]);
  const reload = useCallback(() => model.reload(), [model]);
  return (
    <DirectoryView model={model} state={state} conversation={null}>
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
        {idle && state.directory.status === "failed" && (
          <AccessError code={state.directory.error} />
        )}
        {idle && state.directory.status === "ready" && state.directory.hosts.length === 0 && (
          <Text style={styles.text}>{t("nativeDsh.emptyHosts")}</Text>
        )}
        {idle &&
          state.directory.status === "ready" &&
          state.directory.hosts.map((host) => (
            <HostRow
              key={host.hostId}
              host={host}
              model={model}
              busy={state.busy}
              onConnect={onConnect}
            />
          ))}
        {idle && (
          <Button variant="ghost" disabled={state.busy} onPress={reload}>
            {t("nativeDsh.reload")}
          </Button>
        )}
        {idle && state.discovery !== null && (
          <HostDiscovery model={model} discovery={state.discovery} pairing="device" />
        )}
      </ScrollView>
    </DirectoryView>
  );
}

export default function DshDirectoryScreen() {
  const insets = useSafeAreaInsets();
  const safeArea = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
  const focused = useIsFocused();
  const router = useRouter();
  const [epoch, setEpoch] = useState(0);
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
  }, [focused, epoch]);
  const connect = useCallback(
    async (hostId: ConnectionHostId) => {
      if (model === null) return;
      try {
        await model.dispose();
        router.replace({ pathname: "/dsh-canonical", params: { hostId } });
      } catch {
        setDisposeFailed(true);
        setEpoch((value) => value + 1);
      }
    },
    [model, router],
  );
  return (
    <View style={[styles.screen, safeArea]}>
      <ProductHeader model={model} />
      {disposeFailed && <AccessError code="runtime-unavailable" />}
      {focused && model !== null && <DirectoryContent model={model} onConnect={connect} />}
    </View>
  );
}
