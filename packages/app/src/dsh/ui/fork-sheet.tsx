import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { SessionId, WorkspaceId } from "@deepseek-ai/dsh-client";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { ForkChild } from "../fork-journal";
import type { DshHostRuntime } from "../runtime";
import { useFork } from "../use-fork";
import { styles } from "./styles";

type ForkSnapshot = ReturnType<DshHostRuntime["fork"]["getSnapshot"]>;
type ForkOutcome = ForkSnapshot["outcome"];
type ForkLookupKind = ForkSnapshot["lookup"]["kind"];

function AnchorField({
  anchor,
  invalid,
  editable,
  setAnchor,
}: {
  anchor: string;
  invalid: boolean;
  editable: boolean;
  setAnchor(value: string): void;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  return (
    <Field label={t("nativeDsh.fork.anchor")}>
      <FormTextInput
        initialValue={anchor}
        onChangeText={setAnchor}
        editable={editable}
        size={size}
        testID="dsh-fork-anchor"
        accessibilityLabel={t("nativeDsh.fork.anchor")}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.muted}>{t("nativeDsh.fork.anchorHint")}</Text>
      {invalid && (
        <Text accessibilityRole="alert" style={styles.error} testID="dsh-fork-anchor-invalid">
          {t("nativeDsh.fork.anchorInvalid")}
        </Text>
      )}
    </Field>
  );
}

/**
 * Membership is a current observation from the shared Workspace list, never an
 * attachment. A null baseline and an empty ready baseline stay distinct.
 */
function WorkspaceMembership({ runtime, child }: { runtime: DshHostRuntime; child: ForkChild }) {
  const { t } = useTranslation();
  const list = useSyncExternalStore(
    runtime.workspaces.list.subscribe,
    runtime.workspaces.list.getSnapshot,
  );
  const names = useMemo(() => {
    if (child.workspaceIds === null) return null;
    if (list.phase !== "ready" || list.error !== null) return null;
    const ids: readonly WorkspaceId[] = child.workspaceIds;
    return list.items.filter((item) => ids.includes(item.workspaceId)).map((item) => item.title);
  }, [child.workspaceIds, list]);
  let line: React.ReactNode = null;
  if (names === null)
    line = <Text style={styles.muted}>{t("nativeDsh.fork.workspace.baseline")}</Text>;
  else if (names.length === 0)
    line = <Text style={styles.muted}>{t("nativeDsh.fork.workspace.none")}</Text>;
  else
    line = (
      <Text selectable style={styles.text} testID="dsh-fork-workspaces">
        {t("nativeDsh.fork.workspace.some", { names: names.join(", ") })}
      </Text>
    );
  return (
    <View style={styles.group} testID="dsh-fork-membership">
      {line}
    </View>
  );
}

/** A positive read shows the exact child and parent without confirming the request. */
function ChildObservation({
  runtime,
  child,
  targetWorkspaceId,
}: {
  runtime: DshHostRuntime;
  child: ForkChild;
  targetWorkspaceId?: WorkspaceId;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text selectable style={styles.text} testID="dsh-fork-child-id">
        {child.id}
      </Text>
      <Text selectable style={styles.muted} testID="dsh-fork-child-parent">
        {t("nativeDsh.fork.child.parent")}: {child.parentId}
      </Text>
      <Text selectable style={styles.text} testID="dsh-fork-child-title">
        {child.displayTitle}
      </Text>
      <WorkspaceMembership runtime={runtime} child={child} />
      {targetWorkspaceId !== undefined && (
        <Text selectable style={styles.error} testID="dsh-fork-target-workspace">
          {t("nativeDsh.fork.workspace.failedTarget", { id: targetWorkspaceId })}
        </Text>
      )}
    </>
  );
}

function ForkRequestDetails({ outcome }: { outcome: Exclude<ForkOutcome, { kind: "idle" }> }) {
  const { t } = useTranslation();
  return (
    <View style={styles.group} testID={`dsh-fork-outcome-${outcome.kind}`}>
      <Text accessibilityLiveRegion="polite" style={styles.text}>
        {t(`nativeDsh.fork.outcome.${outcome.kind}`)}
      </Text>
      <Text selectable style={styles.muted} testID="dsh-fork-request-child">
        {outcome.request.childSessionId}
      </Text>
      {outcome.request.atSeq !== undefined && (
        <Text selectable style={styles.muted} testID="dsh-fork-request-anchor">
          {String(outcome.request.atSeq)}
        </Text>
      )}
      {outcome.kind === "attachment-failed" && (
        <Text selectable style={styles.error} testID="dsh-fork-request-workspace">
          {outcome.workspaceId}
        </Text>
      )}
    </View>
  );
}

