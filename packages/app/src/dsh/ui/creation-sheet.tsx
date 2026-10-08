import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { DshCreationForm, type DshCreationFormState } from "../creation-form";
import type { DshHostRuntime } from "../runtime";
import type { SessionId } from "@deepseek-ai/dsh-client";
import { styles } from "./styles";

interface Props {
  runtime: DshHostRuntime;
  onClose(): void;
  onOpenSession(id: SessionId): void;
}

export function CreationSheet({ runtime, onClose, onOpenSession }: Props) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const size = compact ? "md" : "sm";
  const [form] = useState(() => new DshCreationForm(runtime.creation, runtime.workspaces));
  useEffect(() => form.connect(), [form]);
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  const { creation } = state;
  const outcome = creation.outcome;
  const open = useCallback(() => {
    if (state.openSession !== null) onOpenSession(state.openSession);
  }, [onOpenSession, state.openSession]);
  const canReset =
    creation.storage === "ready" && (outcome.kind === "accepted" || outcome.kind === "rejected");
  const footer = useMemo(
    () => (
      <View style={styles.creationActions} testID="dsh-create-actions">
        {outcome.kind === "idle" && (
          <Button
            size={size}
            testID="dsh-create-submit"
            disabled={!state.canSubmit}
            loading={state.working}
            onPress={form.submit}
          >
            {t("nativeDsh.creation.submit")}
          </Button>
        )}
        {state.openSession !== null && (
          <Button size={size} testID="dsh-create-open" onPress={open}>
            {t("nativeDsh.conversation.open")}
          </Button>
        )}
        {canReset && (
          <Button
            size={size}
            variant="outline"
            testID="dsh-create-reset"
            disabled={state.working}
            onPress={form.reset}
          >
            {t("nativeDsh.creation.reset")}
          </Button>
        )}
        <Button size={size} variant="outline" onPress={onClose}>
          {t("nativeDsh.creation.close")}
        </Button>
      </View>
    ),
    [
      outcome.kind,
      size,
      state.canSubmit,
      state.working,
      state.openSession,
      canReset,
      form,
      open,
      onClose,
      t,
    ],
  );
  const header = useMemo(() => ({ title: t("nativeDsh.creation.title") }), [t]);
  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={onClose}
      footer={footer}
      testID="dsh-create-sheet"
    >
      <View style={styles.group}>
        {creation.availability !== "available" && (
          <Text style={styles.muted}>{t(`nativeDsh.creation.${creation.availability}`)}</Text>
        )}
        {creation.storage !== "ready" && (
          <Text accessibilityRole="alert" style={styles.error}>
            {t(`nativeDsh.creation.storage.${creation.storage}`)}
          </Text>
        )}
        {outcome.kind === "idle" ? (
          <CreationFields form={form} state={state} />
        ) : (
          <View style={styles.group} testID={`dsh-create-outcome-${outcome.kind}`}>
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {outcome.kind === "unknown" && outcome.published
                ? t("nativeDsh.creation.published")
                : t(`nativeDsh.creation.outcome.${outcome.kind}`)}
            </Text>
            <Text selectable style={styles.muted}>
              {t("nativeDsh.creation.identity", { id: outcome.request.sessionId })}
            </Text>
            <Text selectable style={styles.text}>
              {outcome.request.cwd ?? outcome.request.workspaceId}
            </Text>
            <Text style={styles.text}>
              {outcome.request.agentPreset ?? t("nativeDsh.profile.hostDefault")}
            </Text>
            {outcome.kind === "rejected" && (
              <Text selectable style={styles.muted}>
                {outcome.code}
              </Text>
            )}
          </View>
        )}
        {(creation.storage === "failed" ||
          outcome.kind === "unknown" ||
          outcome.kind === "attachment-failed") && (
          <Button
            size={size}
            variant="outline"
            testID="dsh-create-check"
            disabled={state.working}
            loading={state.working}
            onPress={form.checkStatus}
          >
            {t("nativeDsh.creation.check")}
          </Button>
        )}
      </View>
    </AdaptiveModalSheet>
  );
}

