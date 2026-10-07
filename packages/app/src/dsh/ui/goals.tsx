import { useFetchQuery } from "@/data/query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { DshConversation, DshHostRuntime } from "../runtime";
import { featureAvailable, remoteValue } from "../features";
import { styles } from "./styles";

export function Goals({ runtime, view }: { runtime: DshHostRuntime; view: DshConversation }) {
  const { t } = useTranslation();
  const [objective, setObjective] = useState("");
  const generation = useSyncExternalStore(
    runtime.connection.generation.subscribe,
    runtime.connection.generation.getSnapshot,
  );
  const available = featureAvailable(runtime, [
    "goals/get",
    "goals/create",
    "goals/pause",
    "goals/resume",
    "goals/complete",
    "goals/clear",
    "goals/edit",
  ]);
  const client = useQueryClient();
  const queryKey = ["dsh-goal", runtime.hostId, view.sessionId, generation];
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey,
    queryFn: async () => remoteValue(await runtime.remote.goals.get(view.sessionId)) ?? null,
    enabled: available,
    gcTime: 0,
    retry: false,
  });
  useEffect(
    () =>
      runtime.remote.$on("goal/activation-changed", (event) => {
        if (event.sessionId === view.sessionId)
          void client.invalidateQueries({ queryKey: ["dsh-goal", runtime.hostId, view.sessionId] });
      }),
    [runtime, view.sessionId, client],
  );
  const projection = view.session.projections.faceOf("goal");
  useEffect(
    () =>
      projection.subscribe(() => {
        void client.invalidateQueries({ queryKey: ["dsh-goal", runtime.hostId, view.sessionId] });
      }),
    [projection, client, runtime, view.sessionId],
  );
  const mutation = useMutation({
    mutationFn: async (action: "create" | "edit" | "pause" | "resume" | "complete" | "clear") => {
      if (!featureAvailable(runtime, ["goals/get"])) throw new Error("offline");
      if (action === "create")
        return remoteValue(await runtime.remote.goals.create(view.sessionId, { objective }));
      const goal = query.data;
      if (goal === undefined || goal === null) throw new Error("no-current-goal");
      const ref = { id: goal.id, revision: goal.revision };
      if (action === "edit")
        return remoteValue(await runtime.remote.goals.edit(view.sessionId, ref, { objective }));
      return remoteValue(await runtime.remote.goals[action](view.sessionId, ref));
    },
    retry: false,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["dsh-goal", runtime.hostId, view.sessionId] }),
  });
  const create = useCallback(
    () => mutation.mutate(query.data == null ? "create" : "edit"),
    [mutation, query.data],
  );
  const pause = useCallback(() => mutation.mutate("pause"), [mutation]);
  const resume = useCallback(() => mutation.mutate("resume"), [mutation]);
  const complete = useCallback(() => mutation.mutate("complete"), [mutation]);
  const clear = useCallback(() => mutation.mutate("clear"), [mutation]);
  const disabled = !available || mutation.isPending || query.isFetching;
  return (
    <View style={styles.group} testID="dsh-goals">
      <Text style={styles.title}>{t("nativeDsh.features.goal")}</Text>
      {!available && <Text style={styles.muted}>{t("nativeDsh.features.unavailable")}</Text>}
      {query.data != null && (
        <>
          <Text selectable style={styles.text}>
            {query.data.objective}
          </Text>
          <Text style={styles.muted}>
            {t(`nativeDsh.goal.phase.${query.data.phase}`)} · {query.data.roundsStarted}/
            {query.data.maxGoalRounds}
          </Text>
          <Text style={styles.muted}>
            {t(`nativeDsh.goal.activation.${query.data.activation}`)}
          </Text>
        </>
      )}
      <Field label={t("nativeDsh.goal.objective")}>
        <FormTextInput
          initialValue=""
          onChangeText={setObjective}
          multiline
          testID="dsh-goal-objective"
        />
      </Field>
      <Button disabled={disabled || objective.trim() === ""} onPress={create}>
        {t("nativeDsh.features.save")}
      </Button>
      {query.data != null && (
        <View style={styles.actions}>
          <Button disabled={disabled} onPress={pause}>
            {t("nativeDsh.goal.pause")}
          </Button>
          <Button disabled={disabled} onPress={resume}>
            {t("nativeDsh.goal.resume")}
          </Button>
          <Button disabled={disabled} onPress={complete}>
            {t("nativeDsh.goal.complete")}
          </Button>
          <Button disabled={disabled} variant="outline" onPress={clear}>
            {t("nativeDsh.goal.clear")}
          </Button>
        </View>
      )}
      {(query.isError || mutation.isError) && (
        <Text style={styles.error} accessibilityRole="alert">
          {t("nativeDsh.features.failed")}
        </Text>
      )}
    </View>
  );
}
