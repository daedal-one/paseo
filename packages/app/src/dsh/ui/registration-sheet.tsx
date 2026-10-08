import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { DshHostRuntime } from "../runtime";
import { useRegistrationForm } from "../use-registration-form";
import { styles } from "./styles";

function RegistrationSheet({ runtime, onClose }: { runtime: DshHostRuntime; onClose(): void }) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const { form, state } = useRegistrationForm(runtime);
  const { registration } = state;
  const { outcome, lookup } = registration;
  const header = useMemo(() => ({ title: t("nativeDsh.registration.title") }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.creationActions} testID="dsh-register-actions">
        {outcome.kind === "idle" && (
          <Button
            size={size}
            testID="dsh-register-submit"
            disabled={!state.canSubmit}
            loading={state.working}
            onPress={form.submit}
          >
            {t("nativeDsh.registration.submit")}
          </Button>
        )}
        {state.canReset && (
          <Button size={size} variant="outline" testID="dsh-register-reset" onPress={form.reset}>
            {t("nativeDsh.registration.reset")}
          </Button>
        )}
        <Button size={size} variant="outline" testID="dsh-register-close" onPress={onClose}>
          {t("nativeDsh.creation.close")}
        </Button>
      </View>
    ),
    [outcome.kind, size, state.canSubmit, state.canReset, state.working, form, onClose, t],
  );
  return (
    <AdaptiveModalSheet
      visible
      header={header}
      footer={footer}
      onClose={onClose}
      testID="dsh-register-sheet"
    >
      <View style={styles.group}>
        <Text style={styles.muted}>{t("nativeDsh.registration.explanation")}</Text>
        {registration.availability !== "available" && (
          <Text style={styles.muted}>
            {t(`nativeDsh.registration.${registration.availability}`)}
          </Text>
        )}
        {registration.storage !== "ready" && (
          <Text accessibilityRole="alert" style={styles.error}>
            {t(`nativeDsh.registration.storage.${registration.storage}`)}
          </Text>
        )}
        {outcome.kind === "idle" ? (
          <Field label={t("nativeDsh.registration.path")}>
            <FormTextInput
              initialValue={state.path}
              onChangeText={form.setPath}
              editable={state.editable}
              size={size}
              testID="dsh-register-path"
              accessibilityLabel={t("nativeDsh.registration.path")}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
        ) : (
          <View style={styles.group} testID={`dsh-register-outcome-${outcome.kind}`}>
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {t(`nativeDsh.registration.outcome.${outcome.kind}`)}
            </Text>
            <Text selectable style={styles.text} testID="dsh-register-request-path">
              {outcome.request.path}
            </Text>
            {outcome.kind === "rejected" && (
              <ScrollView style={styles.detail} testID="dsh-register-diagnostic">
                <Text selectable style={styles.muted}>
                  {outcome.message}
                </Text>
              </ScrollView>
            )}
            {(outcome.kind === "confirmed" || outcome.kind === "adopted") && (
              <View style={styles.group}>
                <Text selectable style={styles.text}>
                  {outcome.workspace.path}
                </Text>
                <Text style={styles.muted} testID="dsh-register-selection">
                  {state.currentWorkspace !== null
                    ? t("nativeDsh.registration.selectInSession", {
                        name: state.currentWorkspace.title,
                      })
                    : t("nativeDsh.registration.notListed")}
                </Text>
              </View>
            )}
          </View>
        )}
        {registration.storage === "failed" && (
          <Button
            size={size}
            variant="outline"
            testID="dsh-register-restore"
            loading={state.working}
            disabled={state.working}
            onPress={form.restore}
          >
            {t("nativeDsh.registration.restore")}
          </Button>
        )}
        {outcome.kind === "unknown" && (
          <View style={styles.group}>
            {registration.lookupAvailability !== "available" && (
              <Text style={styles.muted}>
                {t(`nativeDsh.registration.lookupAvailability.${registration.lookupAvailability}`)}
              </Text>
            )}
            <Button
              size={size}
              variant="outline"
              testID="dsh-register-check"
              loading={lookup.kind === "loading" || state.working}
              disabled={!state.canCheck}
              onPress={form.checkCurrent}
            >
              {t("nativeDsh.registration.check")}
            </Button>
            {lookup.kind !== "idle" && (
              <View style={styles.group} testID={`dsh-register-lookup-${lookup.kind}`}>
                <Text accessibilityLiveRegion="polite" style={styles.muted}>
                  {t(`nativeDsh.registration.lookup.${lookup.kind}`)}
                </Text>
                {lookup.kind === "found" && (
                  <>
                    <Text selectable style={styles.text}>
                      {lookup.workspace.title}
                    </Text>
                    <Text selectable style={styles.text}>
                      {lookup.workspace.path}
                    </Text>
                    <Button
                      size={size}
                      testID="dsh-register-adopt"
                      disabled={!state.canAdopt}
                      onPress={form.adoptCurrent}
                    >
                      {t("nativeDsh.registration.adopt")}
                    </Button>
                  </>
                )}
              </View>
            )}
          </View>
        )}
      </View>
    </AdaptiveModalSheet>
  );
}
export function RegistrationControl({ runtime, busy }: { runtime: DshHostRuntime; busy: boolean }) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState<DshHostRuntime | null>(null);
  const registration = useSyncExternalStore(
    runtime.registration.subscribe,
    runtime.registration.getSnapshot,
  );
  const show = useCallback(() => setOpened(runtime), [runtime]);
  const close = useCallback(() => setOpened(null), []);
  if (
    registration.outcome.kind === "idle" &&
    registration.availability === "unavailable" &&
    registration.storage === "ready"
  )
    return null;
  return (
    <>
      <Button size="sm" testID="dsh-register-workspace" disabled={busy} onPress={show}>
        {registration.outcome.kind === "idle"
          ? t("nativeDsh.registration.title")
          : t("nativeDsh.registration.review")}
      </Button>
      {opened === runtime && <RegistrationSheet runtime={runtime} onClose={close} />}
    </>
  );
}
