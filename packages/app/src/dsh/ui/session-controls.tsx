import { useFetchQuery } from "@/data/query";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { DshConversation, DshHostRuntime } from "../runtime";
import { featureAvailable, remoteValue } from "../features";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { DshDirectory } from "../directory";
import { BackgroundWork } from "./background-work";
import { WorkspaceFiles } from "./workspace-files";
import { Goals } from "./goals";
import { styles } from "./styles";

function Commands({ runtime, view }: { runtime: DshHostRuntime; view: DshConversation }) {
  const { t } = useTranslation();
  const [line, setLine] = useState("");
  const editor = useRef<EditingTextInputHandle>(null);
  const choose = useCallback((value: string) => {
    setLine(value);
    editor.current?.replaceText(value);
  }, []);
  const generation = useSyncExternalStore(
    runtime.connection.generation.subscribe,
    runtime.connection.generation.getSnapshot,
  );
  const available = featureAvailable(runtime, ["commands/list", "commands/execute"]);
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["dsh-commands", runtime.hostId, view.sessionId, generation],
    queryFn: async () => remoteValue(await runtime.remote.commands.list(view.sessionId)),
    enabled: available,
    gcTime: 0,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!featureAvailable(runtime, ["commands/execute"])) throw new Error("offline");
      return remoteValue(await runtime.remote.commands.execute(view.sessionId, line, [])) ?? null;
    },
    retry: false,
  });
  const run = useCallback(() => mutation.mutate(), [mutation]);
  return (
    <View style={styles.group}>
      <Text style={styles.title}>{t("nativeDsh.features.commands")}</Text>
      {!available && <Text style={styles.muted}>{t("nativeDsh.features.unavailable")}</Text>}
      {query.data?.map((command) => (
        <CommandOption
          key={command.name}
          name={command.name}
          description={command.description}
          choose={choose}
        />
      ))}
      <Field label={t("nativeDsh.features.input")}>
        <FormTextInput
          ref={editor}
          initialValue=""
          onChangeText={setLine}
          testID="dsh-command-line"
        />
      </Field>
      <Button
        disabled={!available || mutation.isPending || !line.startsWith("/")}
        onPress={run}
        testID="dsh-command-run"
      >
        {t("nativeDsh.features.submit")}
      </Button>
      {(query.isError || mutation.isError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeDsh.features.failed")}
        </Text>
      )}
      {mutation.data !== undefined && mutation.data !== null && (
        <Text style={styles.text}>
          {mutation.data.result.text ?? t("nativeDsh.features.refreshed")}
        </Text>
      )}
    </View>
  );
}
function CommandOption({
  name,
  description,
  choose,
}: {
  name: string;
  description: string;
  choose(line: string): void;
}) {
  const select = useCallback(() => choose(`/${name} `), [choose, name]);
  return (
    <View style={styles.group}>
      <Button variant="outline" size="sm" onPress={select}>{`/${name}`}</Button>
      <Text style={styles.muted}>{description}</Text>
    </View>
  );
}
function Rename({ runtime, view }: { runtime: DshHostRuntime; view: DshConversation }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      if (!featureAvailable(runtime, ["session/rename"])) throw new Error("offline");
      return remoteValue(await view.session.rename(title));
    },
    retry: false,
  });
  const rename = useCallback(() => mutation.mutate(), [mutation]);
  return (
    <View style={styles.group}>
      <Field label={t("nativeDsh.features.rename")}>
        <FormTextInput initialValue="" onChangeText={setTitle} />
      </Field>
      <Button
        disabled={
          !featureAvailable(runtime, ["session/rename"]) ||
          title.trim() === "" ||
          mutation.isPending
        }
        onPress={rename}
      >
        {t("nativeDsh.features.save")}
      </Button>
      {mutation.isError && <Text style={styles.error}>{t("nativeDsh.features.failed")}</Text>}
    </View>
  );
}
function Models({ runtime, view }: { runtime: DshHostRuntime; view: DshConversation }) {
  const { t } = useTranslation();
  const generation = useSyncExternalStore(
    runtime.connection.generation.subscribe,
    runtime.connection.generation.getSnapshot,
  );
  const available = featureAvailable(runtime, ["session/modelCatalog", "session/selectModel"]);
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["dsh-models", runtime.hostId, generation],
    queryFn: async () => remoteValue(await runtime.remote.session.modelCatalog()),
    enabled: available,
    gcTime: 0,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async (selection: {
      provider: string;
      model: string;
      reasoningEffort?: string;
    }) => {
      if (!featureAvailable(runtime, ["session/selectModel"])) throw new Error("offline");
      return remoteValue(
        await runtime.remote.session.selectModel({ sessionId: view.sessionId, ...selection }),
      );
    },
    gcTime: 0,
    retry: false,
  });
  return (
    <View style={styles.group}>
      <Text style={styles.title}>{t("nativeDsh.features.models")}</Text>
      {!available && <Text style={styles.muted}>{t("nativeDsh.features.unavailable")}</Text>}
      {query.data?.groups.map((group) => (
        <View key={group.id} style={styles.group}>
          <Text style={styles.text}>{group.name}</Text>
          {group.models.map((model) => (
            <ModelOption
              key={model.id}
              provider={group.id}
              model={model}
              disabled={!available || mutation.isPending}
              select={mutation.mutate}
            />
          ))}
        </View>
      ))}
      {(query.isError || mutation.isError) && (
        <Text style={styles.error}>{t("nativeDsh.features.failed")}</Text>
      )}
      {mutation.isSuccess && <Text style={styles.muted}>{t("nativeDsh.features.refreshed")}</Text>}
    </View>
  );
}
type CatalogModel = Extract<
  Awaited<ReturnType<DshHostRuntime["remote"]["session"]["modelCatalog"]>>,
  { ok: true }