function CreationFields({ form, state }: { form: DshCreationForm; state: DshCreationFormState }) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const { creation } = state;
  let profileError: string | null = null;
  if (creation.roster === "failed") profileError = t("nativeDsh.creation.catalogFailed");
  if (state.profileMissing) profileError = t("nativeDsh.creation.profileMissing");
  const profileOptions = creation.profiles.map((profile) => ({
    id: profile.id,
    value: profile.id,
    label: profile.isDefault
      ? t("nativeDsh.creation.defaultProfile", { name: profile.name ?? profile.id })
      : (profile.name ?? profile.id),
    description: profile.description,
    testID: `dsh-create-profile-${profile.id}`,
  }));
  return (
    <>
      <CreationTarget form={form} state={state} />
      {creation.catalog === "unavailable" ? (
        <Text style={styles.error}>{t("nativeDsh.creation.catalogUnavailable")}</Text>
      ) : (
        <SelectField
          label={t("nativeDsh.creation.profile")}
          value={state.profile?.value ?? null}
          selectedDisplay={state.profile?.display ?? null}
          options={profileOptions}
          onChange={form.chooseProfile}
          placeholder={t("nativeDsh.creation.chooseProfile")}
          emptyText={t("nativeDsh.creation.emptyProfiles")}
          disabled={!state.editable || creation.roster !== "ready"}
          loading={creation.roster === "loading"}
          error={profileError}
          size={size}
          triggerTestID="dsh-create-profile"
        />
      )}
      <Button
        size={size}
        variant="outline"
        testID="dsh-create-profiles-refresh"
        disabled={
          !state.editable || creation.catalog !== "available" || creation.roster === "loading"
        }
        onPress={form.refreshProfiles}
      >
        {t("nativeDsh.creation.refreshProfiles")}
      </Button>
      {creation.selectionError !== null && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(`nativeDsh.creation.selection.${creation.selectionError}`)}
        </Text>
      )}
    </>
  );
}

export function CreationControl({
  runtime,
  onOpenSession,
  busy,
}: Omit<Props, "onClose"> & { busy: boolean }) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState<DshHostRuntime | null>(null);
  const creation = useSyncExternalStore(runtime.creation.subscribe, runtime.creation.getSnapshot);
  const show = useCallback(() => {
    setOpened(runtime);
    if (runtime.creation.getSnapshot().outcome.kind === "idle")
      void runtime.creation.refreshProfiles();
  }, [runtime]);
  const close = useCallback(() => setOpened(null), []);
  const open = useCallback(
    (id: SessionId) => {
      setOpened(null);
      onOpenSession(id);
    },
    [onOpenSession],
  );
  return (
    <>
      <Button size="sm" testID="dsh-create-session" disabled={busy} onPress={show}>
        {creation.outcome.kind === "idle"
          ? t("nativeDsh.creation.title")
          : t("nativeDsh.creation.review")}
      </Button>
      {opened === runtime && (
        <CreationSheet runtime={runtime} onClose={close} onOpenSession={open} />
      )}
    </>
  );
}

function CreationTarget({ form, state }: { form: DshCreationForm; state: DshCreationFormState }) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const { workspaces } = state;
  const targetDisplay = useMemo(
    () => ({ label: t(`nativeDsh.creation.${state.target}`) }),
    [t, state.target],
  );
  let workspaceError: string | null = null;
  if (workspaces.error !== null) workspaceError = t("nativeDsh.creation.workspaceFailed");
  if (state.workspaceMissing) workspaceError = t("nativeDsh.creation.workspaceMissing");
  const workspaceOptions = workspaces.items.map((workspace) => ({
    id: workspace.workspaceId,
    value: workspace.workspaceId,
    label: workspace.title,
    description: workspace.path,
    testID: `dsh-create-workspace-${workspace.workspaceId}`,
  }));
  const targetOptions = (["directory", "workspace"] as const).map((value) => ({
    id: value,
    value,
    label: t(`nativeDsh.creation.${value}`),
    testID: `dsh-create-target-${value}`,
  }));
  return (
    <>
      <SelectField
        label={t("nativeDsh.creation.target")}
        value={state.target}
        selectedDisplay={targetDisplay}
        options={targetOptions}
        onChange={form.chooseTarget}
        placeholder={t("nativeDsh.creation.target")}
        emptyText={t("nativeDsh.creation.empty")}
        disabled={!state.editable}
        size={size}
        triggerTestID="dsh-create-target"
      />
      {state.target === "directory" ? (
        <Field label={t("nativeDsh.creation.directory")}>
          <FormTextInput
            initialValue={state.cwd}
            onChangeText={form.setDirectory}
            editable={state.editable}
            size={size}
            testID="dsh-create-directory"
            accessibilityLabel={t("nativeDsh.creation.directory")}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
      ) : (
        <SelectField
          label={t("nativeDsh.creation.workspace")}
          value={state.workspace?.value ?? null}
          selectedDisplay={state.workspace?.display ?? null}
          options={workspaceOptions}
          onChange={form.chooseWorkspace}
          placeholder={t("nativeDsh.creation.chooseWorkspace")}
          emptyText={t("nativeDsh.creation.emptyWorkspaces")}
          disabled={!state.editable || workspaces.phase !== "ready" || workspaces.error !== null}
          loading={workspaces.phase !== "ready"}
          error={workspaceError}
          size={size}
          searchable
          triggerTestID="dsh-create-workspace"
        />
      )}
    </>
  );
}
