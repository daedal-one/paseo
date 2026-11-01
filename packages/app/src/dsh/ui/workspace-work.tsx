import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowUpRight } from "lucide-react-native";
import type { SessionId } from "@deepseek-ai/dsh-client";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DshDirectory } from "../directory";
import type { DshWorkCreationTarget } from "../creation";
import type { DshHostRuntime } from "../runtime";
import type { DshWorkItem } from "../workspace-data";
import type { WorkspaceOverview } from "../workspace-overview";
import { useSnapshot } from "./use-snapshot";
import { WorkspaceReadNotice } from "./workspace-read-notice";
import { CreationControl } from "./creation-sheet";
import { workspaceConversationScheduler } from "./workspace-executions";
import { workspaceStyles as ws } from "./workspace-styles";
import { styles } from "./styles";

interface WorkProps {
  runtime: DshHostRuntime;
  model: DshDirectory;
  overview: WorkspaceOverview;
  creating: boolean;
  onCloseCreate(): void;
}

export function WorkspaceWork({ runtime, model, overview, creating, onCloseCreate }: WorkProps) {
  const { t } = useTranslation();
  const state = useSnapshot(runtime.workspaceData);
  const directory = useSnapshot(model);
  const back = useCallback(() => model.selectWork(null), [model]);
  const retry = useCallback(() => {
    void runtime.workspaceData.refresh();
  }, [runtime]);
  const loadMore = useCallback(() => {
    void runtime.workspaceData.loadMoreWork();
  }, [runtime]);
  const connectExisting = useCallback(() => {
    void runtime.workspaceData.connectExistingWork();
  }, [runtime]);
  const candidate = state.work.status === "ready" ? state.work.value.adoptionCandidate : null;
  if (directory.workspaceSection === "work" && directory.selectedWorkId !== null)
    return (
      <View style={ws.detail}>
        {state.detail.status === "ready" ? (
          <WorkDetail
            key={state.detail.value.id}
            work={state.detail.value}
            runtime={runtime}
            model={model}
            overview={overview}
            onBack={back}
          />
        ) : (
          <>
            <View style={ws.actions}>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={ArrowLeft}
                onPress={back}
                style={ws.touch}
              >
                {t("nativeDsh.work.back")}
              </Button>
            </View>
            <WorkspaceReadNotice status={state.detail.status} onRetry={retry} />
          </>
        )}
      </View>
    );
  return (
    <View style={ws.section} testID="dsh-work-list">
      <View style={ws.heading}>
        <Text accessibilityRole="header" style={ws.sectionTitle}>
          {t("nativeDsh.workspaceOverview.tabs.work")}
        </Text>
        {state.work.status === "ready" && candidate === null && (
          <Text style={ws.muted}>{state.work.value.items.length}</Text>
        )}
      </View>
      <WorkspaceReadNotice status={state.work.status} onRetry={retry} />
      {candidate !== null && (
        <View style={ws.empty} testID="dsh-work-connect-existing">
          <Text style={ws.text}>{candidate.title}</Text>
          <Text style={ws.muted}>{t("nativeDsh.work.connectExistingDescription")}</Text>
          <View style={ws.actions}>
            <Button
              size="sm"
              variant="secondary"
              style={ws.touch}
              onPress={connectExisting}
              disabled={
                !state.canInitialize ||
                state.mutation.status === "sending" ||
                state.mutation.status === "unknown"
              }
              loading={state.mutation.status === "sending"}
              testID="dsh-work-connect"
            >
              {t("nativeDsh.work.connectExisting")}
            </Button>
          </View>
        </View>
      )}
      {candidate === null && creating && (
        <WorkEditor
          runtime={runtime}
          model={model}
          workspaceTitle={overview.workspace?.title ?? ""}
          onClose={onCloseCreate}
        />
      )}
      {candidate === null && !creating && state.work.status === "ready" && (
        <>
          {state.work.value.items.length === 0 && (
            <View style={ws.empty}>
              <Text style={ws.text}>{t("nativeDsh.work.empty")}</Text>
              <Text style={ws.muted}>{t("nativeDsh.work.emptyDescription")}</Text>
            </View>
          )}
          {state.work.value.items.map((work) => (
            <WorkRow key={work.id} work={work} model={model} />
          ))}
          {state.work.value.nextCursor !== null && (
            <Button size="sm" variant="ghost" onPress={loadMore} loading={state.loadingMore}>
              {t("nativeDsh.work.loadMore")}
            </Button>
          )}
          {state.loadMoreFailed && (
            <Text style={styles.error}>{t("nativeDsh.work.loadMoreFailed")}</Text>
          )}
        </>
      )}
    </View>
  );
}

