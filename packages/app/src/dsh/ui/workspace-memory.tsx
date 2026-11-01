import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Search } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DshHostRuntime } from "../runtime";
import type { DshMemoryRecord } from "../workspace-data";
import { useSnapshot } from "./use-snapshot";
import { WorkspaceReadNotice } from "./workspace-read-notice";
import { workspaceStyles as ws } from "./workspace-styles";

export function WorkspaceMemory({
  runtime,
  preview = false,
  onBrowse,
}: {
  runtime: DshHostRuntime;
  preview?: boolean;
  onBrowse?: () => void;
}) {
  const { t } = useTranslation();
  const state = useSnapshot(runtime.workspaceData);
  const [query, setQuery] = useState(state.memoryQuery.text);
  const [status, setStatus] = useState<DshMemoryRecord["status"] | "all">(
    state.memoryQuery.statuses?.[0] ?? "all",
  );
  const options = useMemo(
    () =>
      (["all", "proposed", "active", "challenged", "rejected", "superseded"] as const).map(
        (value) => ({ id: value, value, label: t(`nativeDsh.workspaceMemory.${value}`) }),
      ),
    [t],
  );
  const display = useMemo(() => ({ label: t(`nativeDsh.workspaceMemory.${status}`) }), [status, t]);
  const search = useCallback(() => {
    void runtime.workspaceData.refreshMemory({
      text: query,
      ...(status === "all" ? {} : { statuses: [status] }),
    });
  }, [runtime, query, status]);
  const selectStatus = useCallback(
    (value: DshMemoryRecord["status"] | "all") => {
      setStatus(value);
      void runtime.workspaceData.refreshMemory({
        text: query,
        ...(value === "all" ? {} : { statuses: [value] }),
      });
    },
    [runtime, query],
  );
  const memory = state.memory;
  return (
    <View style={ws.section} testID="dsh-workspace-memory">
      <View style={ws.heading}>
        <Text accessibilityRole="header" style={ws.sectionTitle}>
          {t("nativeDsh.workspaceMemory.title")}
        </Text>
        {preview && onBrowse !== undefined && (
          <Button size="sm" variant="ghost" onPress={onBrowse}>
            {t("nativeDsh.workspaceMemory.browse")}
          </Button>
        )}
      </View>
      {!preview && (
        <View style={ws.queryToolbar}>
          <View style={ws.memoryQuery}>
            <FormTextInput
              initialValue={query}
              onChangeText={setQuery}
              accessibilityLabel={t("nativeDsh.workspaceMemory.search")}
              placeholder={t("nativeDsh.workspaceMemory.query")}
              onSubmitEditing={search}
              testID="dsh-memory-search"
            />
          </View>
          <View style={ws.memoryFilter}>
            <SelectField<DshMemoryRecord["status"] | "all">
              field={false}
              label={t("nativeDsh.workspaceMemory.status")}
              value={status}
              selectedDisplay={display}
              options={options}
              onChange={selectStatus}
              placeholder={t("nativeDsh.workspaceMemory.status")}
              emptyText={t("nativeDsh.workspaceMemory.empty")}
              size="sm"
            />
          </View>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Search}
            style={ws.touch}
            onPress={search}
            disabled={memory.status === "loading"}
          >
            {t("nativeDsh.workspaceMemory.search")}
          </Button>
        </View>
      )}
      <WorkspaceReadNotice status={memory.status} onRetry={search} />
      {memory.status === "ready" && (
        <>
          {memory.value.memories.length === 0 && (
            <Text style={ws.muted}>{t("nativeDsh.workspaceMemory.empty")}</Text>
          )}
          {(preview ? memory.value.memories.slice(0, 3) : memory.value.memories).map((record) => (
            <MemoryRecord
              key={record.id}
              record={record}
              runtime={runtime}
              preview={preview}
              onBrowse={onBrowse}
            />
          ))}
          {memory.value.truncated && (
            <Text style={ws.muted}>{t("nativeDsh.workspaceMemory.truncated")}</Text>
          )}
        </>
      )}
    </View>
  );
}

