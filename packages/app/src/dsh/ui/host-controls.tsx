import { useFetchQuery } from "@/data/query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { DshHostRuntime } from "../runtime";
import { featureAvailable, remoteValue } from "../features";
import { AccountControls } from "./accounts";
import { styles } from "./styles";
const patchSchema = z.record(z.string(), z.json());
type Namespace = Extract<
  Awaited<ReturnType<DshHostRuntime["remote"]["settings"]["describe"]>>,
  { ok: true }
>["value"]["namespaces"][number];
function NamespaceEditor({
  runtime,
  namespace,
  writable,
}: {
  runtime: DshHostRuntime;
  namespace: Namespace;
  writable: boolean;
}) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState("{}");
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      if (!featureAvailable(runtime, ["settings/update"])) throw new Error("offline");
      const patch = patchSchema.parse(JSON.parse(raw));
      return remoteValue(
        await runtime.remote.settings.update(namespace.ns, patch, namespace.revision),
      );
    },
    retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: ["dsh-settings", runtime.hostId] }),
  });
  const save = useCallback(() => mutation.mutate(), [mutation]);
  return (
    <View style={styles.group}>
      <Text style={styles.title}>{namespace.ns}</Text>
      <Text selectable style={styles.text}>
        {JSON.stringify(namespace.value, null, 2)}
      </Text>
      <Field label={t("nativeDsh.features.patch")}>
        <FormTextInput
          initialValue="{}"
          onChangeText={setRaw}
          multiline
          numberOfLines={6}
          autoCorrect={false}
        />
      </Field>
      <Button disabled={!writable || mutation.isPending} onPress={save}>
        {t("nativeDsh.features.save")}
      </Button>
      {mutation.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.features.failed")}
        </Text>
      )}
      {mutation.isSuccess && <Text style={styles.muted}>{t("nativeDsh.features.refreshed")}</Text>}
    </View>
  );
}
function HostSettings({ runtime }: { runtime: DshHostRuntime }) {
  const { t } = useTranslation();
  const generation = useSyncExternalStore(
    runtime.connection.generation.subscribe,
    runtime.connection.generation.getSnapshot,
  );
  const settings = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["dsh-settings", runtime.hostId, generation],
    queryFn: async () => remoteValue(await runtime.remote.settings.describe()),
    enabled: featureAvailable(runtime, ["settings/describe"]),
    gcTime: 0,
    retry: false,
  });
  const plugins = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["dsh-plugins", runtime.hostId, generation],
    queryFn: async () => remoteValue(await runtime.remote.pluginInventory.list()),
    enabled: featureAvailable(runtime, ["pluginInventory/list"]),
    gcTime: 0,
    retry: false,
  });
  const accounts = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["dsh-accounts", runtime.hostId, generation],
    queryFn: async () => remoteValue(await runtime.remote.authorization.list()),
    enabled: featureAvailable(runtime, ["authorization/list"]),
    gcTime: 0,
    retry: false,
  });
  return (
    <View style={styles.group}>
      <Text style={styles.title}>{t("nativeDsh.features.settings")}</Text>
      {!featureAvailable(runtime, ["settings/describe"]) && (
        <Text style={styles.muted}>{t("nativeDsh.features.unavailable")}</Text>
      )}
      {settings.data?.namespaces.map((namespace) => (
        <NamespaceEditor
          key={namespace.ns}
          runtime={runtime}
          namespace={namespace}
          writable={
            settings.data?.writable === true && featureAvailable(runtime, ["settings/update"])
          }
        />
      ))}
      <Text style={styles.title}>{t("nativeDsh.features.plugins")}</Text>
      {plugins.data?.entries.map((entry) => (
        <Text key={entry.entryId} style={styles.text}>
          {entry.moduleName}
        </Text>
      ))}
      {accounts.data?.map((account) => (
        <AccountControls key={account.key} runtime={runtime} account={account} />
      ))}
      {(settings.isError || plugins.isError || accounts.isError) && (
        <Text style={styles.error} accessibilityRole="alert">
          {t("nativeDsh.features.failed")}
        </Text>
      )}
    </View>
  );
}
export function HostControls({ runtime }: { runtime: DshHostRuntime }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const header = useMemo(() => ({ title: t("nativeDsh.features.host") }), [t]);
  return (
    <>
      <Button variant="ghost" onPress={show} testID="dsh-host-controls-open">
        {t("nativeDsh.features.host")}
      </Button>
      {open && (
        <AdaptiveModalSheet visible header={header} onClose={close} testID="dsh-host-controls">
          <HostSettings runtime={runtime} />
        </AdaptiveModalSheet>
      )}
    </>
  );
}