function WorkRow({ work, model }: { work: DshWorkItem; model: DshDirectory }) {
  const { t, i18n } = useTranslation();
  const open = useCallback(() => model.selectWork(work.id), [model, work.id]);
  const badge = useMemo(
    () => (
      <StatusBadge
        variant={work.status === "completed" || work.status === "accepted" ? "success" : "muted"}
        label={t(`nativeDsh.work.status.${work.status}`)}
      />
    ),
    [work.status, t],
  );
  return (
    <View style={ws.item}>
      <Button
        size="sm"
        variant="ghost"
        style={ws.rowButton}
        textStyle={ws.rowButtonText}
        trailing={badge}
        onPress={open}
        testID={`dsh-work-open-${work.id}`}
      >
        {work.title}
      </Button>
      {work.basis === "tracking" && (
        <Text style={ws.muted} numberOfLines={2}>
          {work.brief}
        </Text>
      )}
      <View style={ws.rowMeta}>
        <Text style={ws.muted}>
          {t("nativeDsh.work.executions")}: {work.sessions.length}
        </Text>
        {work.basis === "tracking" && (
          <Text style={ws.muted}>
            {t("nativeDsh.work.updatedAt")}{" "}
            {new Date(work.updatedAt).toLocaleDateString(i18n.language)}
          </Text>
        )}
      </View>
    </View>
  );
}

