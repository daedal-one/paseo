import { useCallback, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { HostDiscoveryCandidate } from "@deepseek-ai/dsh-client";
import { Button } from "@/components/ui/button";
import type { DshDirectory, DshDirectoryHost } from "../directory";
import type { DshDiscovery } from "../discovery";
import { styles } from "./styles";

function Candidate({
  model,
  candidate,
  saved,
  busy,
  pairing,
}: {
  model: DshDirectory;
  candidate: HostDiscoveryCandidate;
  saved: DshDirectoryHost | undefined;
  busy: boolean;
  pairing: "device" | "browser";
}) {
  const { t } = useTranslation();
  const select = useCallback(
    () => model.selectDiscoveredHost(candidate.identity.hostId),
    [model, candidate.identity.hostId],
  );
  return (
    <View style={styles.row} testID={`dsh-candidate-${candidate.identity.hostId}`}>
      <Text style={styles.text}>{candidate.label}</Text>
      <Text style={styles.muted} selectable>
        {candidate.origin}
      </Text>
      <Text style={styles.muted} selectable>
        {t("nativeDsh.identity", { id: candidate.identity.hostId })}
      </Text>
      {saved?.status === "paired" && (
        <Text style={styles.muted}>
          {t("nativeDsh.discovery.savedOrigin", { origin: saved.origin })}
        </Text>
      )}
      {pairing === "device" && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || saved?.status === "unavailable"}
          onPress={select}
        >
          {saved?.status === "paired" ? t("nativeDsh.connect") : t("nativeDsh.discovery.pair")}
        </Button>
      )}
      {saved?.status === "unavailable" && (
        <Text style={styles.muted}>{t("nativeDsh.discovery.recover")}</Text>
      )}
    </View>
  );
}

export function HostDiscovery({
  model,
  discovery,
  pairing,
}: {
  model: DshDirectory;
  discovery: DshDiscovery;
  pairing: "device" | "browser";
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(discovery.subscribe, discovery.getSnapshot);
  const directory = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const candidates =
    state.status === "ready"
      ? state.candidates.filter(
          (candidate) => candidate.identity.hostId !== directory.runtime?.hostId,
        )
      : [];
  const saved = directory.directory.status === "ready" ? directory.directory.hosts : [];
  return (
    <View style={styles.group} testID="dsh-host-discovery">
      <Text style={styles.title}>{t("nativeDsh.discovery.title")}</Text>
      <Text style={styles.muted}>{t("nativeDsh.discovery.hint")}</Text>
      {pairing === "browser" && (
        <Text style={styles.muted}>{t("nativeDsh.discovery.browser")}</Text>
      )}
      {state.status !== "ready" && (
        <Text style={styles.muted}>{t(`nativeDsh.discovery.status.${state.status}`)}</Text>
      )}
      {state.status === "ready" && candidates.length === 0 && (
        <Text style={styles.muted}>{t("nativeDsh.discovery.empty")}</Text>
      )}
      {state.status === "ready" && state.truncated && (
        <Text style={styles.muted}>{t("nativeDsh.discovery.partial")}</Text>
      )}
      {candidates.map((candidate) => (
        <Candidate
          key={candidate.identity.hostId}
          model={model}
          candidate={candidate}
          saved={saved.find((host) => host.hostId === candidate.identity.hostId)}
          busy={directory.busy || directory.directory.status !== "ready"}
          pairing={pairing}
        />
      ))}
      <Button
        variant="ghost"
        disabled={state.status === "loading" || state.status === "offline"}
        onPress={discovery.refresh}
        testID="dsh-refresh-discovery"
      >
        {t("nativeDsh.discovery.refresh")}
      </Button>
    </View>
  );
}
