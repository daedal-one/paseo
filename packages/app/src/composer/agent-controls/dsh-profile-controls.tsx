import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { AgentFeature, AgentFeatureSelect } from "@getpaseo/protocol/agent-types";
import { DSH_AGENT_PRESET, DSH_MODEL_OVERRIDE } from "@getpaseo/protocol/dsh-profiles";
import { Combobox } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Switch } from "@/components/ui/switch";

interface Props {
  provider: string | null;
  features?: AgentFeature[];
  draft?: boolean;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onSetFeature?: (id: string, value: unknown) => void;
  children: ReactNode;
}

export function DshControlFrame(props: Props) {
  return props.provider === "dsh" ? <DshProfileControls {...props} /> : props.children;
}

function profileFeature(features: AgentFeature[]): AgentFeatureSelect | undefined {
  const feature = features.find((item) => item.id === DSH_AGENT_PRESET);
  return feature?.type === "select" ? feature : undefined;
}

/** DSH composition is selected before creation; live Sessions expose a fixed profile label. */
function DshProfileControls({
  features = [],
  draft = false,
  disabled = false,
  loading = false,
  error,
  onRetry,
  onSetFeature,
  children,
}: Props) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const header = useMemo(() => ({ title: t("nativeDsh.profile.settings") }), [t]);
  const selection = profileFeature(features);
  const override = features.find((feature) => feature.id === DSH_MODEL_OVERRIDE)?.value === true;
  const setOverride = useCallback(
    (value: boolean) => onSetFeature?.(DSH_MODEL_OVERRIDE, value),
    [onSetFeature],
  );
  const label = selection?.value ?? t("nativeDsh.profile.hostDefault");
  const showOverrides = !draft || !selection || override;
  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        {draft ? (
          <ProfilePicker
            selection={selection}
            disabled={disabled}
            loading={loading}
            onSelect={onSetFeature}
          />
        ) : (
          <Text style={styles.text} testID="dsh-session-profile">
            {t("nativeDsh.profile.current", { profile: label })}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          testID="dsh-session-settings"
          disabled={disabled}
          onPress={openSettings}
        >
          <Text style={styles.link}>{t("nativeDsh.profile.settings")}</Text>
        </Pressable>
      </View>
      {draft && !loading && !selection ? (
        <View>
          <Text style={styles.text}>{error ?? t("nativeDsh.profile.unavailable")}</Text>
          {onRetry ? (
            <Pressable accessibilityRole="button" onPress={onRetry}>
              <Text style={styles.link}>{t("common.actions.retry")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <AdaptiveModalSheet
        visible={settingsOpen}
        onClose={closeSettings}
        header={header}
        testID="dsh-session-settings-sheet"
      >
        <View style={styles.settings}>
          <Text style={styles.text}>
            {draft ? t("nativeDsh.profile.defaults") : t("nativeDsh.profile.fixed")}
          </Text>
          {draft && selection ? (
            <View style={styles.row}>
              <Text style={styles.text}>{t("nativeDsh.profile.override")}</Text>
              <Switch value={override} onValueChange={setOverride} disabled={disabled} />
            </View>
          ) : null}
          {showOverrides ? children : null}
        </View>
      </AdaptiveModalSheet>
    </View>
  );
}

function ProfilePicker({
  selection,
  disabled,
  loading,
  onSelect,
}: {
  selection: AgentFeatureSelect | undefined;
  disabled: boolean;
  loading: boolean;
  onSelect?: (id: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);
  const show = useCallback(() => setOpen(true), []);
  const select = useCallback(
    (id: string) => {
      onSelect?.(DSH_AGENT_PRESET, id);
      onSelect?.(DSH_MODEL_OVERRIDE, false);
      setOpen(false);
    },
    [onSelect],
  );
  const options = useMemo(
    () =>
      selection?.options.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
      })) ?? [],
    [selection],
  );
  const label =
    options.find((option) => option.id === selection?.value)?.label ??
    selection?.value ??
    t("nativeDsh.profile.hostDefault");
  return (
    <>
      <ComboboxTrigger
        ref={anchor}
        collapsable={false}
        testID="dsh-profile-selector"
        accessibilityLabel={t("nativeDsh.profile.select")}
        disabled={disabled || loading || !selection || options.length === 0}
        onPress={show}
      >
        <Text style={styles.text} numberOfLines={1}>
          {loading ? t("common.loading") : label}
        </Text>
      </ComboboxTrigger>
      <Combobox
        options={options}
        value={selection?.value ?? ""}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchor}
        title={t("nativeDsh.profile.select")}
        searchable={options.length > 5}
        desktopPlacement="top-start"
        onSelect={select}
      />
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  wrapper: { flexShrink: 1, minWidth: 0, gap: theme.spacing[1] },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flexShrink: 1 },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base, flexShrink: 1 },
  link: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  settings: { padding: theme.spacing[4], gap: theme.spacing[4] },
}));