>["value"]["groups"][number]["models"][number];
function ModelOption({
  provider,
  model,
  disabled,
  select,
}: {
  provider: string;
  model: CatalogModel;
  disabled: boolean;
  select(value: { provider: string; model: string; reasoningEffort?: string }): void;
}) {
  const choose = useCallback(
    () => select({ provider, model: model.id }),
    [select, provider, model.id],
  );
  return (
    <View style={styles.group}>
      <Button size="sm" variant="outline" disabled={disabled} onPress={choose}>
        {model.name}
      </Button>
      {model.reasoning?.efforts.map((effort) => (
        <EffortOption
          key={effort.id}
          provider={provider}
          model={model.id}
          effort={effort.id}
          name={effort.name}
          disabled={disabled}
          select={select}
        />
      ))}
    </View>
  );
}
function EffortOption({
  provider,
  model,
  effort,
  name,
  disabled,
  select,
}: {
  provider: string;
  model: string;
  effort: string;
  name: string;
  disabled: boolean;
  select(value: { provider: string; model: string; reasoningEffort: string }): void;
}) {
  const choose = useCallback(
    () => select({ provider, model, reasoningEffort: effort }),
    [select, provider, model, effort],
  );
  return (
    <Button size="sm" variant="ghost" disabled={disabled} onPress={choose}>
      {name}
    </Button>
  );
}
function ControlsSheet({
  runtime,
  view,
  model,
  onClose,
}: {
  model: DshDirectory;
  runtime: DshHostRuntime;
  view: DshConversation;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const header = useMemo(() => ({ title: t("nativeDsh.features.title") }), [t]);
  return (
    <AdaptiveModalSheet visible header={header} onClose={onClose} testID="dsh-session-controls">
      <View style={styles.group}>
        <Rename runtime={runtime} view={view} />
        <Models runtime={runtime} view={view} />
        <Goals runtime={runtime} view={view} />
        <Commands runtime={runtime} view={view} />
        <WorkspaceFiles runtime={runtime} view={view} />
        <BackgroundWork runtime={runtime} view={view} model={model} />
      </View>
    </AdaptiveModalSheet>
  );
}
export function SessionControls({
  runtime,
  view,
  model,
}: {
  model: DshDirectory;
  runtime: DshHostRuntime;
  view: DshConversation;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button size="sm" variant="ghost" onPress={show} testID="dsh-controls-open">
        {t("nativeDsh.features.title")}
      </Button>
      {open && <ControlsSheet runtime={runtime} view={view} model={model} onClose={close} />}
    </>
  );
}