function MemoryRecord({
  record,
  runtime,
  preview,
  onBrowse,
}: {
  record: DshMemoryRecord;
  runtime: DshHostRuntime;
  preview: boolean;
  onBrowse?: () => void;
}) {
  const { t } = useTranslation();
  const model = runtime.workspaceData;
  const state = useSnapshot(model);
  const [expanded, setExpanded] = useState(false);
  const expandedState = useMemo(() => ({ expanded }), [expanded]);
  const [correcting, setCorrecting] = useState(false);
  const [statement, setStatement] = useState(record.statement);
  const toggle = useCallback(
    () => (preview ? onBrowse?.() : setExpanded((value) => !value)),
    [preview, onBrowse],
  );
  const startCorrecting = useCallback(() => {
    setStatement(record.statement);
    setCorrecting(true);
  }, [record.statement]);
  const cancelCorrecting = useCallback(() => setCorrecting(false), []);
  const save = useCallback(async () => {
    const corrected = await model.correctMemory({
      id: record.id,
      revision: record.revision,
      statement,
    });
    if (corrected !== null) setCorrecting(false);
  }, [model, record, statement]);
  const accept = useCallback(
    () => model.reviewMemory({ id: record.id, revision: record.revision, decision: "accept" }),
    [model, record],
  );
  const reject = useCallback(
    () => model.reviewMemory({ id: record.id, revision: record.revision, decision: "reject" }),
    [model, record],
  );
  const disabled = state.mutation.status === "sending" || state.mutation.status === "unknown";
  const canReview =
    state.canReviewMemory && (record.status === "proposed" || record.status === "challenged");
  const canCorrect =
    state.canCorrectMemory && (record.status === "active" || record.status === "challenged");
  return (
    <View style={ws.memoryItem} testID={`dsh-memory-${record.id}`}>
      <View style={ws.itemHeading}>
        <StatusBadge
          variant={memoryVariant(record.status)}
          label={t(`nativeDsh.workspaceMemory.${record.status}`)}
        />
        {!preview && (
          <Text style={ws.muted}>
            {t("nativeDsh.workspaceMemory.revision", { revision: record.revision })}
          </Text>
        )}
      </View>
      <Text selectable style={ws.text} numberOfLines={preview ? 3 : undefined}>
        {record.statement}
      </Text>
      <View style={ws.actions}>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={expanded ? ChevronDown : ChevronRight}
          onPress={toggle}
          accessibilityState={expandedState}
          style={ws.touch}
        >
          {t("nativeDsh.workspaceMemory.evidence")}
        </Button>
        {!preview && canReview && (
          <>
            <Button
              size="sm"
              variant="outline"
              onPress={accept}
              disabled={disabled}
              style={ws.touch}
            >
              {t("nativeDsh.workspaceMemory.accept")}
            </Button>
            <Button size="sm" variant="ghost" onPress={reject} disabled={disabled} style={ws.touch}>
              {t("nativeDsh.workspaceMemory.reject")}
            </Button>
          </>
        )}
        {!preview && canCorrect && !correcting && (
          <Button
            size="sm"
            variant="ghost"
            onPress={startCorrecting}
            disabled={disabled}
            style={ws.touch}
          >
            {t("nativeDsh.workspaceMemory.correct")}
          </Button>
        )}
      </View>
      {correcting && (
        <View style={ws.form}>
          <Field label={t("nativeDsh.workspaceMemory.statement")}>
            <FormTextInput
              initialValue={statement}
              onChangeText={setStatement}
              multiline
              style={ws.briefInput}
              editable={!disabled}
            />
          </Field>
          <View style={ws.actions}>
            <Button
              variant="secondary"
              size="sm"
              onPress={save}
              disabled={disabled || statement.trim() === ""}
            >
              {t("nativeDsh.workspaceMemory.saveCorrection")}
            </Button>
            <Button variant="ghost" size="sm" onPress={cancelCorrecting} disabled={disabled}>
              {t("nativeDsh.work.cancel")}
            </Button>
          </View>
        </View>
      )}
      {expanded && !preview && <MemoryEvidence record={record} />}
    </View>
  );
}

function memoryVariant(status: DshMemoryRecord["status"]): "success" | "warning" | "muted" {
  if (status === "active") return "success";
  if (status === "proposed" || status === "challenged") return "warning";
  return "muted";
}
function MemoryEvidence({ record }: { record: DshMemoryRecord }) {
  const { t } = useTranslation();
  return (
    <View style={ws.evidence}>
      <Text style={ws.muted}>
        {t("nativeDsh.workspaceMemory.trustScore")}: {record.trust.score} ·{" "}
        {t("nativeDsh.workspaceMemory.source")}: {record.trust.source}
      </Text>
      {record.evidence.length === 0 && (
        <Text style={ws.muted}>{t("nativeDsh.workspaceMemory.noEvidence")}</Text>
      )}
      {record.evidence.map((evidence, index) => (
        // eslint-disable-next-line react/no-array-index-key -- Immutable ordered evidence has no per-row state.
        <View key={`${evidence.kind}:${evidence.ref}:${index}`} style={ws.section}>
          <Text selectable style={ws.muted}>
            {evidence.kind} · {evidence.ref}
          </Text>
          {evidence.excerpt !== undefined && (
            <Text selectable style={ws.text}>
              {evidence.excerpt}
            </Text>
          )}
          {evidence.source !== undefined && (
            <Text selectable style={ws.muted}>
              {evidence.source.owner} · {evidence.source.ref} · {evidence.source.revision}
            </Text>
          )}
        </View>
      ))}
      {record.challenge !== undefined && (
        <Text selectable style={ws.text}>
          {record.challenge.reason}
        </Text>
      )}
      {record.applicability !== undefined && record.applicability.conditions.length > 0 && (
        <Text style={ws.sectionTitle}>{t("nativeDsh.workspaceMemory.conditions")}</Text>
      )}
      {record.applicability?.conditions.map((condition) => (
        <Text key={condition} selectable style={ws.text}>
          {condition}
        </Text>
      ))}
      {record.applicability !== undefined && record.applicability.failureLimits.length > 0 && (
        <Text style={ws.sectionTitle}>{t("nativeDsh.workspaceMemory.failureLimits")}</Text>
      )}
      {record.applicability?.failureLimits.map((limit) => (
        <Text key={limit} selectable style={ws.muted}>
          {limit}
        </Text>
      ))}
    </View>
  );
}
