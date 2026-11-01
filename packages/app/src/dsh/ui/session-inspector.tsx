import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as dsh from "@deepseek-ai/dsh-client";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { ChoiceTab } from "./choice-tab";
import { InspectorTabs } from "./inspector-tabs";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { DshConversation, DshHostRuntime } from "../runtime";
import {
  inspectionMetrics,
  inspectionLabel,
  matchesInspection,
  selectedRequest,
  type RequestSelection,
} from "../inspection";
import { useSnapshot } from "./use-snapshot";
import { DataDetail, Facts, Reading } from "./inspection-details";
import { HistoryList } from "./history-list";
import { ImagePreview } from "./image-preview";
import { DetailControl } from "./conversation";
import { inspectorStyles as s } from "./inspector-styles";

const tabs = ["context", "trajectory", "prompt", "usage", "info", "events"] as const;
type Tab = (typeof tabs)[number];
const recordFields = [
  "kind",
  "sourceSeq",
  "timeSeconds",
  "input",
  "cacheRead",
  "cacheWrite",
  "output",
  "think",
];
const promptFields = ["model", "readAt"];
const requestFields = ["startSeq", "status", "usage", "provenance", "requestConfig"];
const usageFields = ["usage", "startedAt", "completedAt", "status", "error", "provenance"];
const fetchedFields = ["fetchedAt"];
const readFields = ["readAt"];

function Projection({ view, name }: { view: DshConversation; name: string }) {
  const face = view.session.projections.faceOf(name);
  const value = useSnapshot(face);
  return (
    <>
      {name === "contextPressure" && (
        <Occupancy pressure={value as dsh.ContextPressureProjection | undefined} />
      )}
      <Facts value={value} />
    </>
  );
}

function Occupancy({ pressure }: { pressure: dsh.ContextPressureProjection | undefined }) {
  const { t } = useTranslation();
  const occupancy = dsh.contextOccupancy(pressure);
  return occupancy === null ? null : (
    <Text style={s.heading}>{t("nativeDsh.inspect.occupancy", { ...occupancy })}</Text>
  );
}

function RecordDetail({
  record,
  view,
  metrics,
}: {
  record: dsh.TrajectoryCellProps;
  view: DshConversation;
  metrics: ReturnType<typeof inspectionMetrics>;
}) {
  const { t } = useTranslation();
  return (
    <View style={s.section}>
      <Text style={s.heading}>
        {record.text || t("nativeDsh.inspect.recordTitle", { index: record.index })}
      </Text>
      <Facts value={record} fields={recordFields} />
      {record.sourceSeq !== undefined && metrics.has(record.sourceSeq) && (
        <Facts value={metrics.get(record.sourceSeq)} />
      )}
      {record.deferredResultSeq !== undefined && (
        <DetailControl history={view.history} seq={record.deferredResultSeq} />
      )}
      <DataDetail label={t("nativeDsh.inspect.input")} value={record.inputDetail} expanded />
      <DataDetail label={t("nativeDsh.inspect.output")} value={record.outputDetail} expanded />
      <DataDetail label={t("nativeDsh.inspect.reasoning")} value={record.thinkingDetail} />
      <DataDetail label={t("nativeDsh.inspect.timing")} value={record.assistantMetrics} />
      <DataDetail label={t("nativeDsh.inspect.source")} value={record.messageSource} />
      <DataDetail label={t("nativeDsh.inspect.schema")} value={record.schemaDetail} />
      <DataDetail
        label={t("nativeDsh.inspect.prompt")}
        value={record.promptDetail ?? record.systemPromptDetail}
      />
      <DataDetail
        label={t("nativeDsh.inspect.previousPrompt")}
        value={record.previousPromptDetail}
      />
      {Array.from(
        new Map(
          [...(record.sourceBlocks ?? []), ...(record.outputBlocks ?? [])].flatMap((block) =>
            block.attachment === undefined
              ? []
              : [[block.attachment.attachmentId, block.attachment] as const],
          ),
        ).values(),
      ).map((attachment) => (
        <ImagePreview key={attachment.attachmentId} attachment={attachment} images={view.images} />
      ))}
      <DataDetail label={t("nativeDsh.inspect.raw")} value={record} />
    </View>
  );
}

