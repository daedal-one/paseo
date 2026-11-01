import {
  useCallback,
  useMemo,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { InspectionRead } from "../inspection-read";
import { inspectorStyles as s } from "./inspector-styles";

/** Exact JSON remains available beside formatted facts; no truncation or value substitution. */
export function DataDetail({
  label,
  value,
  expanded = false,
}: {
  label: string;
  value: unknown;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(expanded);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const expandedState = useMemo(() => ({ expanded: open }), [open]);
  if (value === undefined) return null;
  return (
    <View style={s.detail}>
      <Button
        size="sm"
        variant="ghost"
        accessibilityState={expandedState}
        aria-expanded={open}
        style={s.detailButton}
        onPress={toggle}
      >{`${open ? "−" : "+"} ${label}`}</Button>
      {open && (
        <ScrollView style={s.codeScroll} nestedScrollEnabled>
          <ScrollView horizontal>
            <Text selectable style={s.code}>
              {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
            </Text>
          </ScrollView>
        </ScrollView>
      )}
    </View>
  );
}

export function Facts({ value, fields }: { value: unknown; fields?: readonly string[] }) {
  const { t } = useTranslation();
  if (value === null || value === undefined)
    return <Text style={s.muted}>{t("nativeDsh.inspect.noReading")}</Text>;
  if (typeof value !== "object")
    return (
      <Text selectable style={s.text}>
        {String(value)}
      </Text>
    );
  return (
    <View>
      {Object.entries(value)
        .filter(([key]) => fields === undefined || fields.includes(key))
        .map(([key, item]) =>
          item !== null && typeof item === "object" ? (
            <DataDetail
              key={key}
              label={t(`nativeDsh.inspect.facts.${key}`, { defaultValue: key })}
              value={item}
            />
          ) : (
            <View key={key} style={s.fact}>
              <Text style={s.factLabel}>
                {t(`nativeDsh.inspect.facts.${key}`, { defaultValue: key })}
              </Text>
              <Text selectable style={s.factValue}>
                {factText(
                  key,
                  item,
                  t("nativeDsh.inspect.noReading"),
                  t("nativeDsh.inspect.unlimited"),
                )}
              </Text>
            </View>
          ),
        )}
    </View>
  );
}

export function Reading<T extends { ok: boolean }>({
  source,
  children,
}: {
  source: InspectionRead<T>;
  children: (result: Extract<T, { ok: true }>) => ReactNode;
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot);
  useEffect(() => {
    if (state.status === "idle") void source.refresh();
  }, [source, state.status]);
  let content: ReactNode = <Text style={s.muted}>{t(`nativeDsh.inspect.${state.status}`)}</Text>;
  if (state.status === "ready")
    content = state.value.ok ? (
      children(state.value as Extract<T, { ok: true }>)
    ) : (
      <Text accessibilityRole="alert" style={s.muted}>
        {t("nativeDsh.inspect.unavailable")}
      </Text>
    );
  return (
    <View style={s.section}>
      <View style={s.inline}>
        <Text style={s.muted}>{t("nativeDsh.inspect.currentReading")}</Text>
        <Button size="sm" variant="ghost" onPress={source.refresh}>
          {t("nativeDsh.inspect.refresh")}
        </Button>
      </View>
      {content}
    </View>
  );
}

function factText(key: string, value: unknown, missing: string, unlimited: string): string {
  if (value === null && (key === "limitUsd" || key === "limitRemainingUsd")) return unlimited;
  if (value === null || value === undefined) return missing;
  if (
    typeof value === "number" &&
    ["readAt", "fetchedAt", "startedAt", "completedAt"].includes(key)
  )
    return new Date(value).toLocaleString();
  return String(value);
}
