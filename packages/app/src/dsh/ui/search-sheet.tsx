import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { SessionId } from "@deepseek-ai/dsh-client";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { DshHostRuntime } from "../runtime";
import type { DshSearchSnapshot } from "../search";
import { useSearch } from "../use-search";
import { styles } from "./styles";

interface Props {
  runtime: DshHostRuntime;
  onClose(): void;
  onOpenSession(id: SessionId): void;
}
interface ResultProps {
  id: SessionId;
  snippet: string;
  opening: DshSearchSnapshot["opening"];
  runtime: DshHostRuntime;
  onOpenSession(id: SessionId): void;
}
function SearchResult({ id, snippet, opening, runtime, onOpenSession }: ResultProps) {
  const { t } = useTranslation();
  const open = useCallback(
    () => runtime.search.openResult(id, onOpenSession),
    [runtime, id, onOpenSession],
  );
  const loading = opening.kind === "loading" && opening.id === id;
  const failed = (opening.kind === "failed" || opening.kind === "missing") && opening.id === id;
  return (
    <View style={styles.row} testID={`dsh-search-result-${id}`}>
      <Text selectable style={styles.text}>
        {snippet}
      </Text>
      <Text style={styles.muted}>{id}</Text>
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(`nativeDsh.search.${opening.kind}`)}
        </Text>
      )}
      <Button
        size="sm"
        testID={`dsh-search-open-${id}`}
        disabled={opening.kind === "loading"}
        loading={loading}
        onPress={open}
      >
        {t("nativeDsh.conversation.open")}
      </Button>
    </View>
  );
}
function SearchSheet({ runtime, onClose, onOpenSession }: Props) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const { search, state } = useSearch(runtime);
  const { read } = state;
  const header = useMemo(() => ({ title: t("nativeDsh.search.title") }), [t]);
  const loading = read.kind === "loading";
  const footer = useMemo(
    () => (
      <View style={styles.creationActions} testID="dsh-search-actions">
        <Button
          size={size}
          testID="dsh-search-submit"
          disabled={state.availability !== "available" || loading}
          loading={loading}
          onPress={search.submit}
        >
          {read.kind === "failed" ? t("common.actions.retry") : t("common.actions.search")}
        </Button>
        <Button size={size} variant="outline" testID="dsh-search-close" onPress={onClose}>
          {t("common.actions.close")}
        </Button>
      </View>
    ),
    [size, state.availability, loading, read.kind, search, onClose, t],
  );
  return (
    <AdaptiveModalSheet
      visible
      header={header}
      footer={footer}
      onClose={onClose}
      testID="dsh-search-sheet"
    >
      <View style={styles.group}>
        <Field label={t("nativeDsh.search.query")}>
          <FormTextInput
            initialValue={state.query}
            onChangeText={search.setQuery}
            size={size}
            testID="dsh-search-query"
            accessibilityLabel={t("nativeDsh.search.query")}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
        {state.validation !== null && (
          <Text accessibilityRole="alert" style={styles.error}>
            {t(`nativeDsh.search.validation.${state.validation}`)}
          </Text>
        )}
        {state.availability !== "available" && (
          <Text style={styles.muted}>{t(`nativeDsh.search.${state.availability}`)}</Text>
        )}
        {read.kind === "failed" && (
          <Text testID="dsh-search-failed" accessibilityRole="alert" style={styles.error}>
            {t("nativeDsh.search.searchFailed")}
          </Text>
        )}
        {read.kind === "ready" && (
          <View style={styles.group} testID="dsh-search-results">
            {read.result.items.length === 0 && (
              <Text testID="dsh-search-empty" style={styles.muted}>
                {t("nativeDsh.search.empty")}
              </Text>
            )}
            {read.result.items.map((item) => (
              <SearchResult
                key={item.sessionId}
                id={item.sessionId}
                snippet={item.snippet}
                opening={state.opening}
                runtime={runtime}
                onOpenSession={onOpenSession}
              />
            ))}
            {read.result.hasMore && (
              <Text testID="dsh-search-more" style={styles.muted}>
                {t("nativeDsh.search.more", { count: state.limit })}
              </Text>
            )}
          </View>
        )}
      </View>
    </AdaptiveModalSheet>
  );
}
export function SearchControl({
  runtime,
  busy,
  onOpenSession,
}: Omit<Props, "onClose"> & { busy: boolean }) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState<DshHostRuntime | null>(null);
  const state = useSyncExternalStore(runtime.search.subscribe, runtime.search.getSnapshot);
  const show = useCallback(() => setOpened(runtime), [runtime]);
  const close = useCallback(() => setOpened(null), []);
  const open = useCallback(
    (id: SessionId) => {
      onOpenSession(id);
      close();
    },
    [onOpenSession, close],
  );
  if (state.availability === "unavailable" && opened !== runtime) return null;
  return (
    <>
      <Button size="sm" testID="dsh-search-sessions" disabled={busy} onPress={show}>
        {t("nativeDsh.search.title")}
      </Button>
      {opened === runtime && <SearchSheet runtime={runtime} onClose={close} onOpenSession={open} />}
    </>
  );
}
