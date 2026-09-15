import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { CompanionHost } from "@getpaseo/protocol/companion-discovery";
import type { HostProfile } from "@/types/host-connection";
import { useHostMutations } from "@/runtime/host-runtime";
import { CompanionPairingError, pairCompanion } from "@/utils/companion-pairing";
import { connectToDaemon } from "@/utils/test-daemon-connection";
import { Field, FormTextInput } from "./ui/form-field";
import { Button } from "./ui/button";

export function CompanionConnectForm({
  host,
  onConnected,
  onCancel,
}: {
  host: CompanionHost;
  onConnected: (profile: HostProfile) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { upsertDirectConnection } = useHostMutations();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const connect = useCallback(async () => {
    if (controller.current && !controller.current.signal.aborted) return;
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setError("");
    try {
      const profile = await pairCompanion(host, password, current.signal, {
        probe: async (endpoint, secret) => {
          const result = await connectToDaemon(
            {
              id: "probe",
              type: "directTcp",
              endpoint,
              useTls: false,
              ...(secret ? { password: secret } : {}),
            },
            { timeoutMs: 8_000 },
          );
          return { serverId: result.serverId, close: () => result.client.close() };
        },
        save: upsertDirectConnection,
      });
      if (!current.signal.aborted) onConnected(profile);
    } catch (reason) {
      if (!current.signal.aborted)
        setError(
          reason instanceof CompanionPairingError
            ? t(`pairing.discovery.${reason.code}`)
            : t("pairing.discovery.connectionFailed"),
        );
    } finally {
      if (!current.signal.aborted) setPending(false);
      current.abort();
    }
  }, [host, onConnected, password, t, upsertDirectConnection]);
  const handleConnect = useCallback(() => {
    void connect();
  }, [connect]);
  return (
    <View style={styles.container} testID="companion-connect-form">
      <Text style={styles.name}>{host.hostname}</Text>
      <Text style={styles.helper}>{t("pairing.discovery.connectHint")}</Text>
      {host.passwordRequired ? (
        <Field label={t("pairing.direct.fields.password")}>
          <FormTextInput
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t("pairing.direct.fields.password")}
            placeholder={t("pairing.direct.fields.password")}
            onChangeText={setPassword}
            editable={!pending}
            testID="companion-password"
          />
        </Field>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        onPress={handleConnect}
        loading={pending}
        disabled={pending || (host.passwordRequired && !password)}
        testID="companion-connect"
      >
        {t("pairing.discovery.connect")}
      </Button>
      <Button onPress={onCancel} disabled={pending} variant="ghost">
        {t("pairing.direct.actions.cancel")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { gap: theme.spacing[3] },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  helper: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.base },
}));