function WorkEditor({
  runtime,
  model,
  work,
  workspaceTitle,
  onClose,
}: {
  runtime: DshHostRuntime;
  model: DshDirectory;
  work?: Extract<DshWorkItem, { basis: "tracking" }>;
  workspaceTitle?: string;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const state = useSnapshot(runtime.workspaceData);
  const [title, setTitle] = useState(work?.title ?? "");
  const [brief, setBrief] = useState(work?.brief ?? "");
  const blocked = state.mutation.status === "sending" || state.mutation.status === "unknown";
  const allowed =
    work === undefined
      ? state.canCreate &&
        state.work.status === "ready" &&
        (state.work.value.binding !== null || state.work.value.adoptionCandidate === null) &&
        workspaceTitle !== undefined
      : state.canUpdate && work.status === "open";
  const submit = useCallback(async () => {
    let saved: DshWorkItem | null;
    if (work === undefined) {
      if (workspaceTitle === undefined) return;
      saved = await runtime.workspaceData.createWork({ title, brief, workspaceTitle });
    } else {
      saved = await runtime.workspaceData.updateWork({
        id: work.id,
        expectedRevision: work.revision,
        title,
        brief,
      });
    }
    if (saved !== null) {
      onClose();
      model.selectWork(saved.id);
    }
  }, [runtime, model, work, title, brief, workspaceTitle, onClose]);
  return (
    <View style={ws.form} testID="dsh-work-editor">
      <Field label={t("nativeDsh.work.title")}>
        <FormTextInput
          initialValue={title}
          onChangeText={setTitle}
          placeholder={t("nativeDsh.work.titlePlaceholder")}
          maxLength={4096}
          editable={!blocked}
          testID="dsh-work-title"
        />
      </Field>
      <Field label={t("nativeDsh.work.objective")}>
        <FormTextInput
          initialValue={brief}
          onChangeText={setBrief}
          placeholder={t("nativeDsh.work.objectivePlaceholder")}
          multiline
          style={ws.briefInput}
          maxLength={4096}
          editable={!blocked}
          testID="dsh-work-brief"
        />
      </Field>
      <View style={ws.actions}>
        <Button
          size="sm"
          variant="secondary"
          style={ws.touch}
          onPress={submit}
          disabled={blocked || !allowed || title.trim() === "" || brief.trim() === ""}
          loading={state.mutation.status === "sending"}
          testID="dsh-work-save"
        >
          {t(work === undefined ? "nativeDsh.work.create" : "nativeDsh.work.save")}
        </Button>
        <Button size="sm" variant="ghost" style={ws.touch} onPress={onClose} disabled={blocked}>
          {t("nativeDsh.work.cancel")}
        </Button>
      </View>
    </View>
  );
}

function WorkDetail({
  work,
  runtime,
  model,
  overview,
  onBack,
}: {
  work: DshWorkItem;
  runtime: DshHostRuntime;
  model: DshDirectory;
  overview: WorkspaceOverview;
  onBack(): void;
}) {
  const { t } = useTranslation();
  return (
    <View style={ws.detail} testID="dsh-work-detail">
      <View style={ws.heading}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={ArrowLeft}
          onPress={onBack}
          style={ws.touch}
          accessibilityLabel={t("nativeDsh.work.back")}
        />
        <Text accessibilityRole="header" style={[ws.detailTitle, ws.itemTitle]}>
          {work.title}
        </Text>
        <StatusBadge
          variant={work.status === "completed" || work.status === "accepted" ? "success" : "muted"}
          label={t(`nativeDsh.work.status.${work.status}`)}
        />
      </View>
      <View style={ws.detailMeta}>
        <Text style={ws.muted}>{t("nativeDsh.work.revision", { revision: work.revision })}</Text>
        {work.basis === "qualified" && (
          <Text style={ws.muted}>{t("nativeDsh.work.qualified")}</Text>
        )}
      </View>
      {work.basis === "tracking" ? (
        <TrackingWorkBody work={work} runtime={runtime} model={model} />
      ) : (
        <Text style={ws.muted}>{t("nativeDsh.work.qualifiedReadOnly")}</Text>
      )}
      <WorkExecutions work={work} runtime={runtime} model={model} overview={overview} />
    </View>
  );
}

function WorkExecutions({
  work,
  runtime,
  model,
  overview,
}: {
  work: DshWorkItem;
  runtime: DshHostRuntime;
  model: DshDirectory;
  overview: WorkspaceOverview;
}) {
  const { t } = useTranslation();
  const state = useSnapshot(runtime.workspaceData);
  const [selected, setSelected] = useState<SessionId | null>(null);
  const options = useMemo(
    () =>
      overview.activity
        .filter((item) => !work.sessions.includes(item.session.id))
        .map((item) => ({
          id: item.session.id,
          value: item.session.id,
          label: item.session.displayTitle,
        })),
    [overview.activity, work.sessions],
  );
  const display = useMemo(
    () => options.find((item) => item.value === selected) ?? null,
    [options, selected],
  );
  const blocked = state.mutation.status === "sending" || state.mutation.status === "unknown";
  const attach = useCallback(async () => {
    if (selected === null || work.basis !== "tracking" || work.status !== "open") return;
    const linked = await runtime.workspaceData.attachSession({
      id: work.id,
      expectedRevision: work.revision,
      sessionId: selected,
    });
    if (linked !== null) setSelected(null);
  }, [selected, runtime, work]);
  const openCreated = useCallback(
    async (sessionId: SessionId, target?: DshWorkCreationTarget) => {
      if (target === undefined) {
        await model.openWorkExecution(sessionId, workspaceConversationScheduler);
        return;
      }
      if (target.id !== work.id || target.workspaceId !== model.getSnapshot().selectedWorkspaceId)
        return;
      if (work.sessions.includes(sessionId)) {
        await model.openWorkExecution(sessionId, workspaceConversationScheduler);
        return;
      }
      const linked = await runtime.workspaceData.attachSession({
        id: target.id,
        expectedRevision: target.expectedRevision,
        sessionId,
      });
      if (linked !== null) {
        const brief =
          linked.basis === "tracking"
            ? linked.executionLinks.find((item) => item.sessionId === sessionId)?.brief
            : undefined;
        await model.openWorkExecution(sessionId, workspaceConversationScheduler, brief);
      }
    },
    [runtime, model, work],
  );
  const workTarget = useMemo(
    () =>
      overview.workspace === null
        ? undefined
        : {
            id: work.id,
            workspaceId: overview.workspace.workspaceId,
            expectedRevision: work.revision,
          },
    [overview.workspace, work.id, work.revision],
  );
  return (
    <View style={[ws.section, ws.separator]}>
      <View style={ws.heading}>
        <Text accessibilityRole="header" style={ws.sectionTitle}>
          {t("nativeDsh.work.executions")}
        </Text>
        {work.basis === "tracking" && work.status === "open" && overview.workspace !== null && (
          <CreationControl
            label={t("nativeDsh.work.startExecution")}
            runtime={runtime}
            workspaceId={overview.workspace.workspaceId}
            workTarget={workTarget}
            onOpenSession={openCreated}
            busy={blocked || !state.canAttachSession}
          />
        )}
      </View>
      {work.sessions.length === 0 && (
        <Text style={ws.muted}>{t("nativeDsh.work.noExecutions")}</Text>
      )}
      {work.sessions.map((sessionId) => (
        <WorkExecution
          key={sessionId}
          sessionId={sessionId}
          work={work}
          model={model}
          overview={overview}
        />
      ))}
      {work.basis === "tracking" && work.status === "open" && (
        <View style={ws.queryToolbar}>
          <View style={ws.picker}>
            <SelectField<SessionId>
              field={false}
              label={t("nativeDsh.work.attachExecution")}
              value={selected}
              selectedDisplay={display}
              options={options}
              onChange={setSelected}
              placeholder={t("nativeDsh.work.chooseExecution")}
              emptyText={t("nativeDsh.work.noExecutions")}
              disabled={blocked || !state.canAttachSession}
              testID="dsh-work-attach-picker"
            />
          </View>
          <Button
            size="sm"
            variant="outline"
            onPress={attach}
            disabled={selected === null || blocked || !state.canAttachSession}
            style={ws.touch}
            testID="dsh-work-attach"
          >
            {t("nativeDsh.work.attachExecution")}
          </Button>
        </View>
      )}
    </View>
  );
}

function WorkExecution({
  sessionId,
  work,
  model,
  overview,
}: {
  sessionId: string;
  work: DshWorkItem;
  model: DshDirectory;
  overview: WorkspaceOverview;
}) {
  const { t } = useTranslation();
  const [briefVisible, setBriefVisible] = useState(false);
  const toggleBrief = useCallback(() => setBriefVisible((value) => !value), []);
  const open = useCallback(
    () => model.openWorkExecution(sessionId, workspaceConversationScheduler),
    [model, sessionId],
  );
  const session = overview.activity.find((item) => item.session.id === sessionId);
  const link =
    work.basis === "tracking"
      ? work.executionLinks.find((item) => item.sessionId === sessionId)
      : undefined;
  return (
    <View style={ws.item}>
      <View style={ws.itemHeading}>
        <Text style={[ws.text, ws.itemTitle]}>{session?.session.displayTitle ?? sessionId}</Text>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={ArrowUpRight}
          style={ws.touch}
          onPress={open}
          testID={`dsh-work-execution-${sessionId}`}
        >
          {t("nativeDsh.conversation.open")}
        </Button>
      </View>
      {link !== undefined && (
        <View style={ws.rowMeta}>
          <Text style={ws.muted}>
            {t("nativeDsh.work.briefRevision", { revision: link.briefRevision })}
          </Text>
          <Button variant="ghost" size="sm" style={ws.touch} onPress={toggleBrief}>
            {t("nativeDsh.work.executionBrief")}
          </Button>
        </View>
      )}
      {briefVisible && link !== undefined && (
        <Text selectable style={ws.muted}>
          {link.brief}
        </Text>
      )}
    </View>
  );
}

function TrackingWorkBody({
  work,
  runtime,
  model,
}: {
  work: Extract<DshWorkItem, { basis: "tracking" }>;
  runtime: DshHostRuntime;
  model: DshDirectory;
}) {
  const { t } = useTranslation();
  const state = useSnapshot(runtime.workspaceData);
  const [editing, setEditing] = useState(false);
  const edit = useCallback(() => setEditing(true), []);
  const closeEdit = useCallback(() => setEditing(false), []);
  const setStatus = useCallback(
    (status: "open" | "completed" | "cancelled") =>
      runtime.workspaceData.setWorkStatus({ id: work.id, expectedRevision: work.revision, status }),
    [runtime, work],
  );
  const complete = useCallback(() => setStatus("completed"), [setStatus]);
  const reopen = useCallback(() => setStatus("open"), [setStatus]);
  const blocked = state.mutation.status === "sending" || state.mutation.status === "unknown";
  if (editing && work.status === "open")
    return <WorkEditor runtime={runtime} model={model} work={work} onClose={closeEdit} />;
  return (
    <>
      <Text selectable style={ws.prose}>
        {work.brief}
      </Text>
      {work.status !== "open" && (
        <Text style={ws.muted}>
          {t(
            work.status === "completed"
              ? "nativeDsh.work.completedReadOnly"
              : "nativeDsh.work.cancelledReadOnly",
          )}
        </Text>
      )}
      {work.status !== "cancelled" && (
        <View style={ws.actions}>
          {work.status === "open" && (
            <>
              <Button
                size="sm"
                variant="ghost"
                style={ws.touch}
                onPress={edit}
                disabled={blocked || !state.canUpdate}
              >
                {t("nativeDsh.work.edit")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                style={ws.touch}
                onPress={complete}
                disabled={blocked || !state.canSetStatus}
              >
                {t("nativeDsh.work.complete")}
              </Button>
            </>
          )}
          {work.status === "completed" && (
            <Button
              size="sm"
              variant="outline"
              style={ws.touch}
              onPress={reopen}
              disabled={blocked || !state.canSetStatus}
            >
              {t("nativeDsh.work.reopen")}
            </Button>
          )}
        </View>
      )}
    </>
  );
}