function Prompt({
  request,
  view,
}: {
  request: dsh.RequestView | undefined;
  view: DshConversation;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const prompt = request?.purpose === "assistant" ? request.prompt : undefined;
  return (
    <View style={s.section}>
      <Text style={s.muted}>{t("nativeDsh.inspect.historicalPrompt")}</Text>
      {prompt === undefined ? (
        <Text style={s.muted}>{t("nativeDsh.inspect.promptMissing")}</Text>
      ) : (
        <>
          <Facts value={prompt.config} />
          {prompt.system === "" ? (
            <Text style={s.muted}>{t("nativeDsh.inspect.systemUnknown")}</Text>
          ) : (
            <DataDetail
              label={t("nativeDsh.inspect.systemPrompt")}
              value={prompt.system}
              expanded
            />
          )}
          <TextInput
            style={s.search}
            initialValue={query}
            onChangeText={setQuery}
            accessibilityLabel={t("nativeDsh.inspect.searchTools")}
            placeholder={t("nativeDsh.inspect.searchTools")}
          />
          <Text style={s.muted}>
            {t("nativeDsh.inspect.toolsCount", {
              count: prompt.tools.filter((tool) =>
                JSON.stringify(tool).toLowerCase().includes(query.toLowerCase()),
              ).length,
              total: prompt.tools.length,
            })}
          </Text>
          {prompt.tools
            .filter((tool) => JSON.stringify(tool).toLowerCase().includes(query.toLowerCase()))
            .map((tool) => (
              <DataDetail key={tool.name} label={tool.name} value={tool} />
            ))}
          <DataDetail
            label={t("nativeDsh.inspect.previousPrompt")}
            value={request?.purpose === "assistant" ? request.promptChange : undefined}
          />
        </>
      )}
      <Text style={s.heading}>{t("nativeDsh.inspect.latestPrompt")}</Text>
      <Reading source={view.latestPrompt}>
        {(result) => (
          <>
            <Facts value={result.value} fields={promptFields} />
            <DataDetail
              label={t("nativeDsh.inspect.systemPrompt")}
              value={result.value.systemPrompt}
            />
            <DataDetail label={t("nativeDsh.inspect.tools")} value={result.value.tools} />
          </>
        )}
      </Reading>
    </View>
  );
}

function Ledger({
  view,
  records,
  turns,
  metrics,
}: {
  metrics: ReturnType<typeof inspectionMetrics>;
  view: DshConversation;
  records: readonly dsh.TrajectoryCellProps[];
  turns: readonly dsh.TrajectoryTurnModel[];
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [mode, setMode] = useState<dsh.TrajectoryTimelineMode>("actual");
  const [range, setRange] = useState<dsh.TrajectoryTimeRange | null>(null);
  const timeline = useMemo(() => dsh.deriveTrajectoryTimeline(turns, mode), [turns, mode]);
  const domain = range ?? timeline;
  const focused =
    timeline === null || range === null
      ? null
      : dsh.trajectoryTimelineFocusIndexes(turns, range, mode);
  const visible = useMemo(
    () =>
      records.filter(
        (record) =>
          matchesInspection(record, query) && (focused === null || focused.has(record.index)),
      ),
    [records, query, focused],
  );
  const byId = useMemo(
    () => new Map(visible.map((record) => [dsh.trajectoryRecordId(record), record])),
    [visible],
  );
  const keys = useMemo(() => [...byId.keys()], [byId]);
  const selected = records.find((record) => dsh.trajectoryRecordId(record) === selection);
  const render = useCallback(
    (key: string) => {
      const record = byId.get(key);
      if (record === undefined) return null;
      return <RecordRow record={record} selected={key === selection} onSelect={setSelection} />;
    },
    [byId, selection],
  );
  const shift = useCallback(
    (factor: number, scale: number) => {
      if (domain === null || timeline === null) return;
      const width = Math.max(domain.end - domain.start, 1);
      const next = width * scale;
      const start = Math.max(
        timeline.start,
        Math.min(timeline.end - next, domain.start + width * factor + (width - next) / 2),
      );
      setRange({ start, end: Math.min(timeline.end, start + next) });
    },
    [domain, timeline],
  );
  const zoomIn = useCallback(() => shift(0, 0.5), [shift]);
  const zoomOut = useCallback(() => shift(0, 2), [shift]);
  const earlier = useCallback(() => shift(-0.5, 1), [shift]);
  const later = useCallback(() => shift(0.5, 1), [shift]);
  const reset = useCallback(() => setRange(null), []);
  const closeDetail = useCallback(() => setSelection(null), []);
  const selectMode = useCallback((value: dsh.TrajectoryTimelineMode) => {
    setMode(value);
    setRange(null);
  }, []);
  return (
    <View style={s.fill}>
      <View style={s.inline}>
        {(["sequence", "duration", "time", "actual"] as const).map((value) => (
          <ChoiceTab
            key={value}
            value={value}
            selected={mode}
            label={t(`nativeDsh.inspect.modes.${value}`)}
            onSelect={selectMode}
          />
        ))}
        <Button
          size="sm"
          variant="ghost"
          onPress={zoomIn}
          accessibilityLabel={t("nativeDsh.inspect.zoomIn")}
        >
          +
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onPress={zoomOut}
          accessibilityLabel={t("nativeDsh.inspect.zoomOut")}
        >
          −
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onPress={earlier}
          accessibilityLabel={t("nativeDsh.inspect.earlier")}
        >
          ←
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onPress={later}
          accessibilityLabel={t("nativeDsh.inspect.later")}
        >
          →
        </Button>
        <Button size="sm" variant="ghost" onPress={reset}>
          {t("nativeDsh.inspect.reset")}
        </Button>
      </View>
      {timeline !== null && domain !== null && (
        <View style={s.timeline} accessibilityLabel={t("nativeDsh.inspect.timing")}>
          {timeline.spans
            .filter((span) => span.end >= domain.start && span.start <= domain.end)
            .map((span) => {
              const record = records.find((value) => value.index === span.index);
              const width = Math.max(domain.end - domain.start, 1);
              return (
                <TimelineBar
                  key={span.index}
                  span={span}
                  domain={domain}
                  width={width}
                  record={record}
                  selection={selection}
                  onSelect={setSelection}
                />
              );
            })}
        </View>
      )}
      <TextInput
        style={s.search}
        initialValue={query}
        onChangeText={setQuery}
        placeholder={t("nativeDsh.inspect.search")}
        accessibilityLabel={t("nativeDsh.inspect.search")}
      />
      <View style={s.split}>
        {(!compact || selected === undefined) && (
          <View style={s.ledger}>
            <HistoryList
              keys={keys}
              renderItem={render}
              latestLabel={t("nativeDsh.history.latest")}
            />
          </View>
        )}
        {selected !== undefined && (
          <ScrollView style={compact ? s.fill : s.detailPane} contentContainerStyle={s.content}>
            <Button size="sm" variant="ghost" onPress={closeDetail}>
              {t("nativeDsh.inspect.closeDetail")}
            </Button>
            <RecordDetail
              key={dsh.trajectoryRecordId(selected)}
              record={selected}
              view={view}
              metrics={metrics}
            />
          </ScrollView>
        )}
        {selection !== null && selected === undefined && (
          <Text style={s.muted}>{t("nativeDsh.inspect.selectionMissing")}</Text>
        )}
      </View>
    </View>
  );
}

function Events({ view }: { view: DshConversation }) {
  const { t } = useTranslation();
  const window = useSnapshot(view.events);
  const [query, setQuery] = useState("");
  const entries = useMemo(
    () =>
      new Map(
        window.entries
          .filter((entry) => JSON.stringify(entry).toLowerCase().includes(query.toLowerCase()))
          .map((entry) => [`${entry.type}:${entry.event.seq}`, entry]),
      ),
    [window, query],
  );
  const keys = useMemo(() => [...entries.keys()], [entries]);
  const render = useCallback(
    (key: string) => {
      const entry = entries.get(key);
      return entry === undefined ? null : (
        <View>
          <DataDetail
            label={`${entry.event.seq} · ${entry.type} · ${entry.event.type}`}
            value={entry}
          />
          {entry.type === "event" && entry.detail !== undefined && (
            <DetailControl history={view.history} seq={entry.event.seq} />
          )}
        </View>
      );
    },
    [entries, view],
  );
  return (
    <View style={s.fill}>
      <TextInput
        initialValue={query}
        onChangeText={setQuery}
        style={s.search}
        placeholder={t("nativeDsh.inspect.searchEvents")}
        accessibilityLabel={t("nativeDsh.inspect.searchEvents")}
      />
      <HistoryList keys={keys} renderItem={render} latestLabel={t("nativeDsh.history.latest")} />
    </View>
  );
}

export function SessionInspector({
  runtime,
  view,
  onClose,
}: {
  runtime: DshHostRuntime;
  view: DshConversation;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("context");
  const [selection, setSelection] = useState<RequestSelection>("latest");
  const target = view.conversation.target("trajectory");
  const snapshot = useSnapshot(target) ?? dsh.EMPTY_TRAJECTORY_SNAPSHOT;
  const session = useSnapshot(view.session);
  const history = useSnapshot(view.history);
  const list = useSnapshot(runtime.sessions.list);
  const request = selectedRequest(snapshot.requests, selection);
  const metrics = useMemo(() => inspectionMetrics(snapshot.eventNodes), [snapshot.eventNodes]);
  const translate = useCallback<dsh.TrajectoryLayoutTranslate>(
    (key, values) =>
      t(`nativeDsh.trajectory.${key}`, { ...values, interpolation: { prefix: "{", suffix: "}" } }),
    [t],
  );
  const turns = useMemo(
    () => dsh.deriveTrajectoryLayout({ ...snapshot, nodes: snapshot.eventNodes }, translate),
    [snapshot, translate],
  );
  const records = useMemo(
    () =>
      turns
        .flatMap((turn) => turn.groups.flatMap((group) => group.cells))
        .filter((record) => !record.requestOnly),
    [turns],
  );
  const options = useMemo(
    () => [
      { id: "latest", value: "latest" as RequestSelection, label: t("nativeDsh.inspect.latest") },
      ...snapshot.requests.map((item) => ({
        id: String(item.startSeq),
        value: item.startSeq,
        label: t("nativeDsh.inspect.request", {
          seq: item.startSeq,
          purpose: item.purpose,
          step: item.step,
        }),
      })),
    ],
    [snapshot.requests, t],
  );
  const display = useMemo(
    () => options.find((option) => option.value === selection) ?? { label: String(selection) },
    [options, selection],
  );
  return (
    <View style={s.fill} testID="dsh-session-inspector">
      <View style={s.header}>
        <Button size="sm" variant="ghost" onPress={onClose}>
          {t("nativeDsh.inspect.back")}
        </Button>
        <Text numberOfLines={1} style={s.title}>
          {list.byId[view.sessionId]?.displayTitle ?? view.sessionId}
        </Text>
        <View style={s.picker}>
          <SelectField
            field={false}
            size="sm"
            label={t("nativeDsh.inspect.requestLabel")}
            value={selection}
            selectedDisplay={display}
            options={options}
            onChange={setSelection}
            placeholder={t("nativeDsh.inspect.requestLabel")}
            emptyText={t("nativeDsh.inspect.noRequests")}
            searchable
          />
        </View>
      </View>
      <InspectorTabs tabs={tabs} selected={tab} onSelect={setTab} />
      <View style={s.canvas} testID="dsh-inspector-data">
        {session.hasMore && (
          <View style={s.inline}>
            <Text style={s.muted}>{t("nativeDsh.inspect.partialHistory")}</Text>
            <Button
              size="sm"
              variant="ghost"
              disabled={history.older !== "available" || session.loadingOlder}
              onPress={view.history.loadOlder}
            >
              {t(
                session.olderError === null
                  ? "nativeDsh.history.loadOlder"
                  : "nativeDsh.history.retryOlder",
              )}
            </Button>
          </View>
        )}
        {session.syncing && <Text style={s.muted}>{t("nativeDsh.conversation.syncing")}</Text>}
        {session.openState === "error" && (
          <Text accessibilityRole="alert" style={s.error}>
            {t("nativeDsh.conversation.readFailed")}
          </Text>
        )}
        {selection !== "latest" && request === undefined && (
          <Text style={s.muted}>{t("nativeDsh.inspect.selectionMissing")}</Text>
        )}
        {tab === "trajectory" && (
          <Ledger view={view} records={records} turns={turns} metrics={metrics} />
        )}
        {tab === "events" && <Events view={view} />}
        {tab !== "trajectory" && tab !== "events" && (
          <ScrollView contentContainerStyle={s.content}>
            {tab === "context" && (
              <>
                <Text style={s.heading}>{t("nativeDsh.inspect.nextContext")}</Text>
                <Text style={s.muted}>{t("nativeDsh.inspect.estimates")}</Text>
                <Projection view={view} name="contextPressure" />
                <Projection view={view} name="contextBreakdown" />
                <Text style={s.heading}>{t("nativeDsh.inspect.recordedRequest")}</Text>
                <Facts value={request} fields={requestFields} />
                <DataDetail
                  label={t("nativeDsh.inspect.contextSources")}
                  value={snapshot.eventNodes.filter(
                    (node) => node.kind === "context" || node.kind === "steering",
                  )}
                />
                <DataDetail
                  label={t("nativeDsh.inspect.compaction")}
                  value={snapshot.requests.filter((item) => item.purpose === "compaction")}
                />
                <DataDetail label={t("nativeDsh.inspect.raw")} value={request} />
              </>
            )}
            {tab === "prompt" && <Prompt request={request} view={view} />}
            {tab === "usage" && (
              <>
                <Text style={s.heading}>{t("nativeDsh.inspect.totalUsage")}</Text>
                <Projection view={view} name="tokenUsage" />
                <Text style={s.heading}>{t("nativeDsh.inspect.recordedRequest")}</Text>
                <Facts value={request} fields={usageFields} />
                {[...metrics].map(([seq, reading]) => (
                  <View key={seq} style={s.section}>
                    <Text style={s.heading}>{t("nativeDsh.inspect.stepMetrics", { seq })}</Text>
                    <Facts value={reading} />
                  </View>
                ))}
                <DataDetail
                  label={t("nativeDsh.inspect.timing")}
                  value={records
                    .filter((record) => record.assistantMetrics !== undefined)
                    .map((record) => ({
                      sourceSeq: record.sourceSeq,
                      timing: record.assistantMetrics,
                    }))}
                />
                <Text style={s.heading}>{t("nativeDsh.inspect.spend")}</Text>
                <Reading source={view.spend}>
                  {(result) => (
                    <>
                      <Facts value={result.value.key} />
                      <Facts value={result.value.session} />
                      <Facts value={result.value} fields={fetchedFields} />
                    </>
                  )}
                </Reading>
              </>
            )}
            {tab === "info" && (
              <Reading source={view.info}>
                {(result) => (
                  <>
                    <Text style={s.heading}>{t("nativeDsh.inspect.summary")}</Text>
                    <Text selectable style={s.text}>
                      {result.value.summary ?? t("nativeDsh.inspect.noReading")}
                    </Text>
                    {(["session", "workspace", "environment", "policies"] as const).map((key) => (
                      <View key={key} style={s.section}>
                        <Text style={s.heading}>{t(`nativeDsh.inspect.sections.${key}`)}</Text>
                        <Facts value={result.value[key]} />
                      </View>
                    ))}
                    <Facts value={result.value} fields={readFields} />
                  </>
                )}
              </Reading>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function RecordRow({
  record,
  selected,
  onSelect,
}: {
  record: dsh.TrajectoryCellProps;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const id = dsh.trajectoryRecordId(record);
  const choose = useCallback(() => onSelect(id), [id, onSelect]);
  const state = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={state}
      onPress={choose}
      style={[s.row, selected && s.selected]}
    >
      <Text style={s.rowMeta}>{`${record.index} · ${record.kind}`}</Text>
      <Text numberOfLines={1} style={[s.rowText, record.isError && s.error]}>
        {inspectionLabel(record)}
      </Text>
      <Text style={s.muted}>
        {record.timeSeconds === null ? "—" : `${Math.round(record.timeSeconds * 1000)} ms`}
      </Text>
    </Pressable>
  );
}
function TimelineBar({
  span,
  domain,
  width,
  record,
  selection,
  onSelect,
}: {
  span: dsh.TrajectoryTimelineSpan;
  domain: dsh.TrajectoryTimeRange;
  width: number;
  record: dsh.TrajectoryCellProps | undefined;
  selection: string | null;
  onSelect: (id: string) => void;
}) {
  const id = record === undefined ? undefined : dsh.trajectoryRecordId(record);
  const choose = useCallback(() => {
    if (id !== undefined) onSelect(id);
  }, [id, onSelect]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${span.label}: ${span.start}–${span.end}`}
      onPress={choose}
      style={[
        s.bar,
        id === selection && s.activeBar,
        {
          left: `${Math.max(0, ((span.start - domain.start) / width) * 100)}%`,
          width: `${Math.max(0.3, ((Math.min(span.end, domain.end) - Math.max(span.start, domain.start)) / width) * 100)}%`,
          top: span.lane * 20 + 5,
        },
      ]}
    />
  );
}
