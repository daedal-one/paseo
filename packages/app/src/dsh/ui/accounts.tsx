import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Linking, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { DshHostRuntime } from "../runtime";
import { createDshAbortController } from "@/runtime/dsh-abort-controller";
import { featureAvailable, remoteValue } from "../features";
import { styles } from "./styles";
type Account = Extract<
  Awaited<ReturnType<DshHostRuntime["remote"]["authorization"]["list"]>>,
  { ok: true }
>["value"][number];
type Update = DshHostRuntime["remote"]["authorization"]["signIn"] extends (
  ...args: never[]
) => AsyncIterable<infer T>
  ? T
  : never;
export function AccountControls({
  runtime,
  account,
}: {
  runtime: DshHostRuntime;
  account: Account;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const generation = useSyncExternalStore(
    runtime.connection.generation.subscribe,
    runtime.connection.generation.getSnapshot,
  );
  const [update, setUpdate] = useState<Update | null>(null);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const owner = useRef<AbortController | null>(null);
  const available = featureAvailable(runtime, [
    "authorization/signIn",
    "authorization/answer",
    "authorization/signOut",
  ]);
  useEffect(() => {
    setRunning(false);
    setUpdate(null);
    return () => {
      owner.current?.abort();
      owner.current = null;
    };
  }, [generation]);
  const signIn = useCallback(
    (method: string) => {
      if (owner.current !== null || !featureAvailable(runtime, ["authorization/signIn"])) return;
      const controller = createDshAbortController();
      owner.current = controller;
      setRunning(true);
      setFailed(false);
      setUpdate(null);
      void (async () => {
        try {
          for await (const frame of runtime.remote.authorization.signIn(
            account.key,
            method,
            controller.signal,
          )) {
            if (!controller.signal.aborted) setUpdate(frame);
          }
        } catch {
          if (!controller.signal.aborted) setFailed(true);
        } finally {
          if (owner.current === controller) {
            owner.current = null;
            setRunning(false);
            void client.invalidateQueries({ queryKey: ["dsh-accounts", runtime.hostId] });
          }
        }
      })();
    },
    [runtime, account.key, client],
  );
  const cancel = useCallback(() => {
    owner.current?.abort();
    setRunning(false);
  }, []);
  const signOut = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!featureAvailable(runtime, ["authorization/signOut"])) throw new Error("offline");
      return remoteValue(await runtime.remote.authorization.signOut(account.key));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["dsh-accounts", runtime.hostId] }),
  });
  const out = useCallback(() => signOut.mutate(), [signOut]);
  const openUrl = useCallback(() => {
    if (update?.url !== undefined) void Linking.openURL(update.url).catch(() => setFailed(true));
  }, [update]);
  return (
    <View style={styles.group}>
      <Text style={styles.title}>{account.label}</Text>
      <Text style={styles.muted}>
        {t(account.configured ? "nativeDsh.accounts.configured" : "nativeDsh.accounts.missing")}
      </Text>
      {account.methods.map((method) => (
        <Method
          key={method.id}
          id={method.id}
          label={method.label}
          choose={signIn}
          disabled={!available || running || account.inFlight || signOut.isPending}
        />
      ))}
      {account.configured && (
        <Button
          variant="outline"
          disabled={!available || running || signOut.isPending}
          onPress={out}
        >
          {t("nativeDsh.accounts.signOut")}
        </Button>
      )}
      {running && (
        <Button variant="ghost" onPress={cancel}>
          {t("common.actions.cancel")}
        </Button>
      )}
      {update?.message !== undefined && (
        <Text selectable style={styles.text}>
          {update.message}
        </Text>
      )}
      {update?.code !== undefined && (
        <Text selectable style={styles.text}>
          {update.code}
        </Text>
      )}
      {update?.url !== undefined && (
        <Button variant="outline" onPress={openUrl}>
          {t("nativeDsh.accounts.open")}
        </Button>
      )}
      {update?.status === "pending" && update.prompt !== undefined && running && (
        <AccountAnswer key={update.prompt.id} runtime={runtime} update={update} />
      )}
      {(failed || signOut.isError || update?.status === "failed") && (
        <Text style={styles.error}>{t("nativeDsh.features.failed")}</Text>
      )}
    </View>
  );
}
function Method({
  id,
  label,
  choose,
  disabled,
}: {
  id: string;
  label: string;
  choose(method: string): void;
  disabled: boolean;
}) {
  const select = useCallback(() => choose(id), [choose, id]);
  return (
    <Button variant="outline" disabled={disabled} onPress={select}>
      {label}
    </Button>
  );
}
function AccountAnswer({ runtime, update }: { runtime: DshHostRuntime; update: Update }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const editor = useRef<EditingTextInputHandle>(null);
  const choose = useCallback((next: string) => {
    setValue(next);
    editor.current?.replaceText(next);
  }, []);
  const mutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (update.prompt === undefined || !featureAvailable(runtime, ["authorization/answer"]))
        throw new Error("unavailable");
      return remoteValue(
        await runtime.remote.authorization.answer(update.id, update.prompt.id, value),
      );
    },
    onSuccess: () => {
      setValue("");
      editor.current?.replaceText("");
    },
  });
  const submit = useCallback(() => mutation.mutate(), [mutation]);
  if (update.prompt === undefined) return null;
  return (
    <View style={styles.group}>
      <Field label={update.prompt.message}>
        <FormTextInput
          ref={editor}
          initialValue=""
          secureTextEntry={update.prompt.kind === "secret"}
          autoCorrect={false}
          onChangeText={setValue}
        />
      </Field>
      {update.prompt.options?.map((option) => (
        <Method
          key={option.id}
          id={option.id}
          label={option.label}
          choose={choose}
          disabled={mutation.isPending || mutation.isSuccess}
        />
      ))}
      <Button disabled={value === "" || mutation.isPending || mutation.isSuccess} onPress={submit}>
        {t("nativeDsh.accounts.answer")}
      </Button>
      {mutation.isError && <Text style={styles.error}>{t("nativeDsh.features.failed")}</Text>}
    </View>
  );
}
