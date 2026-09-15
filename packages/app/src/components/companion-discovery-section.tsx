import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type {
  CompanionHost,
  CompanionDiscoveryResult,
} from "@getpaseo/protocol/companion-discovery";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { CompanionConnectForm } from "./companion-connect-form";
import { Button } from "./ui/button";

export function CompanionDiscoverySection({
  onConnected,
}: {
  onConnected: (profile: HostProfile) => void;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const store = getHostRuntimeStore();
  const [selected, setSelected] = useState<CompanionHost | null>(null);
  // Discovery also runs outside a session route, where SessionContext is not mounted.
  // A serialized snapshot stays referentially stable until the eligible hosts change.
  const sourceSnapshot = useSyncExternalStore(
    (onChange) => store.subscribeAll(onChange),
    () =>
      JSON.stringify(
        store
          .getHosts()
          .filter((host) => {
            const runtime = store.getSnapshot(host.serverId);
            const info = runtime?.client?.getLastServerInfoMessage();
            return (
              runtime?.connectionStatus === "online" &&
              info?.features?.companionDiscovery === true &&
              info.permissions?.includes("tunnel.manage") !== false
            );
          })
          .map((host) => host.serverId)
          .slice(0, 4),
      ),
    () => "[]",
  );
  const sourceIds = useMemo(() => JSON.parse(sourceSnapshot) as string[], [sourceSnapshot]);
  const query = useFetchQuery({
    queryKey: ["companion-discovery", ...sourceIds],
    dataShape: "value",
    staleTimeMs: 15_000,
    enabled: sourceIds.length > 0,
    retry: false,
    queryFn: async (): Promise<CompanionDiscoveryResult> => {
      const results = await Promise.allSettled(
        sourceIds.map(async (id) => {
          const client = store.getClient(id);
          if (!client) throw new Error("Host disconnected");
          return client.discoverCompanions();
        }),
      );
      const found = new Map<string, CompanionHost>();
      const scans = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      for (const scan of scans)
        for (const host of scan.hosts)
          if (!found.has(host.serverId)) found.set(host.serverId, host);
      const successful = scans.some((scan) => scan.status === "ready");
      return {
        status: successful ? "ready" : (scans[0]?.status ?? "scan-failed"),
        hosts: [...found.values()].sort((a, b) => a.hostname.localeCompare(b.hostname)),
        truncated:
          scans.length !== results.length ||
          scans.some((scan) => scan.truncated || (successful && scan.status !== "ready")),
      };
    },
  });
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const deselect = useCallback(() => {
    setSelected(null);
  }, []);
  if (selected)
    return (
      <CompanionConnectForm
        key={selected.serverId}
        host={selected}
        onConnected={onConnected}
        onCancel={deselect}
      />
    );
  const state = query.data?.status;
  return (
    <SettingsSection title={t("pairing.discovery.title")} testID="companion-discovery" flush>
      {sourceIds.length === 0 ? (
        <Text style={styles.helper}>
          {t(hosts.length === 0 ? "pairing.discovery.pairFirst" : "pairing.discovery.connectHost")}
        </Text>
      ) : (
        <>
          {query.isFetching ? (
            <Text style={styles.helper}>{t("pairing.discovery.searching")}</Text>
          ) : null}
          {query.isError || state === "scan-failed" ? (
            <Text style={styles.helper}>{t("pairing.discovery.scanFailed")}</Text>
          ) : null}
          {state === "tailscale-unavailable" || state === "tailscale-disconnected" ? (
            <Text style={styles.helper}>{t("pairing.discovery.enableTailscale")}</Text>
          ) : null}
          {state === "ready" && query.data?.hosts.length === 0 ? (
            <Text style={styles.helper}>{t("pairing.discovery.empty")}</Text>
          ) : null}
          {query.data?.hosts.map((host) => (
            <DiscoveredHost
              key={host.serverId}
              host={host}
              paired={serverIds.includes(host.serverId)}
              onSelect={setSelected}
            />
          ))}
          {query.data?.truncated ? (
            <Text style={styles.helper}>{t("pairing.discovery.partial")}</Text>
          ) : null}
          <Button
            onPress={refresh}
            variant="ghost"
            disabled={query.isFetching}
            testID="companion-discovery-refresh"
          >
            {t("pairing.discovery.refresh")}
          </Button>
        </>
      )}
    </SettingsSection>
  );
}

function DiscoveredHost({
  host,
  paired,
  onSelect,
}: {
  host: CompanionHost;
  paired: boolean;
  onSelect: (host: CompanionHost) => void;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => {
    onSelect(host);
  }, [host, onSelect]);
  return (
    <Button
      variant="secondary"
      onPress={select}
      disabled={paired}
      testID={`companion-host-${host.serverId}`}
    >
      {paired ? t("pairing.discovery.paired", { name: host.hostname }) : host.hostname}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  helper: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
}));