function ForkLookup({
  runtime,
  state,
  outcome,
}: {
  runtime: DshHostRuntime;
  state: ForkSnapshot;
  outcome: ForkOutcome;
}) {
  const { t } = useTranslation();
  const { lookup } = state;
  const targetWorkspaceId = outcome.kind === "attachment-failed" ? outcome.workspaceId : undefined;
  return (
    <View style={styles.group}>
      {state.lookupAvailability !== "available" && (
        <Text style={styles.muted}>
          {t(`nativeDsh.fork.lookupAvailability.${state.lookupAvailability}`)}
        </Text>
      )}
      {lookup.kind !== "idle" && (
        <View style={styles.group} testID={`dsh-fork-lookup-${lookup.kind}`}>
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            {t(`nativeDsh.fork.lookup.${lookup.kind}`)}
          </Text>
          {lookup.kind === "found" && (
            <ChildObservation
              runtime={runtime}
              child={lookup.child}
              targetWorkspaceId={targetWorkspaceId}
            />
          )}
        </View>
      )}
    </View>
  );
}

function ForkActions({
  idle,
  terminal,
  canSubmit,
  canCheck,
  canAdopt,
  lookupKind,
  working,
  submit,
  checkCurrent,
  adoptCurrent,
  reset,
  onClose,
}: {
  idle: boolean;
  terminal: boolean;
  canSubmit: boolean;
  canCheck: boolean;
  canAdopt: boolean;
  lookupKind: ForkLookupKind;
  working: boolean;
  submit(): void;
  checkCurrent(): void;
  adoptCurrent(): void;
  reset(): void;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  return (
    <View style={styles.creationActions} testID="dsh-fork-actions">
      {idle && (
        <Button
          size={size}
          testID="dsh-fork-submit"
          disabled={!canSubmit}
          loading={working}
          onPress={submit}
        >
          {t("nativeDsh.fork.submit")}
        </Button>
      )}
      {!idle && !terminal && (
        <Button
          size={size}
          variant="outline"
          testID="dsh-fork-check"
          loading={lookupKind === "loading" || working}
          disabled={!canCheck}
          onPress={checkCurrent}
        >
          {t("nativeDsh.fork.check")}
        </Button>
      )}
      {canAdopt && (
        <Button size={size} testID="dsh-fork-adopt" disabled={working} onPress={adoptCurrent}>
          {t("nativeDsh.fork.adopt")}
        </Button>
      )}
      {terminal && (
        <Button
          size={size}
          variant="outline"
          testID="dsh-fork-reset"
          disabled={working}
          onPress={reset}
        >
          {t("nativeDsh.fork.reset")}
        </Button>
      )}
      <Button size={size} variant="outline" testID="dsh-fork-close" onPress={onClose}>
        {t("nativeDsh.fork.close")}
      </Button>
    </View>
  );
}

function ForkSheetContent({
  runtime,
  sessionId,
  state,
  anchor,
  invalid,
  editable,
  setAnchor,
  working,
  restore,
}: {
  runtime: DshHostRuntime;
  sessionId: SessionId;
  state: ForkSnapshot;
  anchor: string;
  invalid: boolean;
  editable: boolean;
  setAnchor(value: string): void;
  working: boolean;
  restore(): void;
}) {
  const { t } = useTranslation();
  const { outcome } = state;
  const idle = outcome.kind === "idle";
  const terminal =
    outcome.kind === "confirmed" || outcome.kind === "adopted" || outcome.kind === "not-dispatched";
  return (
    <View style={styles.group}>
      <Text style={styles.muted}>{t("nativeDsh.fork.explanation")}</Text>
      {state.availability !== "available" && !idle && (
        <Text style={styles.muted}>{t(`nativeDsh.fork.${state.availability}`)}</Text>
      )}
      {state.storage !== "ready" && (
        <Text accessibilityRole="alert" style={styles.error} testID="dsh-fork-storage">
          {t(`nativeDsh.fork.storage.${state.storage}`)}
        </Text>
      )}
      <Text style={styles.title}>{t("nativeDsh.fork.source")}</Text>
      <Text selectable style={styles.text} testID="dsh-fork-source">
        {sessionId}
      </Text>
      {idle ? (
        <AnchorField anchor={anchor} invalid={invalid} editable={editable} setAnchor={setAnchor} />
      ) : (
        <ForkRequestDetails outcome={outcome} />
      )}
      {state.storage === "failed" && (
        <Button
          size="sm"
          variant="outline"
          testID="dsh-fork-restore"
          loading={working}
          disabled={working}
          onPress={restore}
        >
          {t("nativeDsh.fork.check")}
        </Button>
      )}
      {!idle && !terminal && <ForkLookup runtime={runtime} state={state} outcome={outcome} />}
      {(outcome.kind === "confirmed" || outcome.kind === "adopted") && (
        <Text style={styles.muted} testID="dsh-fork-retained-child">
          {t("nativeDsh.fork.child.observed")}: {outcome.request.childSessionId}
        </Text>
      )}
    </View>
  );
}

function ForkSheet({
  runtime,
  sessionId,
  onClose,
}: {
  runtime: DshHostRuntime;
  sessionId: SessionId;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const {
    state,
    anchor,
    invalid,
    setAnchor,
    working,
    forkSession,
    checkCurrent,
    adoptCurrent,
    reset,
    restore,
  } = useFork(runtime);
  const { outcome, lookup } = state;
  const idle = outcome.kind === "idle";
  const terminal =
    outcome.kind === "confirmed" || outcome.kind === "adopted" || outcome.kind === "not-dispatched";
  const canSubmit =
    state.storage === "ready" && idle && !working && state.availability === "available" && !invalid;
  const canCheck =
    state.storage === "ready" &&
    !working &&
    !idle &&
    !terminal &&
    state.lookupAvailability === "available" &&
    lookup.kind !== "loading";
  const submit = useCallback(() => forkSession(sessionId), [forkSession, sessionId]);
  const header = useMemo(() => ({ title: t("nativeDsh.fork.title") }), [t]);
  /* eslint-disable-next-line eslint-plugin-react-perf/jsx-no-jsx-as-prop -- The shared sheet contract takes a ReactNode footer, as the sibling sheets do. */
  const footer = (
    <ForkActions
      idle={idle}
      terminal={terminal}
      canSubmit={canSubmit}
      canCheck={canCheck}
      canAdopt={canCheck && lookup.kind === "found"}
      lookupKind={lookup.kind}
      working={working}
      submit={submit}
      checkCurrent={checkCurrent}
      adoptCurrent={adoptCurrent}
      reset={reset}
      onClose={onClose}
    />
  );
  return (
    <AdaptiveModalSheet
      visible
      header={header}
      footer={footer}
      onClose={onClose}
      testID="dsh-fork-sheet"
    >
      <ForkSheetContent
        runtime={runtime}
        sessionId={sessionId}
        state={state}
        anchor={anchor}
        invalid={invalid}
        editable={state.storage === "ready" && idle && !working}
        setAnchor={setAnchor}
        working={working}
        restore={restore}
      />
    </AdaptiveModalSheet>
  );
}

/** The conversation-header entry point; the durable attempt stays owned by the runtime. */
export function ForkControl({
  runtime,
  sessionId,
  busy,
}: {
  runtime: DshHostRuntime;
  sessionId: SessionId;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState<SessionId | null>(null);
  const state = useSyncExternalStore(runtime.fork.subscribe, runtime.fork.getSnapshot);
  const show = useCallback(() => setOpened(sessionId), [sessionId]);
  const close = useCallback(() => setOpened(null), []);
  const unavailable =
    state.availability === "unavailable" &&
    state.storage === "ready" &&
    state.outcome.kind === "idle";
  if (unavailable) return null;
  return (
    <>
      <Button size="sm" testID="dsh-fork-session" disabled={busy} onPress={show}>
        {state.outcome.kind === "idle" ? t("nativeDsh.fork.title") : t("nativeDsh.fork.review")}
      </Button>
      {opened !== null && <ForkSheet runtime={runtime} sessionId={opened} onClose={close} />}
    </>
  );
}
